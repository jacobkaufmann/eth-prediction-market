// SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IConditionalTokens.sol";

contract Oracle is Ownable {
    IConditionalTokens private immutable _conditionalTokens;

    mapping(bytes32 => uint32) private _resolutionTimestamps;

    event ConditionRegistration(
        bytes32 indexed questionId,
        bytes32 indexed conditionId,
        uint32 resolutionTimestamp
    );

    constructor(IConditionalTokens conditionalTokens) {
        _conditionalTokens = conditionalTokens;
    }

    function getConditionalTokens() external view returns (IConditionalTokens) {
        return _conditionalTokens;
    }

    function getResolutionTimestamp(bytes32 questionId) external view returns (uint32) {
        return _resolutionTimestamps[questionId];
    }
	
    function register(bytes32 questionId, uint256 outcomeCount, uint32 resolutionTimestamp) external onlyOwner {
        // Determine the condition ID that would exist if this condition were prepared with this
        // contract as the oracle.
        bytes32 conditionId = _conditionalTokens.getConditionId(address(this), questionId, outcomeCount);

        // We do not need to check the value of outcomeCount because those checks are performed
        // when the condition is prepared. If outcomeCount is invalid, the condition will not be
        // prepared.
        require(_conditionalTokens.getOutcomeSlotCount(conditionId) != 0, "condition not prepared");
        require(_conditionalTokens.payoutDenominator(conditionId) == 0, "condition already resolved");
        require(_resolutionTimestamps[questionId] == 0, "question already registered");
        require(resolutionTimestamp > block.timestamp, "resolution timestamp must be in the future");

        _resolutionTimestamps[questionId] = resolutionTimestamp;
        emit ConditionRegistration(questionId, conditionId, resolutionTimestamp);
    }

    function resolve(bytes32 questionId, uint256[] calldata payouts) external onlyOwner {
        require(_resolutionTimestamps[questionId] != 0, "question not registered");
        require(_resolutionTimestamps[questionId] < block.timestamp, "resolution timestamp not reached");

        _conditionalTokens.reportPayouts(questionId, payouts);
    }
}