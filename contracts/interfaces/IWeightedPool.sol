// SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;
import "./IVault.sol";

interface IWeightedPool {
    enum JoinKind { INIT, EXACT_TOKENS_IN_FOR_BPT_OUT, TOKEN_IN_FOR_EXACT_BPT_OUT }
    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, EXACT_BPT_IN_FOR_TOKENS_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT }

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function getOwner() external view returns (address);
    function getVault() external view returns (IVault);
    function getPoolId() external view returns (bytes32);
    function getSwapFeePercentage() external view returns (uint256);
    function getNormalizedWeights() external view returns (uint256[] memory);
}