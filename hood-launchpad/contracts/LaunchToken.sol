// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title LaunchToken — minimal fixed-supply ERC-20 for launchpad tokens
/// @notice Deliberately has NO owner, NO mint, NO pause, NO fee switch, NO
///         allowlist. The entire 1B supply is minted to the bonding curve at
///         construction. There is nothing a creator can do to rug via the
///         token contract itself — that is the trust guarantee the launchpad
///         advertises, so keep this contract boring.
contract LaunchToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public constant totalSupply = 1_000_000_000e18;

    /// @notice The .hood label this token launched under (e.g. "supercat").
    string public hoodLabel;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, string memory hoodLabel_, address curve) {
        name = name_;
        symbol = symbol_;
        hoodLabel = hoodLabel_;
        balanceOf[curve] = totalSupply;
        emit Transfer(address(0), curve, totalSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        return _transfer(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "insufficient allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        return _transfer(from, to, value);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal returns (bool) {
        require(to != address(0), "transfer to zero");
        uint256 bal = balanceOf[from];
        require(bal >= value, "insufficient balance");
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
        return true;
    }
}
