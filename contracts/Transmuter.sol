// SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./ConditionalTokenERC20.sol";
import "./interfaces/IConditionalTokens.sol";

contract Transmuter {
    IConditionalTokens private immutable _conditionalTokens;

    mapping(uint256 => ConditionalTokenERC20) private _tokens;

    event ConditionalTokenRegistration(uint256 indexed positionId, ConditionalTokenERC20 token);

    constructor(IConditionalTokens conditionalTokens) {
        _conditionalTokens = conditionalTokens;
    }

    function getConditionalTokens() external view returns (IConditionalTokens) {
        return _conditionalTokens;
    }

    function getToken(uint256 positionId) external view returns (ConditionalTokenERC20) {
        return _tokens[positionId];
    }

    function register(
        bytes32 conditionId,
        IERC20 collateralToken,
        uint256 indexSet,
        string memory name,
        string memory symbol
    ) external returns (ConditionalTokenERC20) {
        uint256 outcomeCount = _conditionalTokens.getOutcomeSlotCount(conditionId);
        require(outcomeCount > 0, "condition not prepared");

        uint256 fullIndexSet = (1 << outcomeCount) - 1;
        require(indexSet > 0 && indexSet < fullIndexSet, "invalid index set");

        bytes32 collectionId = _conditionalTokens.getCollectionId(bytes32(0), conditionId, indexSet);
        uint256 positionId = _conditionalTokens.getPositionId(collateralToken, collectionId);
        return _register(
            positionId,
            name,
            symbol,
            ERC20(address(collateralToken)).decimals()
        );
    }

    function registerBasicPartitionForCondition(
        bytes32 conditionId,
        IERC20 collateralToken,
        string[] memory names,
        string[] memory symbols
    ) external returns (ConditionalTokenERC20[] memory) {
        // We do not need to check whether the condition has been prepared, because if the outcome
        // count is zero, then no registrations occur.
        uint256 outcomeCount = _conditionalTokens.getOutcomeSlotCount(conditionId);
        require(names.length == outcomeCount, "incorrect length names array");
        require(symbols.length == outcomeCount, "incorrect length symbols array");

        uint8 decimals = ERC20(address(collateralToken)).decimals();

        uint256 indexSet = 1;
        ConditionalTokenERC20[] memory tokens = new ConditionalTokenERC20[](outcomeCount);
        for (uint8 i = 0; i < outcomeCount; i++) {
            // Shift index set for each outcome to represent a basic outcome collection
            // (e.g. 0b001, 0b010, 0b100)
            indexSet = 1 << i;

            bytes32 collectionId = _conditionalTokens.getCollectionId(bytes32(0), conditionId, indexSet);
            uint256 positionId = _conditionalTokens.getPositionId(collateralToken, collectionId);
            tokens[i] = _register(positionId, names[i], symbols[i], decimals);
        }

        return tokens;
    }

    function _register(
        uint256 positionId,
        string memory name,
        string memory symbol,
        uint8 decimals
    ) internal returns (ConditionalTokenERC20) {
        require(address(_tokens[positionId]) == address(0), "positionId already registered");

        ConditionalTokenERC20 token = new ConditionalTokenERC20(
            _conditionalTokens,
            positionId,
            name,
            symbol,
            decimals
        );
        _tokens[positionId] = token;
        
        emit ConditionalTokenRegistration(positionId, token);
        return token;
    }
}
