// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IGraduationHandler, BondingCurve} from "../BondingCurve.sol";

/// @title ReentrantHandler — attacker mock for the graduation reentrancy test
/// @notice On receiving the graduation callback it tries to reenter the curve
///         (buy). The curve's global lock is held for the whole graduating
///         trade, so the reentrant call MUST revert; we record that it did.
contract ReentrantHandler is IGraduationHandler {
    BondingCurve public curve;
    address public token;
    bool public reentryAttempted;
    bool public reentryReverted;

    function target(BondingCurve curve_, address token_) external {
        curve = curve_;
        token = token_;
    }

    function onGraduation(address, uint256) external payable {
        reentryAttempted = true;
        try curve.buy{value: 1}(token, 0, type(uint256).max) returns (uint256) {
            reentryReverted = false; // exploit succeeded — should NOT happen
        } catch {
            reentryReverted = true; // lock held — reentrancy correctly blocked
        }
    }

    receive() external payable {}
}
