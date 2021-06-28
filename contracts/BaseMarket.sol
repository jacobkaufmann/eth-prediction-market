// SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IConditionalTokens.sol";
import "./Transmuter.sol";

abstract contract BaseMarket  {
    bytes32 internal immutable _conditionId;
    IConditionalTokens internal immutable _conditionalTokens;
    IERC20 internal immutable _collateralToken;

    constructor(
        bytes32 conditionId,
        IConditionalTokens conditionalTokens,
        IERC20 collateralToken
    ) {
        _conditionId = conditionId;
        _conditionalTokens = conditionalTokens;
        _collateralToken = collateralToken;
    }

    function getConditionId() external view returns (bytes32) {
        return _conditionId;
    }

    function getConditionalTokens() external view returns (IConditionalTokens) {
        return _conditionalTokens;
    }

    function getCollateralToken() external view returns (IERC20) {
        return _collateralToken;
    }
}