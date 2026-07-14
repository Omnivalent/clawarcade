// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LaunchToken} from "./LaunchToken.sol";

/// @notice Receives a graduated token's ETH + reserved supply and is
///         responsible for seeding the Uniswap pool and burning the LP.
///         MVP ships with a plain escrow; the Uniswap v3 adapter replaces it
///         once we're pointed at the official Robinhood Chain deployment.
interface IGraduationHandler {
    function onGraduation(address token, uint256 tokenAmount) external payable;
}

/// @notice The slice of the factory the curve calls back into at graduation
///         to auto-renew the token's .hood name (+5 years, paid from the raise).
///         The curve sends a hard-capped budget; the factory spends what the
///         registrar quotes, refunds the rest, and returns the amount spent.
interface ILaunchpadFactory {
    function renewOnGraduation(address token) external payable returns (uint256 spent);
}

/// @title BondingCurve — singleton constant-product curve for all launchpad tokens
/// @notice Tokenomics mirror pump.fun exactly, translated from SOL to ETH:
///         1B fixed supply; 793.1M sold on the curve; 206.9M reserved for the
///         graduation pool; virtual token reserves start at 1.073B (pump.fun's
///         numbers); the virtual ETH base is set at deploy (pump.fun uses
///         30 virtual SOL). The curve graduates when its sellable supply is
///         exhausted — or earlier if the optional ETH threshold is hit — and
///         hands ETH + reserved tokens to the graduation handler to seed a
///         Uniswap pool whose LP is burned.
contract BondingCurve {
    uint256 public constant CURVE_SUPPLY = 793_100_000e18; // sellable on curve (pump.fun)
    uint256 public constant LP_RESERVE = 206_900_000e18; // held for graduation pool (pump.fun)
    uint256 public constant VIRTUAL_TOKEN_0 = 1_073_000_000e18; // pump.fun virtual token reserves
    uint256 public constant MAX_FEE_BPS = 1_000; // 10% hard cap
    // Renewal safety valve: never spend more than 10% of the raise on the
    // .hood renewal, however a (possibly compromised) registrar quotes it.
    uint256 public constant MAX_RENEWAL_SHARE_BPS = 1_000;

    address public immutable factory;
    address public immutable feeRecipient;
    IGraduationHandler public immutable graduationHandler;
    uint256 public immutable feeBps; // 0 is valid (fee-free test deployments)
    uint256 public immutable virtualEth0; // pump.fun's "30 virtual SOL", in wei
    // Optional early graduation trigger. Set to any value above the sellout
    // raise (convention: 1 << 255) for pump.fun behavior — graduate on
    // sellout only. Zero is rejected: it would graduate every token on its
    // first dust buy and seed a near-zero-price pool.
    uint256 public immutable graduationEth;

    /// @notice Trade fees accrue here and are pulled via collectFees(), so a
    ///         misbehaving fee recipient can never block trading.
    uint256 public pendingFees;

    struct Curve {
        uint128 virtualEth;
        uint128 virtualToken;
        uint128 realEth;
        uint128 tokensSold;
        bool exists;
        bool graduated;
    }

    mapping(address => Curve) public curves;
    uint256 private unlocked = 1;

    event Buy(address indexed token, address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee);
    event Sell(address indexed token, address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee);
    event Graduated(address indexed token, uint256 ethToPool, uint256 tokensToPool, uint256 renewalSpent);

    modifier lock() {
        require(unlocked == 1, "reentrancy");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor(
        address factory_,
        address feeRecipient_,
        IGraduationHandler handler_,
        uint256 feeBps_,
        uint256 virtualEth0_,
        uint256 graduationEth_
    ) {
        require(feeBps_ <= MAX_FEE_BPS, "fee too high");
        require(virtualEth0_ > 0, "zero virtual eth");
        require(graduationEth_ > 0, "zero graduation trigger");
        // Compile-time constants must always sum to the token's fixed supply.
        require(CURVE_SUPPLY + LP_RESERVE == 1_000_000_000e18, "supply split mismatch");
        factory = factory_;
        feeRecipient = feeRecipient_;
        graduationHandler = handler_;
        feeBps = feeBps_;
        virtualEth0 = virtualEth0_;
        graduationEth = graduationEth_;
    }

    /// @notice Called once per token by the factory at launch.
    function initToken(address token) external {
        require(msg.sender == factory, "only factory");
        require(!curves[token].exists, "already listed");
        curves[token] = Curve({
            virtualEth: uint128(virtualEth0),
            virtualToken: uint128(VIRTUAL_TOKEN_0),
            realEth: 0,
            tokensSold: 0,
            exists: true,
            graduated: false
        });
    }

    /// @dev All k/reserve divisions round UP so rounding always favors the
    ///      curve, never the trader — otherwise a buy/sell round trip can
    ///      extract more ETH than the curve holds.
    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a + b - 1) / b;
    }

    /// @dev Single source of truth for buy pricing, used by BOTH quoteBuy and
    ///      buy so a quote can never disagree with execution. A purchase that
    ///      would exceed the sellable supply is clamped to the remainder, with
    ///      the fee re-derived from the ETH actually spent so the buyer never
    ///      pays a fee on the refunded portion.
    function _buyMath(Curve storage c, uint256 grossValue)
        internal
        view
        returns (uint256 tokensOut, uint256 ethIn, uint256 fee, uint256 refund)
    {
        fee = (grossValue * feeBps) / 10_000;
        ethIn = grossValue - fee;

        uint256 k = uint256(c.virtualEth) * uint256(c.virtualToken);
        tokensOut = uint256(c.virtualToken) - _ceilDiv(k, uint256(c.virtualEth) + ethIn);

        uint256 remaining = CURVE_SUPPLY - c.tokensSold;
        if (tokensOut > remaining) {
            tokensOut = remaining;
            uint256 ethNeeded = _ceilDiv(k, uint256(c.virtualToken) - tokensOut) - uint256(c.virtualEth);
            uint256 grossNeeded = _ceilDiv(ethNeeded * 10_000, 10_000 - feeBps);
            // Ceil-rounding can push grossNeeded 1 wei past grossValue when
            // the clamp barely binds; cap it so the refund can never underflow
            // and revert the graduating buy.
            if (grossNeeded > grossValue) grossNeeded = grossValue;
            fee = grossNeeded - ethNeeded;
            refund = grossValue - grossNeeded;
            ethIn = ethNeeded;
        }
    }

    /// @dev Single source of truth for sell pricing, used by BOTH quoteSell
    ///      and sell.
    function _sellMath(Curve storage c, uint256 tokensIn)
        internal
        view
        returns (uint256 grossEth, uint256 fee, uint256 ethOut)
    {
        uint256 k = uint256(c.virtualEth) * uint256(c.virtualToken);
        grossEth = uint256(c.virtualEth) - _ceilDiv(k, uint256(c.virtualToken) + tokensIn);
        fee = (grossEth * feeBps) / 10_000;
        ethOut = grossEth - fee;
    }

    /// @notice Exact-execution quote: tokens received for spending `ethGross`
    ///         (fee and graduation clamp included, identical math to buy()).
    function quoteBuy(address token, uint256 ethGross) public view returns (uint256 tokensOut) {
        Curve storage c = curves[token];
        require(c.exists && !c.graduated, "not tradable");
        (tokensOut,,,) = _buyMath(c, ethGross);
    }

    /// @notice Exact-execution quote: ETH received for selling `tokensIn`
    ///         (after fee, identical math to sell()).
    function quoteSell(address token, uint256 tokensIn) public view returns (uint256 ethOut) {
        Curve storage c = curves[token];
        require(c.exists && !c.graduated, "not tradable");
        (,, ethOut) = _sellMath(c, tokensIn);
    }

    /// @notice Buy on the curve. A purchase that would exceed the sellable
    ///         supply is clamped to the remainder and the unused ETH refunded.
    ///         Graduation fires on sellout, or on `graduationEth` raised if
    ///         that (optional) early trigger is configured lower.
    /// @param minTokensOut slippage floor — the frontend sets this tight so a
    ///         sandwich bot front-running the buy can't push the fill price up
    ///         past the caller's tolerance; the tx reverts instead.
    /// @param deadline unix time after which the tx is stale and reverts, so a
    ///         held-back (censored) tx can't be executed later inside a sandwich.
    function buy(address token, uint256 minTokensOut, uint256 deadline)
        external payable lock returns (uint256 tokensOut)
    {
        require(block.timestamp <= deadline, "expired");
        Curve storage c = curves[token];
        require(c.exists && !c.graduated, "not tradable");
        require(msg.value > 0, "zero eth");

        uint256 ethIn;
        uint256 fee;
        uint256 refund;
        (tokensOut, ethIn, fee, refund) = _buyMath(c, msg.value);
        require(tokensOut > 0, "dust buy");
        require(tokensOut >= minTokensOut, "slippage");

        c.virtualEth += uint128(ethIn);
        c.virtualToken -= uint128(tokensOut);
        c.realEth += uint128(ethIn);
        c.tokensSold += uint128(tokensOut);

        LaunchToken(token).transfer(msg.sender, tokensOut);
        pendingFees += fee;
        if (refund > 0) _safeSendEth(msg.sender, refund);
        emit Buy(token, msg.sender, msg.value - refund, tokensOut, fee);

        if (c.tokensSold == CURVE_SUPPLY || c.realEth >= graduationEth) _graduate(token, c);
    }

    function sell(address token, uint256 tokensIn, uint256 minEthOut, uint256 deadline)
        external lock returns (uint256 ethOut)
    {
        require(block.timestamp <= deadline, "expired");
        Curve storage c = curves[token];
        require(c.exists && !c.graduated, "not tradable");
        require(tokensIn > 0, "zero tokens");

        uint256 k = uint256(c.virtualEth) * uint256(c.virtualToken);
        uint256 grossEth = uint256(c.virtualEth) - _ceilDiv(k, uint256(c.virtualToken) + tokensIn);
        uint256 fee = (grossEth * feeBps) / 10_000;
        ethOut = grossEth - fee;
        require(ethOut >= minEthOut, "slippage");
        require(grossEth <= c.realEth, "exceeds reserves");

        c.virtualEth -= uint128(grossEth);
        c.virtualToken += uint128(tokensIn);
        c.realEth -= uint128(grossEth);
        c.tokensSold -= uint128(tokensIn);

        LaunchToken(token).transferFrom(msg.sender, address(this), tokensIn);
        _safeSendEth(msg.sender, ethOut);
        pendingFees += fee;
        emit Sell(token, msg.sender, tokensIn, ethOut, fee);
    }

    /// @notice Pull accrued trade fees to the fee recipient. Anyone may call.
    function collectFees() external {
        uint256 amount = pendingFees;
        pendingFees = 0;
        _safeSendEth(feeRecipient, amount);
    }

    /// @dev Graduation sequence:
    ///      1. auto-renew the token's .hood name +5 years, paid from the raise
    ///         (best-effort: a reverting or overpriced registrar can never
    ///         block graduation, and the renewal spend is hard-capped at 10%
    ///         of the raise);
    ///      2. hand remaining ETH + all curve-held tokens (unsold + the 206.9M
    ///         LP reserve) to the graduation handler (Uniswap pool, LP burned).
    function _graduate(address token, Curve storage c) internal {
        c.graduated = true;
        uint256 ethToPool = c.realEth;
        uint256 renewalSpent = 0;

        // Send the factory a hard-capped budget; it spends what the registrar
        // quotes, refunds the rest (via receive() below), and reports spend.
        // Best-effort by design: a reverting or overpriced registrar can
        // never block graduation.
        uint256 renewalBudget = (ethToPool * MAX_RENEWAL_SHARE_BPS) / 10_000;
        if (renewalBudget > 0) {
            try ILaunchpadFactory(factory).renewOnGraduation{value: renewalBudget}(token) returns (uint256 spent) {
                renewalSpent = spent > renewalBudget ? renewalBudget : spent;
                ethToPool -= renewalSpent;
            } catch {}
        }

        uint256 tokensToPool = LaunchToken(token).balanceOf(address(this));
        LaunchToken(token).transfer(address(graduationHandler), tokensToPool);
        graduationHandler.onGraduation{value: ethToPool}(token, tokensToPool);
        emit Graduated(token, ethToPool, tokensToPool, renewalSpent);
    }

    /// @dev Accepts only the factory's refund of an unspent renewal budget.
    receive() external payable {
        require(msg.sender == factory, "no direct eth");
    }

    function _safeSendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "eth send failed");
    }
}
