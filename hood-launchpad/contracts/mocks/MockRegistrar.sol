// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {INameRegistrar} from "../interfaces/INameRegistrar.sol";

/// @title MockRegistrar — in-memory .hood registrar for demos and testnets
/// @notice Mirrors the hood.ag pricing model ($5/yr flat for 5+ characters,
///         premium for shorter) so launch-fee UX can be built and demoed before
///         any provider partnership. Replaced by a real adapter at integration
///         time; the launchpad only ever sees INameRegistrar.
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

    function available(string calldata label) public view returns (bool) {
        bytes32 node = keccak256(bytes(label));
        return records[node].owner == address(0) || records[node].expiry < block.timestamp;
    }

    function priceOf(string calldata label, uint256 durationYears) public view returns (uint256) {
        uint256 len = bytes(label).length;
        require(len >= 3, "label too short");
        uint256 perYear = len >= 5 ? PRICE_5PLUS_PER_YEAR : (len == 4 ? PRICE_4_PER_YEAR : PRICE_3_PER_YEAR);
        return perYear * durationYears;
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
        require(msg.value >= priceOf(label, durationYears), "underpaid");
        records[keccak256(bytes(label))] = Record({
            owner: owner,
            resolveTo: resolveTo,
            expiry: uint64(block.timestamp + durationYears * 365 days)
        });
        emit NameRegistered(label, owner, resolveTo, durationYears);
    }

    /// @notice Forward resolution: label => contract address, like an ENS resolver.
    function resolve(string calldata label) external view returns (address) {
        Record storage r = records[keccak256(bytes(label))];
        require(r.owner != address(0) && r.expiry >= block.timestamp, "unregistered");
        return r.resolveTo;
    }
}
