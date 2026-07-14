// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title CommentBoard — ultra-cheap on-chain social layer for launched tokens
/// @notice Comments are emitted as EVENTS only, never stored in contract
///         storage, so posting costs ~1 log (a few thousand gas) instead of
///         ~20k+ per SSTORE. Frontends read the feed with eth_getLogs /
///         queryFilter, filtered by the indexed `token`. Identity (the
///         author's .hood name) is resolved client-side from the registrar,
///         so nothing about names needs to be stored here either.
///
///         Anti-spam: a per-author cooldown (one small storage slot) rate
///         limits posting without making the common path expensive. The
///         frontend gates posting behind wallet sign-in; on-chain, the only
///         requirement is the cooldown, because a signature check would cost
///         more than it saves for a public board.
contract CommentBoard {
    uint256 public immutable cooldown; // seconds between posts per author
    mapping(address => uint256) public lastPostAt;

    event Comment(address indexed token, address indexed author, string text, uint256 timestamp);

    constructor(uint256 cooldown_) {
        cooldown = cooldown_;
    }

    function post(address token, string calldata text) external {
        require(bytes(text).length > 0 && bytes(text).length <= 280, "bad length");
        require(block.timestamp >= lastPostAt[msg.sender] + cooldown, "slow down");
        lastPostAt[msg.sender] = block.timestamp;
        emit Comment(token, msg.sender, text, block.timestamp);
    }
}
