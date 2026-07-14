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

/// @title BondingCurve — singleton constant-product curve for all launchpad tokens
/// @notice pump.fun-style virtual-reserve AMM. Each token starts with virtual
///         reserves so day-one buys are cheap and the creator posts zero
///         liquidity. When a curve accumulates `graduationEth` of real ETH it
///         graduates: ETH + the 200M reserved tokens are handed to the
///         graduation handler to seed a Uniswap pool with burned LP.
contract BondingCurve {
    uint256 public constant FEE_BPS = 100; // 1% on buys and sells
    uint256 public constant CURVE_SUPPLY = 800_000_000e18; // sellable on curve
    uint256 public constant LP_RESERVE = 200_000_000e18; // held for graduation pool
    uint256 public constant VIRTUAL_ETH_0 = 1 ether;
    uint256 public constant VIRTUAL_TOKEN_0 = 1_073_000_000e18;

    address public immutable factory;
    address public immutable feeRecipient;
    IGraduationHandler public immutable graduationHandler;
    uint256 public immutable graduationEth; // real ETH that triggers graduation

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
    event Graduated(address indexed token, uint256 ethToPool, uint256 tokensToPool);

    modifier lock() {
        require(unlocked == 1, "reentrancy");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor(address factory_, address feeRecipient_, IGraduationHandler handler_, uint256 graduationEth_) {
        factory = factory_;
        feeRecipient = feeRecipient_;
        graduationHandler = handler_;
        graduationEth = graduationEth_;
    }

    /// @notice Called once per token by the factory at launch.
    function initToken(address token) external {
        require(msg.sender == factory, "only factory");
        require(!curves[token].exists, "already listed");
        curves[token] = Curve({
            virtualEth: uint128(VIRTUAL_ETH_0),
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

    /// @notice Spot quote: tokens received for `ethIn` (after fee), pre-trade.
    function quoteBuy(address token, uint256 ethIn) public view returns (uint256 tokensOut) {
        Curve storage c = curves[token];
        require(c.exists && !c.graduated, "not tradable");
        uint256 ethAfterFee = ethIn - (ethIn * FEE_BPS) / 10_000;
        uint256 k = uint256(c.virtualEth) * uint256(c.virtualToken);
        tokensOut = uint256(c.virtualToken) - _ceilDiv(k, uint256(c.virtualEth) + ethAfterFee);
        uint256 remaining = CURVE_SUPPLY - c.tokensSold;
        if (tokensOut > remaining) tokensOut = remaining;
    }

    /// @notice ETH received for selling `tokensIn` (after fee), pre-trade.
    function quoteSell(address token, uint256 tokensIn) public view returns (uint256 ethOut) {
        Curve storage c = curves[token];
        require(c.exists && !c.graduated, "not tradable");
        uint256 k = uint256(c.virtualEth) * uint256(c.virtualToken);
        uint256 grossEth = uint256(c.virtualEth) - _ceilDiv(k, uint256(c.virtualToken) + tokensIn);
        ethOut = grossEth - (grossEth * FEE_BPS) / 10_000;
    }

    /// @notice Buy on the curve. If the purchase would exceed the sellable
    ///         supply it is clamped to the remainder, unused ETH is refunded,
    ///         and the curve graduates. Graduation also triggers on hitting
    ///         `graduationEth` of real ETH, whichever comes first.
    function buy(address token, uint256 minTokensOut) external payable lock returns (uint256 tokensOut) {
        Curve storage c = curves[token];
        require(c.exists && !c.graduated, "not tradable");
        require(msg.value > 0, "zero eth");

        uint256 fee = (msg.value * FEE_BPS) / 10_000;
        uint256 ethIn = msg.value - fee;
        uint256 refund = 0;

        uint256 k = uint256(c.virtualEth) * uint256(c.virtualToken);
        tokensOut = uint256(c.virtualToken) - _ceilDiv(k, uint256(c.virtualEth) + ethIn);

        uint256 remaining = CURVE_SUPPLY - c.tokensSold;
        require(remaining > 0, "sold out");
        if (tokensOut > remaining) {
            tokensOut = remaining;
            uint256 ethNeeded = _ceilDiv(k, uint256(c.virtualToken) - tokensOut) - uint256(c.virtualEth);
            refund = ethIn - ethNeeded;
            ethIn = ethNeeded;
        }
        require(tokensOut >= minTokensOut, "slippage");

        c.virtualEth += uint128(ethIn);
        c.virtualToken -= uint128(tokensOut);
        c.realEth += uint128(ethIn);
        c.tokensSold += uint128(tokensOut);

        LaunchToken(token).transfer(msg.sender, tokensOut);
        _safeSendEth(feeRecipient, fee);
        if (refund > 0) _safeSendEth(msg.sender, refund);
        emit Buy(token, msg.sender, msg.value - refund, tokensOut, fee);

        if (c.realEth >= graduationEth || c.tokensSold == CURVE_SUPPLY) _graduate(token, c);
    }

    function sell(address token, uint256 tokensIn, uint256 minEthOut) external lock returns (uint256 ethOut) {
        Curve storage c = curves[token];
        require(c.exists && !c.graduated, "not tradable");
        require(tokensIn > 0, "zero tokens");

        uint256 k = uint256(c.virtualEth) * uint256(c.virtualToken);
        uint256 grossEth = uint256(c.virtualEth) - _ceilDiv(k, uint256(c.virtualToken) + tokensIn);
        uint256 fee = (grossEth * FEE_BPS) / 10_000;
        ethOut = grossEth - fee;
        require(ethOut >= minEthOut, "slippage");
        require(grossEth <= c.realEth, "exceeds reserves");

        c.virtualEth -= uint128(grossEth);
        c.virtualToken += uint128(tokensIn);
        c.realEth -= uint128(grossEth);
        c.tokensSold -= uint128(tokensIn);

        LaunchToken(token).transferFrom(msg.sender, address(this), tokensIn);
        _safeSendEth(msg.sender, ethOut);
        _safeSendEth(feeRecipient, fee);
        emit Sell(token, msg.sender, tokensIn, ethOut, fee);
    }

    /// @dev Hands real ETH + unsold curve tokens + LP reserve to the handler.
    function _graduate(address token, Curve storage c) internal {
        c.graduated = true;
        uint256 ethToPool = c.realEth;
        uint256 tokensToPool = LaunchToken(token).balanceOf(address(this));
        LaunchToken(token).transfer(address(graduationHandler), tokensToPool);
        graduationHandler.onGraduation{value: ethToPool}(token, tokensToPool);
        emit Graduated(token, ethToPool, tokensToPool);
    }

    function _safeSendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "eth send failed");
    }
}
