// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LaunchToken} from "./LaunchToken.sol";
import {BondingCurve, IGraduationHandler} from "./BondingCurve.sol";
import {INameRegistrar} from "./interfaces/INameRegistrar.sol";

/// @title TokenFactory — one-transaction token launch with .hood identity
/// @notice launch() does four things atomically:
///         1. deploys the token via CREATE2 with a caller-supplied salt, and
///            enforces the launchpad's vanity suffix (0x...600d by default) so
///            every token address carries the house signature;
///         2. registers `<label>.hood` through the pluggable registrar adapter,
///            pointing the name at the token and locking ownership in this
///            contract so the record can never be re-pointed (rug-proof name);
///         3. lists the token on the shared bonding curve;
///         4. collects the launch fee (platform fee + name registration cost).
///         Name uniqueness is enforced twice: by the registrar itself (names
///         are ERC-721s, first come first served) and by our local index so a
///         second launch with the same label reverts early and cheaply.
contract TokenFactory {
    address public immutable owner;
    BondingCurve public immutable curve;
    uint256 public immutable platformFee; // flat launch fee in wei
    uint16 public constant VANITY_SUFFIX = 0x600d; // last 2 address bytes
    bool public immutable enforceVanity;
    uint256 public constant NAME_YEARS = 5; // registration paid up front

    INameRegistrar public registrar; // swappable adapter (pre-partnership: mock)

    mapping(bytes32 => address) public tokenByLabel; // keccak(label) => token
    address[] public allTokens;

    event Launched(
        address indexed token,
        address indexed creator,
        string label,
        string name,
        string symbol
    );
    event RegistrarChanged(address indexed registrar);

    constructor(
        address feeRecipient,
        INameRegistrar registrar_,
        IGraduationHandler graduationHandler_,
        uint256 platformFee_,
        uint256 graduationEth_,
        bool enforceVanity_
    ) {
        owner = msg.sender;
        registrar = registrar_;
        platformFee = platformFee_;
        enforceVanity = enforceVanity_;
        curve = new BondingCurve(address(this), feeRecipient, graduationHandler_, graduationEth_);
    }

    /// @param label   the .hood label, e.g. "supercat" for supercat.hood
    /// @param salt    pre-ground off-chain so the CREATE2 address ends in 0x600d
    /// @param secret  reveal secret for commit-reveal registrars (0x0 otherwise)
    function launch(
        string calldata name,
        string calldata symbol,
        string calldata label,
        bytes32 salt,
        bytes32 secret
    ) external payable returns (address token) {
        bytes32 labelHash = keccak256(bytes(label));
        require(tokenByLabel[labelHash] == address(0), "label taken");
        require(registrar.available(label), "name unavailable");

        uint256 namePrice = registrar.priceOf(label, NAME_YEARS);
        require(msg.value >= platformFee + namePrice, "insufficient fee");

        token = address(new LaunchToken{salt: salt}(name, symbol, label, address(curve)));
        if (enforceVanity) {
            require(uint16(uint160(token)) == VANITY_SUFFIX, "vanity suffix mismatch");
        }

        curve.initToken(token);
        registrar.register{value: namePrice}(label, address(this), token, NAME_YEARS, secret);

        tokenByLabel[labelHash] = token;
        allTokens.push(token);
        emit Launched(token, msg.sender, label, name, symbol);
    }

    /// @notice Predict the CREATE2 address for a salt — used by the frontend
    ///         grinder to find a salt whose address ends in the vanity suffix.
    function predictAddress(
        string calldata name,
        string calldata symbol,
        string calldata label,
        bytes32 salt
    ) external view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(LaunchToken).creationCode,
                abi.encode(name, symbol, label, address(curve))
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }

    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    /// @notice Swap the name-service adapter (e.g. mock -> hood.ag adapter).
    function setRegistrar(INameRegistrar registrar_) external {
        require(msg.sender == owner, "only owner");
        registrar = registrar_;
        emit RegistrarChanged(address(registrar_));
    }
}
