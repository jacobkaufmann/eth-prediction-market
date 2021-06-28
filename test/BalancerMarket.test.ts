import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract } from "ethers";
import { ethers, waffle } from "hardhat";
import "@nomiclabs/hardhat-waffle";
import Authorizer from "./artifacts/balancer/Authorizer.json";
import Vault from "./artifacts/balancer/Vault.json";
import WeightedPoolFactory from "./artifacts/balancer/WeightedPoolFactory.json";
import { deploy } from "../lib/helpers/deploy";
import {
    BALANCER_MARKET_FEE,
    CONDITIONAL_TOKENS_QUESTION_ID,
    ERC20_COLLATERAL_DECIMALS,
    ERC20_COLLATERAL_NAME,
    ERC20_COLLATERAL_SYMBOL,
    MARKET_NAME,
    MARKET_SYMBOL,
    ZERO_BYTES32
} from "./helpers/constants";
import { revert, takeSnapshot } from "./helpers/snapshot";
import { inReceipt } from "./helpers/expectEvent";
import { expect } from "chai";
import {
    basicIndexSetPartition,
    mintConditionalTokens,
    positionIdsForCondition
} from "./helpers/conditionalTokens";
import { registerPositionIds } from "./helpers/transmuter";
import { JoinKind, joinPool } from "./helpers/balancer";

describe("BalancerMarket", () => {
    const OUTCOME_COUNT = 2;
    const PARTITION = basicIndexSetPartition(OUTCOME_COUNT);

    const CONDITIONAL_TOKEN_NAME = "Condition";
    const CONDITIONAL_TOKEN_SYMBOL = "COND";

    const TRANSFER_AMOUNT = ethers.constants.WeiPerEther.mul(100);

    let owner: SignerWithAddress;
    let oracle: SignerWithAddress;
    let agent: SignerWithAddress;

    let balancerMarketFactory: Contract;
    let balancerMarket: Contract;
    let vault: Contract;
    let authorizer: Contract;
    let weth: Contract;
    let weightedPoolFactory: Contract;
    let conditionalTokens: Contract;
    let collateralToken: Contract;
    let transmuter: Contract;

    let conditionId: Uint8Array;
    let positionIds: BigNumber[];

    before(async () => {
        [owner, oracle, agent] = await ethers.getSigners();

        weth = await deploy("WETH9");

        authorizer = await waffle.deployContract(owner, Authorizer, [owner.address]);
        vault = await waffle.deployContract(owner, Vault, [
            authorizer.address,
            weth.address,
            ethers.constants.Zero,
            ethers.constants.Zero
        ]);
        weightedPoolFactory = await waffle.deployContract(owner, WeightedPoolFactory, [vault.address]);

        conditionalTokens = await deploy("ConditionalTokens");
        await conditionalTokens.prepareCondition(oracle.address, CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT);
        conditionId = await conditionalTokens.getConditionId(oracle.address, CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT);

        collateralToken = await deploy("ERC20MintableBurnable", {
            args: [
                owner.address,
                ERC20_COLLATERAL_NAME,
                ERC20_COLLATERAL_SYMBOL,
                ERC20_COLLATERAL_DECIMALS
            ],
        });

        transmuter = await deploy("Transmuter", { args: [conditionalTokens.address] });

        positionIds = await positionIdsForCondition(
            ethers.utils.hexlify(conditionId),
            OUTCOME_COUNT,
            collateralToken.address,
            ZERO_BYTES32,
            conditionalTokens
        );

        // Register conditional tokens with transmuter
        const names = Array<string>(OUTCOME_COUNT).fill(CONDITIONAL_TOKEN_NAME);
        const symbols = Array<string>(OUTCOME_COUNT).fill(CONDITIONAL_TOKEN_SYMBOL)
        await registerPositionIds(transmuter, conditionId, collateralToken.address, names, symbols);

        balancerMarketFactory = await deploy("BalancerMarketFactory", {
            args: [
                conditionalTokens.address,
                transmuter.address,
                vault.address,
                weightedPoolFactory.address,
            ]
        });
    });

    describe("constructor", () => {
        it("deploys from factory", async () => {
            const receipt = await (await balancerMarketFactory.create(
                MARKET_NAME,
                MARKET_SYMBOL,
                conditionId,
                collateralToken.address,
                BALANCER_MARKET_FEE
            )).wait();
            const event = inReceipt(receipt, "MarketCreation");
            balancerMarket = await ethers.getContractAt("BalancerMarket", event.args.market);
            
            // Verify state variables
            expect(await balancerMarket.getConditionId()).to.equal(conditionId);
            expect(await balancerMarket.getConditionalTokens()).to.equal(conditionalTokens.address);
            expect(await balancerMarket.getCollateralToken()).to.equal(collateralToken.address);
            expect(await balancerMarket.getVault()).to.equal(vault.address);

            // We implicitly verify that the pool is registered with the vault through the retrieval
            // of the pool tokens.
            const poolId = await balancerMarket.getPoolId();
            const [poolTokens,,] = await vault.getPoolTokens(poolId);
            expect(poolTokens.length).to.equal(OUTCOME_COUNT + 1);

            // Verify conditional tokens approvals
            for (let i = 0; i < poolTokens.length; i++) {
                if (poolTokens[i] !== collateralToken.address) {
                    expect(await conditionalTokens.isApprovedForAll(balancerMarket.address, poolTokens[i]))
                        .to.equal(true);
                }
            }
        });
    });

    describe("splitCollateralAndJoin", () => {
        let snapshot: string;
        let poolId: string;
        let poolTokens: string[];

        before(async () => {
            const receipt = await (await balancerMarketFactory.create(
                MARKET_NAME,
                MARKET_SYMBOL,
                conditionId,
                collateralToken.address,
                BALANCER_MARKET_FEE
            )).wait();
            const event = inReceipt(receipt, "MarketCreation");
            balancerMarket = await ethers.getContractAt("BalancerMarket", event.args.market);
            poolId = await balancerMarket.getPoolId();
            [poolTokens,,] = await vault.getPoolTokens(poolId);
        });

        beforeEach(async () => {
            snapshot = await takeSnapshot(waffle.provider);

            await collateralToken.mint(agent.address, TRANSFER_AMOUNT);
            await collateralToken.connect(agent).approve(balancerMarket.address, TRANSFER_AMOUNT);
        });

        afterEach(async () => {
            if (snapshot !== undefined) {
                await revert(waffle.provider, snapshot);
            }
        });

        it("fails require for even collateral amount", async () => {
            await expect(balancerMarket.connect(agent).splitCollateralAndJoin(
                ethers.constants.One,
                ethers.constants.Zero,
                true
            )).to.be.revertedWith("collateral amount must be divisible by 2");
        });

        it("fails require for collateral transfer - insufficient balance", async () => {
            // Add two here because the amount must be even to pass the first require.
            await expect(balancerMarket.connect(agent).splitCollateralAndJoin(
                TRANSFER_AMOUNT.add(2),
                ethers.constants.Zero,
                true
            )).to.be.revertedWith("revert ERC20: transfer amount exceeds balance");
        });

        it("fails require for collateral transfer - insufficient allowance", async () => {
            await collateralToken.connect(agent).approve(balancerMarket.address, TRANSFER_AMOUNT.sub(1));
            await expect(balancerMarket.connect(agent).splitCollateralAndJoin(
                TRANSFER_AMOUNT,
                ethers.constants.Zero,
                true
            )).to.be.revertedWith("revert ERC20: transfer amount exceeds allowance");
        });

        describe("init", () => {
            it("succeeds", async () => {
                await balancerMarket.connect(agent).splitCollateralAndJoin(
                    TRANSFER_AMOUNT,
                    ethers.constants.Zero,
                    true
                );

                // TODO: Verify contract calls once Hardhat adds support
                // https://github.com/nomiclabs/hardhat/issues/1135
                // We can remove reliance on some unclear checks below with checks for contract calls

                // Verify collateral balances
                expect(await collateralToken.balanceOf(agent.address)).to.equal(ethers.constants.Zero);
                expect(await collateralToken.balanceOf(balancerMarket.address)).to.equal(ethers.constants.Zero);

                // Verify pool token balances
                const [,poolTokenBalances,] = await vault.getPoolTokens(poolId);
                for (let i = 0; i < poolTokens.length; i++) {
                    expect(await poolTokenBalances[i]).to.lte(TRANSFER_AMOUNT.div(2));
                }

                // Verify BPT balance
                const bpt = await ethers.getContractAt("ERC20", await balancerMarket.getPool());
                expect(await bpt.balanceOf(agent.address)).to.gt(ethers.constants.Zero);
            });
        });

        describe("non-init", () => {
            const INIT_JOIN_AMOUNT = TRANSFER_AMOUNT;

            before(async () => {
                // Mint pool tokens for liquidity provider
                await collateralToken.mint(owner.address, INIT_JOIN_AMOUNT);
                await collateralToken.connect(owner).approve(vault.address, INIT_JOIN_AMOUNT);
                await mintConditionalTokens(
                    owner,
                    INIT_JOIN_AMOUNT,
                    ZERO_BYTES32,
                    ethers.utils.hexlify(conditionId),
                    PARTITION,
                    conditionalTokens,
                    collateralToken
                );
                for (let i = 0; i < positionIds.length; i++) {
                    const token = await ethers.getContractAt(
                        "ConditionalTokenERC20",
                        await transmuter.getToken(positionIds[i])
                    );
                    await conditionalTokens.connect(owner).setApprovalForAll(token.address, true);
                    await token.connect(owner).approve(vault.address, INIT_JOIN_AMOUNT);
                    await token.connect(owner).mint(INIT_JOIN_AMOUNT);
                }

                // Initialize Balancer pool with liquidity
                const amountsIn = poolTokens.map(() => INIT_JOIN_AMOUNT);
                await joinPool(
                    poolId,
                    poolTokens,
                    amountsIn,
                    ethers.constants.Zero,
                    JoinKind.INIT,
                    owner.address,
                    owner.address,
                    vault
                );
            });
            
            it("succeeds", async () => {
                const minBPTAmountOutOnJoin = ethers.constants.Zero;

                await balancerMarket.connect(agent).splitCollateralAndJoin(
                    TRANSFER_AMOUNT,
                    minBPTAmountOutOnJoin,
                    false
                );

                // TODO: Verify contract calls once Hardhat adds support
                // https://github.com/nomiclabs/hardhat/issues/1135
                // We can remove reliance on some unclear checks below with checks for contract calls

                // Verify collateral balances
                expect(await collateralToken.balanceOf(agent.address)).to.equal(ethers.constants.Zero);
                expect(await collateralToken.balanceOf(balancerMarket.address)).to.equal(ethers.constants.Zero);

                // Verify pool token balances
                const [,poolTokenBalances,] = await vault.getPoolTokens(poolId);
                for (let i = 0; i < poolTokens.length; i++) {
                    // We use the sum of the initialization join amount and the split amount
                    expect(await poolTokenBalances[i]).to.equal(INIT_JOIN_AMOUNT.add(TRANSFER_AMOUNT.div(2)));
                }

                // Verify BPT balance
                const bpt = await ethers.getContractAt("ERC20", await balancerMarket.getPool());
                expect(await bpt.balanceOf(agent.address)).to.gte(minBPTAmountOutOnJoin);
            });

            it("fails require for join - min BPT amount out too high", async () => {
                await expect(balancerMarket.connect(agent).splitCollateralAndJoin(
                    TRANSFER_AMOUNT,
                    ethers.constants.MaxUint256,
                    false
                )).to.be.revertedWith("revert BAL#208");
            });
        });
    });

    describe("ExitAndMergeCollateral", () => {
        let snapshot: string;
        let poolId: string;
        let poolTokens: string[];
        let bpt: Contract;
        let bptAmount: BigNumber;

        before(async () => {
            const receipt = await (await balancerMarketFactory.create(
                MARKET_NAME,
                MARKET_SYMBOL,
                conditionId,
                collateralToken.address,
                BALANCER_MARKET_FEE
            )).wait();
            const event = inReceipt(receipt, "MarketCreation");
            balancerMarket = await ethers.getContractAt("BalancerMarket", event.args.market);
            poolId = await balancerMarket.getPoolId();
            [poolTokens,,] = await vault.getPoolTokens(poolId);
        });

        beforeEach(async () => {
            snapshot = await takeSnapshot(waffle.provider);

            await collateralToken.mint(agent.address, TRANSFER_AMOUNT);
            await collateralToken.connect(agent).approve(balancerMarket.address, TRANSFER_AMOUNT);

            // TODO: Determine whether it is safe to rely on splitCollateralAndJoin function here, or
            // whether we should initialize the pool with liquidity through Balancer directly.
            await balancerMarket.connect(agent).splitCollateralAndJoin(
                TRANSFER_AMOUNT,
                ethers.constants.Zero,
                true
            );

            bpt = await ethers.getContractAt("ERC20", await balancerMarket.getPool());
            bptAmount = await bpt.balanceOf(agent.address);
        });

        afterEach(async () => {
            if (snapshot !== undefined) {
                await revert(waffle.provider, snapshot);
            }
        });

        it("succeeds", async () => {
            const [,poolTokenBalances,] = await vault.getPoolTokens(poolId);

            await bpt.connect(agent).approve(balancerMarket.address, bptAmount);
            const exitAmount = bptAmount.div(2);
            const minAmountsOut = poolTokenBalances.map((balance: BigNumber) => balance.div(3));

            await balancerMarket.connect(agent).exitAndMergeCollateral(exitAmount, minAmountsOut);

            const [,postExitPoolTokenBalances,] = await vault.getPoolTokens(poolId);

            // TODO: Verify contract calls once Hardhat adds support
            // https://github.com/nomiclabs/hardhat/issues/1135
            // We can remove reliance on some unclear checks below with checks for contract calls

            // Verify pool token balances
            for (let i = 0; i < poolTokens.length; i++) {
                expect(postExitPoolTokenBalances[i]).to.lte(poolTokenBalances[i].sub(minAmountsOut[i]));
            }

            // Verify BPT balance
            expect(await bpt.balanceOf(agent.address)).to.equal(bptAmount.sub(exitAmount));

            // Verify collateral balance
            expect(await collateralToken.balanceOf(agent.address)).to.gte(minAmountsOut[0].mul(2));
            expect(await collateralToken.balanceOf(balancerMarket.address)).to.equal(ethers.constants.Zero);
        });

        it("fails require for BPT transfer - insufficient balance", async () => {
            const [,poolTokenBalances,] = await vault.getPoolTokens(poolId);
            await bpt.connect(agent).approve(balancerMarket.address, ethers.constants.MaxUint256);

            // 406: INSUFFICIENT_BALANCE
            await expect(balancerMarket.connect(agent).exitAndMergeCollateral(
                bptAmount.add(1),
                poolTokenBalances
            )).to.be.revertedWith("revert BAL#406");
        });

        it("fails require for BPT transfer - insufficient allowance", async () => {
            const [,poolTokenBalances,] = await vault.getPoolTokens(poolId);
            await bpt.connect(agent).approve(balancerMarket.address, ethers.constants.Zero);

            // 407 INSUFFICIENT_ALLOWANCE
            await expect(balancerMarket.connect(agent).exitAndMergeCollateral(bptAmount, poolTokenBalances))
                .to.be.revertedWith("revert BAL#407");
        });

        it("fails require for join - min amounts out too high", async () => {
            const [,poolTokenBalances,] = await vault.getPoolTokens(poolId);
            await bpt.connect(agent).approve(balancerMarket.address, ethers.constants.MaxUint256);

            // 505 EXIT_BELOW_MIN
            await expect(balancerMarket.connect(agent).exitAndMergeCollateral(
                bptAmount.div(2),
                poolTokenBalances
            )).to.be.revertedWith("revert BAL#505");
        });
    });

    describe("redeemConditionalTokens", () => {
        const PAYOUTS = [1, 0];

        let snapshot: string;

        before(async () => {
            const receipt = await (await balancerMarketFactory.create(
                MARKET_NAME,
                MARKET_SYMBOL,
                conditionId,
                collateralToken.address,
                BALANCER_MARKET_FEE
            )).wait();
            const event = inReceipt(receipt, "MarketCreation");
            balancerMarket = await ethers.getContractAt("BalancerMarket", event.args.market);

            await conditionalTokens.connect(oracle).reportPayouts(
                CONDITIONAL_TOKENS_QUESTION_ID,
                PAYOUTS
            );

            await collateralToken.mint(agent.address, TRANSFER_AMOUNT);
            await mintConditionalTokens(
                agent,
                TRANSFER_AMOUNT,
                ZERO_BYTES32,
                ethers.utils.hexlify(conditionId),
                PARTITION,
                conditionalTokens,
                collateralToken
            );
            for (let i = 0; i < positionIds.length; i++) {
                const token = await ethers.getContractAt(
                    "ConditionalTokenERC20",
                    await transmuter.getToken(positionIds[i])
                );
                await conditionalTokens.connect(agent).setApprovalForAll(token.address, true);
                await token.connect(agent).approve(balancerMarket.address, TRANSFER_AMOUNT);
                await token.connect(agent).mint(TRANSFER_AMOUNT);
            }
        });

        beforeEach(async () => {
            snapshot = await takeSnapshot(waffle.provider);
        });

        afterEach(async () => {
            if (snapshot !== undefined) {
                await revert(waffle.provider, snapshot);
            }
        });

        it("succeeds", async () => {
            const preRedeemCollateralBalance = await collateralToken.balanceOf(agent.address);

            await balancerMarket.connect(agent).redeemConditionalTokens();
            
            // Verify conditional token balances
            for (let i = 0; i < positionIds.length; i++) {
                const token = await ethers.getContractAt(
                    "ConditionalTokenERC20",
                    await transmuter.getToken(positionIds[i])
                );

                expect(await token.balanceOf(agent.address)).to.equal(ethers.constants.Zero);
                expect(await conditionalTokens.balanceOf(agent.address, positionIds[i]))
                    .to.equal(ethers.constants.Zero);
            }

            // Verify collateral balances
            expect(await collateralToken.balanceOf(balancerMarket.address)).to.equal(ethers.constants.Zero);
            expect(await collateralToken.balanceOf(agent.address))
                .to.equal(preRedeemCollateralBalance.add(TRANSFER_AMOUNT));
        });

        it("fails require for pool token transfer - insufficient allowance", async () => {
            for (let i = 0; i < positionIds.length; i++) {
                const token = await ethers.getContractAt(
                    "ConditionalTokenERC20",
                    await transmuter.getToken(positionIds[i])
                );
                await token.connect(agent).approve(balancerMarket.address, ethers.constants.Zero);
            }

            await expect(balancerMarket.connect(agent).redeemConditionalTokens())
                .to.be.revertedWith("revert ERC20: transfer amount exceeds allowance");
        });
    });
});