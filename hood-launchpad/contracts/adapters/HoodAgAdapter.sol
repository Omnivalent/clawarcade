// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {INameRegistrar} from "../interfaces/INameRegistrar.sol";

/// @dev hood.ag publishes an ENS-fork stack: an ERC-721 registrar, a resolver,
///      and a commit-reveal registration controller with USD-denominated
///      pricing ($5/yr for 5+ chars). This interface mirrors the standard ENS
///      ETHRegistrarController surface that stack exposes.
///
///      ┌────────────────────── INTEGRATION TODO ─────────────────────────┐
///      │ Before mainnet: pull hood.ag's real contract addresses and ABI  │
///      │ from https://www.hood.ag/llms-full.txt (their machine-readable  │
///      │ contract docs), verify each selector below matches, and confirm │
///      │ the register() call can set the address record + owner in one   │
///      │ tx. Then run a full launch against their testnet/mainnet with a │
///      │ burner wallet before pointing the factory at this adapter.      │
///      └──────────────────────────────────────────────────────────────────┘
interface IHoodController {
    function available(string calldata name) external view returns (bool);
    function rentPrice(string calldata name, uint256 duration)
        external view returns (uint256 base, uint256 premium);
    function commit(bytes32 commitment) external;
    function register(
        string calldata name,
        address owner,
        uint256 duration,
        bytes32 secret,
        address resolver,
        bytes[] calldata data,
        bool reverseRecord
    ) external payable;
    function renew(string calldata name, uint256 duration) external payable;
    function nameExpires(uint256 tokenId) external view returns (uint256);
}

/// @title HoodAgAdapter — INameRegistrar implementation for hood.ag
/// @notice Translates the launchpad's registrar interface onto hood.ag's
///         ENS-fork controller. The factory is always passed as the name
///         owner, and the resolver record is set to the token contract in the
///         registration call itself, so the name is born pointing at the
///         token and custodied by the factory.
contract HoodAgAdapter is INameRegistrar {
    uint256 private constant YEAR = 365 days;

    IHoodController public immutable controller;
    address public immutable resolver;
    address public immutable factory; // only caller allowed to spend

    // setAddr(bytes32 node, address a) — standard ENS public resolver.
    bytes4 private constant SET_ADDR_SELECTOR = 0xd5fa2b00;

    constructor(IHoodController controller_, address resolver_, address factory_) {
        controller = controller_;
        resolver = resolver_;
        factory = factory_;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "only factory");
        _;
    }

    function available(string calldata label) external view returns (bool) {
        return controller.available(label);
    }

    function priceOf(string calldata label, uint256 durationYears) external view returns (uint256) {
        (uint256 base, uint256 premium) = controller.rentPrice(label, durationYears * YEAR);
        return base + premium;
    }

    function expiryOf(string calldata label) external view returns (uint256) {
        return controller.nameExpires(uint256(keccak256(bytes(label))));
    }

    function commit(bytes32 commitment) external {
        controller.commit(commitment);
    }

    function register(
        string calldata label,
        address owner,
        address resolveTo,
        uint256 durationYears,
        bytes32 secret
    ) external payable onlyFactory {
        bytes32 node = _node(label);
        bytes[] memory data = new bytes[](1);
        data[0] = abi.encodeWithSelector(SET_ADDR_SELECTOR, node, resolveTo);
        controller.register{value: msg.value}(
            label, owner, durationYears * YEAR, secret, resolver, data, false
        );
    }

    function renew(string calldata label, uint256 durationYears) external payable onlyFactory {
        controller.renew{value: msg.value}(label, durationYears * YEAR);
    }

    /// @dev ENS namehash for <label>.hood.
    ///      TODO(integration): confirm hood.ag uses standard namehash and the
    ///      "hood" TLD node below matches their registry.
    function _node(string calldata label) internal pure returns (bytes32) {
        bytes32 tld = keccak256(abi.encodePacked(bytes32(0), keccak256("hood")));
        return keccak256(abi.encodePacked(tld, keccak256(bytes(label))));
    }
}
