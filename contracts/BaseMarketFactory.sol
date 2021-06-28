// SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IConditionalTokens.sol";
import "./Transmuter.sol";

abstract contract BaseMarketFactory {
    mapping (address => bool) private _markets;

    IConditionalTokens internal immutable _conditionalTokens;
    Transmuter internal immutable _transmuter;

    event MarketCreation(address indexed market, bytes32 indexed conditionId);

    constructor(IConditionalTokens conditionalTokens, Transmuter transmuter) {
        _conditionalTokens = conditionalTokens;
        _transmuter = transmuter;
    }

    function getConditionalTokens() external view returns (IConditionalTokens) {
        return _conditionalTokens;
    }

    function getTransmuter() external view returns (Transmuter) {
        return _transmuter;
    }

    function isMarketFromFactory(address market) external view returns (bool) {
        return _markets[market];
    } 

    function _register(address market, bytes32 conditionId) internal {
        _markets[market] = true;
        emit MarketCreation(market, conditionId);
    }
}