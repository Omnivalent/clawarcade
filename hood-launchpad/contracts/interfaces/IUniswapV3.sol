// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev Minimal Uniswap v3 periphery interfaces the graduation handler needs.
///      The NonfungiblePositionManager is itself an ERC-721 (positions are
///      NFTs), so it also exposes transferFrom for burning the LP position.

interface IWETH9 {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    // NPM is an ERC-721 — used to burn (lock) the LP position.
    function transferFrom(address from, address to, uint256 tokenId) external;
}
