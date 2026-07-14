// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title INameRegistrar — provider-agnostic adapter for .hood name services
/// @notice The launchpad never talks to a specific .hood provider directly.
///         Each provider (hood.ag, hood.domains, ...) gets its own adapter
///         implementing this interface; the active adapter is swappable. The
///         production target is hood.ag (ENS-fork registrar + resolver with
///         commit-reveal); see adapters/HoodAgAdapter.sol.
///
///         Lifecycle used by the launchpad:
///         - launch: register for 1 year (cheap; a failed token frees its
///           name after a year so the community gets another shot at it)
///         - graduation: renew for 5 more years, paid from the raise
///         - expiry: the registrar reports the name available again and the
///           factory allows a fresh launch under the same label.
interface INameRegistrar {
    /// @notice True if `label` (the part before .hood) can be registered now,
    ///         including names whose previous registration has expired.
    function available(string calldata label) external view returns (bool);

    /// @notice Registration/renewal price in wei for `durationYears`.
    function priceOf(string calldata label, uint256 durationYears) external view returns (uint256);

    /// @notice Unix timestamp when the current registration lapses (0 if none).
    function expiryOf(string calldata label) external view returns (uint256);

    /// @notice Submit a commitment for front-running-resistant registration.
    /// @dev No-op for providers without commit-reveal.
    function commit(bytes32 commitment) external;

    /// @notice Register `label`.hood, set its resolver record to `resolveTo`
    ///         (the token contract) and assign name ownership to `owner`
    ///         (the factory, so the record can never be re-pointed).
    function register(
        string calldata label,
        address owner,
        address resolveTo,
        uint256 durationYears,
        bytes32 secret
    ) external payable;

    /// @notice Extend the current registration of `label` by `durationYears`.
    function renew(string calldata label, uint256 durationYears) external payable;
}
