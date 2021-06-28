// SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155Holder.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IConditionalTokens.sol";
import "./interfaces/IWeightedPool.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IAsset.sol";
import "./BaseMarket.sol";
import "./ConditionalTokenERC20.sol";

contract BalancerMarket is BaseMarket, ERC1155Holder {
    using SafeMath for uint256;

    bytes32 private immutable _poolId;
    IVault private immutable _vault;

    constructor(
        bytes32 conditionId,
        IConditionalTokens conditionalTokens,
        IERC20 collateralToken,
        IVault vault,
        bytes32 poolId
    ) BaseMarket(conditionId, conditionalTokens, collateralToken) {
        // If poolId does not correspond to a valid pool for the vault, then Balancer will
        // revert with BAL#500.
        vault.getPool(poolId);

        _vault = vault;
        _poolId = poolId;

        (IERC20[] memory poolTokens,,) = vault.getPoolTokens(poolId);
        for (uint8 i = 0; i < poolTokens.length; i++) {
            if (poolTokens[i] != collateralToken) {
                conditionalTokens.setApprovalForAll(address(poolTokens[i]), true);
            }
        }
    }

    function getPoolId() external view returns (bytes32) {
        return _poolId;
    }

    function getVault() external view returns (IVault) {
        return _vault;
    }

    function getPool() external view returns (IWeightedPool) {
        (address pool,) = _vault.getPool(_poolId);
        return IWeightedPool(pool);
    }

    function splitCollateralAndJoin(uint256 collateralAmount, uint256 minBPTAmountOutOnJoin, bool init) external {
        // We require that collateralAmount is divisible by 2 to facilitate accounting
        require(collateralAmount.mod(2) == 0, "collateral amount must be divisible by 2");
        require(
            _collateralToken.transferFrom(msg.sender, address(this), collateralAmount),
            "collateral transfer failed"
        );

        (IERC20[] memory poolTokens,,) = _vault.getPoolTokens(_poolId);

        // The weight of the collateral token is either half of the total weight or very close to
        // it depending on the number of outcome pool tokens. Thus, to minimize price impact across
        // collateral/outcome token pairs, we split half of collateralAmount through all outcome
        // pool token positions (i.e. a basic partition). This split will mint collateralAmount/2
        // conditional tokens for each pool token position.
        uint256 splitAmount = collateralAmount.div(2);
        _collateralToken.approve(address(_conditionalTokens), splitAmount);
        _conditionalTokens.splitPosition(
            _collateralToken,
            bytes32(0),
            _conditionId,
            basicPartition(poolTokens.length - 1),
            splitAmount
        );

        IAsset[] memory poolAssets = new IAsset[](poolTokens.length);
        uint256[] memory maxAmountsIn = new uint256[](poolTokens.length);
        
        // For each outcome pool token, mint splitAmount. This will transfer all of the conditional
        // tokens minted from the split above to the pool token contract for escrow and mint an
        // equal amount of the representative ERC20 conditional tokens.
        // Here we also set token approvals and populate the arguments for the pool join array
        // arguments.
        for (uint8 i = 0; i < poolTokens.length; i++) {
            if (poolTokens[i] != _collateralToken) {
                ConditionalTokenERC20(address(poolTokens[i])).mint(splitAmount);
            }

            poolTokens[i].approve(address(_vault), splitAmount);

            poolAssets[i] = IAsset(address(poolTokens[i]));
            maxAmountsIn[i] = splitAmount;
        }

        bytes memory userData;
        if (init) {
            userData = abi.encode(IWeightedPool.JoinKind.INIT, maxAmountsIn);
        } else {
            userData = abi.encode(
                IWeightedPool.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT,
                maxAmountsIn,
                minBPTAmountOutOnJoin
            );
        }

        IVault.JoinPoolRequest memory joinRequest = IVault.JoinPoolRequest({
            assets: poolAssets,
            maxAmountsIn: maxAmountsIn,
            userData: userData,
            fromInternalBalance: false
        });

        _vault.joinPool(_poolId, address(this), msg.sender, joinRequest);
    }

    function exitAndMergeCollateral(uint256 bptAmount, uint256[] memory minAmountsOutOnExit) external {
        (address pool,) = _vault.getPool(_poolId);
        require(IERC20(pool).transferFrom(msg.sender, address(this), bptAmount));

        (IERC20[] memory poolTokens,,) = _vault.getPoolTokens(_poolId);

        IAsset[] memory poolAssets = new IAsset[](poolTokens.length);
        for (uint8 i = 0; i < poolTokens.length; i++) {
            poolAssets[i] = IAsset(address(poolTokens[i]));
        }

        // Specify the exact BPT amount to burn
        bytes memory userData = abi.encode(
            IWeightedPool.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT,
            bptAmount
        );

        IVault.ExitPoolRequest memory exitRequest = IVault.ExitPoolRequest({
            assets: poolAssets,
            minAmountsOut: minAmountsOutOnExit,
            userData: userData,
            toInternalBalance: false
        });

        // We mark this contract as payable although it is not. The address must be payable for
        // the call to exitPool. This contract assumes that ETH is not a token for the pool.
        _vault.exitPool(_poolId, address(this), payable(address(this)), exitRequest);

        // Determine the minimum non-collateral pool token balance. We require the minimum because
        // the call to mergePositions merges the same amount of conditional tokens across all
        // positions.
        uint256 minPoolTokenBalance = type(uint256).max;
        for (uint8 i = 0; i < poolTokens.length; i++) {
            uint256 poolTokenBalance = poolTokens[i].balanceOf(address(this));
            if (poolTokenBalance < minPoolTokenBalance && poolTokens[i] != _collateralToken) {
                minPoolTokenBalance = poolTokenBalance;
            }
        }

        // Burn the minimum non-collateral pool token balance for each ERC20 conditional token so
        // that we have the underlying conditional tokens available in the contract's balance for
        // the call to mergePositions. Transfer any remaining balance to the message sender.
        for (uint8 i = 0; i < poolTokens.length; i++) {
            if (poolTokens[i] != _collateralToken) {
                ConditionalTokenERC20(address(poolTokens[i])).burn(minPoolTokenBalance);

                uint256 poolTokenBalance = poolTokens[i].balanceOf(address(this));
                if (poolTokenBalance != 0) {
                    poolTokens[i].transfer(msg.sender, poolTokenBalance);
                }
            }
        }

        // Merge the minimum non-collateral pool token balance to receive this amount of collateral
        // from the ConditionalTokens contract. Transfer all outstanding collateral token balance to
        // the message sender. This balance should be equal to the sum of the amount received from
        // the pool exit and the minimum non-collateral pool token balance.
        _conditionalTokens.mergePositions(
            _collateralToken,
            bytes32(0),
            _conditionId,
            basicPartition(poolTokens.length - 1),
            minPoolTokenBalance
        );
        _collateralToken.transfer(msg.sender, _collateralToken.balanceOf(address(this)));
    }

    function redeemConditionalTokens() external {
        (IERC20[] memory poolTokens,,) = _vault.getPoolTokens(_poolId);
        for (uint8 i = 0; i < poolTokens.length; i++) {
            if (poolTokens[i] != _collateralToken) {
                uint256 poolTokenBalance = poolTokens[i].balanceOf(msg.sender);
                if (poolTokenBalance > 0) {
                    require(
                        poolTokens[i].transferFrom(msg.sender, address(this), poolTokenBalance),
                        "pool token transfer failed"
                    );
                    ConditionalTokenERC20(address(poolTokens[i])).burn(poolTokenBalance);
                }
            }
        }

        uint256[] memory indexSets = basicPartition(poolTokens.length - 1);
        _conditionalTokens.redeemPositions(_collateralToken, bytes32(0), _conditionId, indexSets);
        _collateralToken.transfer(msg.sender, _collateralToken.balanceOf(address(this)));
    }

    function basicPartition(uint256 outcomeCount) private pure returns (uint256[] memory) {
        uint256[] memory partition = new uint256[](outcomeCount);
        for (uint8 i = 0; i < outcomeCount; i++) {
            partition[i] = 1 << i;
        }
        return partition;
    }
}
