// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {INameRegistrar} from "../interfaces/INameRegistrar.sol";

/// @title MockRegistrar — in-memory .hood registrar for demos and testnets
/// @notice Mirrors the hood.ag model: ENS-style FCFS registration, $5/yr flat
///         for 5+ characters (premium shorter), yearly expiry, renewals.
///         Expired names become available again — on purpose: a dead token
///         frees its name so someone can retry it. Replaced by
///         adapters/HoodAgAdapter.sol at integration time; the launchpad only
///         ever sees INameRegistrar.
contract MockRegistrar is INameRegistrar {
    struct Record {
        address owner;
        address resolveTo;
        uint64 expiry;
    }

    // Rough USD-pegged prices expressed in wei (demo-only; real adapters quote live).
    uint256 public constant PRICE_5PLUS_PER_YEAR = 0.0017 ether; // ~$5/yr
    uint256 public constant PRICE_4_PER_YEAR = 0.017 ether;
    uint256 public constant PRICE_3_PER_YEAR = 0.05 ether;

    mapping(bytes32 => Record) public records;

    event NameRegistered(string label, address indexed owner, address indexed resolveTo, uint256 durationYears);
    event NameRenewed(string label, uint256 durationYears, uint256 newExpiry);

    function available(string calldata label) public view returns (bool) {
        Record storage r = records[keccak256(bytes(label))];
        return r.owner == address(0) || r.expiry < block.timestamp;
    }

    function priceOf(string calldata label, uint256 durationYears) public view returns (uint256) {
        uint256 len = bytes(label).length;
        require(len >= 3, "label too short");
        uint256 perYear = len >= 5 ? PRICE_5PLUS_PER_YEAR : (len == 4 ? PRICE_4_PER_YEAR : PRICE_3_PER_YEAR);
        return perYear * durationYears;
    }

    function expiryOf(string calldata label) external view returns (uint256) {
        return records[keccak256(bytes(label))].expiry;
    }

    function commit(bytes32) external {}

    function register(
        string calldata label,
        address owner,
        address resolveTo,
        uint256 durationYears,
        bytes32
    ) external payable {
        require(available(label), "taken");
        require(durationYears > 0, "zero duration");
        require(msg.value >= priceOf(label, durationYears), "underpaid");
        records[keccak256(bytes(label))] = Record({
            owner: owner,
            resolveTo: resolveTo,
            expiry: uint64(block.timestamp + durationYears * 365 days)
        });
        emit NameRegistered(label, owner, resolveTo, durationYears);
    }

    function renew(string calldata label, uint256 durationYears) external payable {
        Record storage r = records[keccak256(bytes(label))];
        require(r.owner != address(0) && r.expiry >= block.timestamp, "not registered");
        require(durationYears > 0, "zero duration");
        require(msg.value >= priceOf(label, durationYears), "underpaid");
        r.expiry = uint64(uint256(r.expiry) + durationYears * 365 days);
        emit NameRenewed(label, durationYears, r.expiry);
    }

    /// @notice Forward resolution: label => contract address, like an ENS resolver.
    function resolve(string calldata label) external view returns (address) {
        Record storage r = records[keccak256(bytes(label))];
        require(r.owner != address(0) && r.expiry >= block.timestamp, "unregistered");
        return r.resolveTo;
    }
}
