// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IGraduationHandler} from "../BondingCurve.sol";

/// @title GraduationEscrow — placeholder graduation handler
/// @notice Holds graduated ETH + tokens and emits an event. The production
///         handler replaces this with: create Uniswap v3 pool on Robinhood
///         Chain, seed full range liquidity, burn the LP NFT. Kept separate so
///         the curve contract never needs to change when the venue does.
contract GraduationEscrow is IGraduationHandler {
    event GraduationReceived(address indexed token, uint256 ethAmount, uint256 tokenAmount);

    function onGraduation(address token, uint256 tokenAmount) external payable {
        emit GraduationReceived(token, msg.value, tokenAmount);
    }

    receive() external payable {}
}
