// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {INonfungiblePositionManager} from "../interfaces/IUniswapV3.sol";

/// @dev Minimal ERC-20 for tests (mintable).
contract MockERC20 {
    string public name; string public symbol; uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    constructor(string memory n, string memory s) { name = n; symbol = s; }
    function mint(address to, uint256 v) external { balanceOf[to] += v; }
    function approve(address sp, uint256 v) external returns (bool) { allowance[msg.sender][sp] = v; return true; }
    function transfer(address to, uint256 v) external returns (bool) { balanceOf[msg.sender] -= v; balanceOf[to] += v; return true; }
    function transferFrom(address f, address t, uint256 v) external returns (bool) {
        uint256 a = allowance[f][msg.sender];
        if (a != type(uint256).max) allowance[f][msg.sender] = a - v;
        balanceOf[f] -= v; balanceOf[t] += v; return true;
    }
}

/// @dev Minimal WETH9 for tests.
contract MockWETH9 is MockERC20 {
    constructor() MockERC20("Wrapped ETH", "WETH") {}
    function deposit() external payable { balanceOf[msg.sender] += msg.value; }
}

/// @dev Minimal Uniswap v3 NonfungiblePositionManager stand-in. Records the
///      init price + mint params, pulls the desired token amounts (exercising
///      the handler's approvals), and tracks the position NFT so the handler's
///      burn (transfer to 0x…dEaD) is observable.
contract MockPositionManager {
    uint256 public nextId = 1;
    mapping(uint256 => address) public positionOwner;

    uint160 public lastSqrtPriceX96;
    address public lastToken0; address public lastToken1;
    uint256 public lastAmount0; uint256 public lastAmount1;
    address public lastRecipient;

    function createAndInitializePoolIfNecessary(address t0, address t1, uint24 fee, uint160 sqrtPriceX96)
        external payable returns (address pool)
    {
        lastSqrtPriceX96 = sqrtPriceX96;
        return address(uint160(uint256(keccak256(abi.encode(t0, t1, fee)))));
    }

    function mint(INonfungiblePositionManager.MintParams calldata p)
        external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        // pull tokens like the real NPM does (requires the handler's approval)
        _pull(p.token0, msg.sender, p.amount0Desired);
        _pull(p.token1, msg.sender, p.amount1Desired);
        tokenId = nextId++;
        positionOwner[tokenId] = p.recipient;
        lastToken0 = p.token0; lastToken1 = p.token1;
        lastAmount0 = p.amount0Desired; lastAmount1 = p.amount1Desired;
        lastRecipient = p.recipient;
        return (tokenId, 1e6, p.amount0Desired, p.amount1Desired);
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(positionOwner[tokenId] == from, "not owner");
        require(msg.sender == from, "not authorized");
        positionOwner[tokenId] = to;
    }

    function _pull(address token, address from, uint256 amount) internal {
        (bool ok,) = token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", from, address(this), amount));
        require(ok, "pull failed");
    }
}
