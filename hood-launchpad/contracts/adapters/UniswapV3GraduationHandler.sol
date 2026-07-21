// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IGraduationHandler} from "../BondingCurve.sol";
import {IWETH9, INonfungiblePositionManager} from "../interfaces/IUniswapV3.sol";

/// @title UniswapV3GraduationHandler — seed a v3 (Uniswap or SushiSwap CLAMM)
///        pool and burn the LP
/// @notice The production graduation handler. When a token graduates, the curve
///         sends it the raised ETH + the reserved tokens; this contract wraps
///         the ETH, creates/initializes the token/WETH pool at the graduation
///         price, mints a single full-range liquidity position, and **burns the
///         position NFT** (sends it to 0x…dEaD) so the liquidity is locked
///         forever — the rug-proof graduation.
///
///         DEX-agnostic: `positionManager` is any Uniswap-v3-compatible
///         NonfungiblePositionManager. SushiSwap CLAMM (SushiSwap V3) is a
///         direct Uniswap v3 fork — identical `createAndInitializePoolIfNecessary`
///         + `mint(MintParams)` ABI and the same 0.3% fee tier / 60 tick spacing —
///         so this handler works unchanged against Sushi's periphery. Pick the
///         venue by the addresses you pass in: Uniswap v3 *or* SushiSwap CLAMM,
///         whichever is deployed on Robinhood Chain.
///
///         ┌───────────────────────── INTEGRATION NOTE ────────────────────────┐
///         │ Wire `positionManager` + `weth` to the real v3 deployment on       │
///         │ Robinhood Chain — Uniswap v3 OR SushiSwap CLAMM (docs.sushi.com/   │
///         │ contracts/clamm) — then FORK-TEST a full graduation against the    │
///         │ live periphery before mainnet. The sqrtPrice/tick math here is     │
///         │ unit-tested against known Uniswap vectors, but the end-to-end mint │
///         │ must be verified against the real NonfungiblePositionManager.      │
///         └────────────────────────────────────────────────────────────────────┘
contract UniswapV3GraduationHandler is IGraduationHandler {
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    int24 internal constant TICK_LOWER = -887220; // full range for 60-spacing (0.3% fee)
    int24 internal constant TICK_UPPER = 887220;

    INonfungiblePositionManager public immutable positionManager;
    IWETH9 public immutable weth;
    uint24 public immutable fee;
    address public immutable owner;
    address public treasury; // receives any leftover dust from minting

    address public curve; // the only address allowed to trigger graduation
    bool private curveSet;

    event Graduated(address indexed token, address pool, uint256 tokenId, uint256 ethIn, uint256 tokenIn);

    constructor(INonfungiblePositionManager positionManager_, IWETH9 weth_, uint24 fee_, address treasury_) {
        require(fee_ == 3000, "handler tuned for 0.3% fee"); // ticks above match 60-spacing
        positionManager = positionManager_;
        weth = weth_;
        fee = fee_;
        owner = msg.sender;
        treasury = treasury_;
    }

    /// @notice One-time: authorize the bonding curve that may call onGraduation.
    ///         (The curve is created by the factory after this handler exists,
    ///         so its address is wired in right after deployment.)
    function setCurve(address curve_) external {
        require(msg.sender == owner, "only owner");
        require(!curveSet, "curve already set");
        curve = curve_;
        curveSet = true;
    }

    function setTreasury(address treasury_) external {
        require(msg.sender == owner, "only owner");
        treasury = treasury_;
    }

    /// @notice Called by the curve at graduation with ETH (msg.value) and after
    ///         transferring `tokenAmount` of `token` to this contract.
    function onGraduation(address token, uint256 tokenAmount) external payable {
        require(msg.sender == curve, "only curve");
        uint256 ethAmount = msg.value;
        require(ethAmount > 0 && tokenAmount > 0, "empty graduation");

        weth.deposit{value: ethAmount}();

        (address token0, address token1, uint256 amount0, uint256 amount1) =
            token < address(weth)
                ? (token, address(weth), tokenAmount, ethAmount)
                : (address(weth), token, ethAmount, tokenAmount);

        uint160 sqrtPriceX96 = _sqrtPriceX96(amount0, amount1);
        address pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, fee, sqrtPriceX96);

        _approve(token0, amount0);
        _approve(token1, amount1);

        (uint256 tokenId,,,) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: fee,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );

        // Burn the LP: send the position NFT to the dead address — liquidity
        // can never be withdrawn. This is the rug-proof guarantee.
        positionManager.transferFrom(address(this), BURN, tokenId);

        // Sweep any un-deposited dust to the treasury.
        _sweep(token);
        _sweep(address(weth));

        emit Graduated(token, pool, tokenId, ethAmount, tokenAmount);
    }

    function _approve(address t, uint256 amount) internal {
        (bool ok,) = t.call(abi.encodeWithSignature("approve(address,uint256)", address(positionManager), amount));
        require(ok, "approve failed");
    }

    function _sweep(address t) internal {
        (bool ok, bytes memory data) = t.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!ok || data.length < 32) return;
        uint256 bal = abi.decode(data, (uint256));
        if (bal > 0 && treasury != address(0)) {
            t.call(abi.encodeWithSignature("transfer(address,uint256)", treasury, bal));
        }
    }

    /// @notice Preview the pool's initial sqrtPriceX96 for given reserves —
    ///         useful for frontends and for verifying the price math.
    function previewSqrtPriceX96(uint256 amount0, uint256 amount1) external pure returns (uint160) {
        return _sqrtPriceX96(amount0, amount1);
    }

    /// @dev sqrtPriceX96 = sqrt(amount1 / amount0) * 2**96, computed without
    ///      overflow as sqrt(mulDiv(amount1, 2**192, amount0)). Uniswap's
    ///      encodePriceSqrt(reserve1, reserve0).
    function _sqrtPriceX96(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        uint256 ratioX192 = _mulDiv(amount1, 1 << 192, amount0);
        uint256 s = _sqrt(ratioX192);
        require(s <= type(uint160).max, "price overflow");
        return uint160(s);
    }

    // ---- Babylonian integer square root ----
    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    // ---- FullMath.mulDiv (512-bit) — Uniswap v3 / Remco Bloemen ----
    function _mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                require(denominator > 0);
                assembly {
                    result := div(prod0, denominator)
                }
                return result;
            }
            require(denominator > prod1);

            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            uint256 twos = denominator & (~denominator + 1);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;

            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;

            result = prod0 * inverse;
            return result;
        }
    }
}
