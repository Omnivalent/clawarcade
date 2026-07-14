// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title INameRegistrar — provider-agnostic adapter for .hood name services
/// @notice The launchpad never talks to a specific .hood provider directly.
///         Each provider (hood.ag, hood.domains, hoodns.xyz, ...) gets its own
///         adapter implementing this interface, and the active adapter can be
///         swapped by governance before launch. This lets us build and demo the
///         entire launchpad before signing with any provider — and switch if
///         the namespace war resolves differently than expected.
///
///         Providers that use commit-reveal registration (e.g. hood.ag) handle
///         the commit step inside their adapter; the launchpad frontend calls
///         `commit` ahead of `launch` so the reveal is ready by launch time.
interface INameRegistrar {
    /// @notice True if `label` (the part before .hood) can still be registered.
    function available(string calldata label) external view returns (bool);

    /// @notice Registration price in wei for `label` for `durationYears`.
    function priceOf(string calldata label, uint256 durationYears) external view returns (uint256);

    /// @notice Submit a commitment for front-running-resistant registration.
    /// @dev No-op for providers without commit-reveal.
    function commit(bytes32 commitment) external;

    /// @notice Register `label`.hood, set its resolver record to `resolveTo`
    ///         (the token contract) and transfer name ownership to `owner`
    ///         (the launchpad's NameLocker so the record can never be re-pointed).
    function register(
        string calldata label,
        address owner,
        address resolveTo,
        uint256 durationYears,
        bytes32 secret
    ) external payable;
}
