// SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./BaseMarketFactory.sol";
import "./Transmuter.sol";
import "./ConditionalTokenERC20.sol";
import "./BalancerMarket.sol";
import "./interfaces/IConditionalTokens.sol";
import "./interfaces/IWeightedPoolFactory.sol";
import "./interfaces/IWeightedPool.sol";

contract BalancerMarketFactory is BaseMarketFactory {
    using SafeMath for uint256;

    uint256 private constant _MAX_TOKENS = 5;
    uint256 private constant _HALF_WEIGHT = 1e18 / 2; // 50%

    IVault private immutable _vault;
    IWeightedPoolFactory private immutable _weightedPoolFactory;

    constructor(
        IConditionalTokens conditionalTokens,
        Transmuter transmuter,
        IVault vault,
        IWeightedPoolFactory weightedPoolFactory
    ) BaseMarketFactory(conditionalTokens, transmuter) {
        _vault = vault;
        _weightedPoolFactory = weightedPoolFactory;
    }

    function getVault() external view returns (IVault) {
        return _vault;
    }

    function getWeightedPoolFactory() external view returns (IWeightedPoolFactory) {
        return _weightedPoolFactory;
    }

    function create(
        string memory name,
        string memory symbol,
        bytes32 conditionId,
        IERC20 collateralToken,
        uint256 fee
    ) external returns (address) {
        uint256 outcomeCount = _conditionalTokens.getOutcomeSlotCount(conditionId);

        require(outcomeCount > 0, "condition not prepared");
        require(outcomeCount < _MAX_TOKENS, "condition has too many outcome slots");

        IERC20[] memory poolTokens = new IERC20[](outcomeCount + 1);

        // Add each conditional token to pool token array
        uint256 indexSet = 1;
        for (uint8 i = 0; i < outcomeCount; i++) {
            // Shift index set for each outcome to represent a basic outcome collection
            // (e.g. 0b001, 0b010, 0b100)
            indexSet = 1 << i;

            // Determine position ID for each outcome
            bytes32 collectionId = _conditionalTokens.getCollectionId(bytes32(0), conditionId, indexSet);
            uint256 positionId = _conditionalTokens.getPositionId(collateralToken, collectionId);

            // Retrieve the conditional token ERC20
            ConditionalTokenERC20 conditionalToken = _transmuter.getToken(positionId);
            require(address(conditionalToken) != address(0), "conditional token not registered");

            poolTokens[i] = IERC20(conditionalToken);
        }

        // Add the collateral token to the pool token array
        poolTokens[outcomeCount] = collateralToken;

        // Sort the pool token array by address
        // Balancer pools require that the token array is sorted by address
        _sortTokensByAddress(poolTokens);

        // Hold the pool token weights for the Balancer pool
        uint256[] memory weights = new uint256[](poolTokens.length);

        // Give half of all weight (plus possible remainder) to collateral
        // Split half of all weight evenly among conditional tokens
        uint256 remainder = _HALF_WEIGHT.mod(outcomeCount);
        for (uint8 i = 0; i < poolTokens.length; i++) {
            if (address(poolTokens[i]) != address(collateralToken)) {
                weights[i] = _HALF_WEIGHT.div(outcomeCount);
            } else {
                weights[i] = _HALF_WEIGHT.add(remainder);
            }
        }

        // Create Balancer pool
        address pool = _weightedPoolFactory.create(
            name,
            symbol,
            poolTokens,
            weights,
            fee,
            address(0)
        );
        bytes32 poolId = IWeightedPool(pool).getPoolId();

        // Create market
        address market = address(
            new BalancerMarket(
                conditionId,
                _conditionalTokens,
                collateralToken,
                _vault,
                poolId
            )
        );
        _register(market, conditionId);

        return market;
    }

    // In-place insertion sort on address
    function _sortTokensByAddress(IERC20[] memory tokens) internal pure {
        for (uint8 i = 1; i < tokens.length; i++) {
            IERC20 token = tokens[i];

            uint8 j = i - 1;
            while (j >= 0 && j < type(uint8).max && address(tokens[j]) > address(token)) {
                tokens[j+1] = tokens[j];
                j--;
            }

            tokens[j+1] = token;
        }
    }
}