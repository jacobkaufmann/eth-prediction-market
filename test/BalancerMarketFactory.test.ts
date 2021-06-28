import { ethers, waffle } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import Authorizer from "./artifacts/balancer/Authorizer.json";
import Vault from "./artifacts/balancer/Vault.json";
import WeightedPoolFactory from "./artifacts/balancer/WeightedPoolFactory.json";
import { deploy } from "../lib/helpers/deploy";
import { takeSnapshot, revert } from "./helpers/snapshot";
import { inReceipt } from "./helpers/expectEvent";
import { expect } from "chai";
import {
    BALANCER_MARKET_FEE,
    BALANCER_MARKET_MAX_OUTCOME_COUNT,
    BALANCER_WEIGHTED_POOL_HALF_WEIGHT,
    CONDITIONAL_TOKENS_QUESTION_ID,
    ERC20_COLLATERAL_DECIMALS,
    ERC20_COLLATERAL_NAME,
    ERC20_COLLATERAL_SYMBOL,
    MARKET_NAME,
    MARKET_SYMBOL
} from "./helpers/constants";
import { registerPositionIds } from "./helpers/transmuter";

describe("BalancerMarketFactory", () => {
    const OUTCOME_COUNT = 2;

    const CONDITIONAL_TOKEN_NAME = "Condition";
    const CONDITIONAL_TOKEN_SYMBOL = "COND";

    let owner: SignerWithAddress;
    let oracle: SignerWithAddress;
    let agent: SignerWithAddress;

    let balancerMarketFactory: Contract;
    let balancerMarket: Contract;
    let vault: Contract;
    let authorizer: Contract;
    let weth: Contract;
    let weightedPoolFactory: Contract;
    let weightedPool: Contract;
    let conditionalTokens: Contract;
    let collateralToken: Contract;
    let transmuter: Contract;

    let conditionId: Uint8Array;

    const verifyBalancerWeightedPool = async (
        weightedPool: Contract,
        expectedName: string,
        expectedSymbol: string,
        expectedFee: BigNumber,
        expectedOwner: string
    ) => {
        // Verify balancer pool token (BPT)
        expect(await weightedPool.name()).to.equal(expectedName);
        expect(await weightedPool.symbol()).to.equal(expectedSymbol);

        // Verify fee
        expect(await weightedPool.getSwapFeePercentage()).to.equal(expectedFee);

        // Verify owner
        expect(await weightedPool.getOwner()).to.equal(expectedOwner);
    }

    const verifyBalancerWeightedPoolTokens = async (
        weightedPool: Contract,
        transmuter: Contract,
        poolTokens: string[],
        collateralToken: string,
        outcomeCount: number
    ) => {
        // Verify number of tokens equal to number of outcomes plus 1 (for the collateral token)
        expect(poolTokens.length).to.equal(outcomeCount + 1);

        // Determine expected pool token weights
        const remainder = BALANCER_WEIGHTED_POOL_HALF_WEIGHT.mod(outcomeCount);
        const expectedCollateralWeight = BALANCER_WEIGHTED_POOL_HALF_WEIGHT.add(remainder);
        const expectedConditionalTokenWeight = BALANCER_WEIGHTED_POOL_HALF_WEIGHT.div(outcomeCount);

        const normalizedWeights = await weightedPool.getNormalizedWeights();
        for (let i = 0; i < poolTokens.length; i++) {
            if (poolTokens[i] === collateralToken) {
                // Verify pool token weight
                expect(normalizedWeights[i]).to.equal(expectedCollateralWeight);
            } else {
                // Conditional token ERC20
                const token = await ethers.getContractAt("ConditionalTokenERC20", poolTokens[i]);
                const positionId: BigNumber = await token.getPositionId();

                // Verify token registration with transmuter
                expect(await transmuter.getToken(positionId)).to.equal(poolTokens[i]);

                // Verify pool token weight
                expect(normalizedWeights[i]).to.equal(expectedConditionalTokenWeight);
            }
        }
    }

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
    });

    describe("constructor", () => {
        it("deploys", async () => {
            balancerMarketFactory = await deploy("BalancerMarketFactory", {
                args: [
                    conditionalTokens.address,
                    transmuter.address,
                    vault.address,
                    weightedPoolFactory.address,
                ]
            });

            // Verify storage variables
            expect(await balancerMarketFactory.getConditionalTokens()).to.equal(conditionalTokens.address);
            expect(await balancerMarketFactory.getTransmuter()).to.equal(transmuter.address);
            expect(await balancerMarketFactory.getVault()).to.equal(vault.address);
            expect(await balancerMarketFactory.getWeightedPoolFactory()).to.equal(weightedPoolFactory.address);
        });
    });

    describe("create", () => {
        let snapshot: string;

        before(async () => {
            balancerMarketFactory = await deploy("BalancerMarketFactory", {
                args: [
                    conditionalTokens.address,
                    transmuter.address,
                    vault.address,
                    weightedPoolFactory.address,
                ]
            });
            await conditionalTokens.prepareCondition(
                oracle.address,
                CONDITIONAL_TOKENS_QUESTION_ID,
                OUTCOME_COUNT
            );
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
            // Register conditional tokens with transmuter
            const names = Array<string>(OUTCOME_COUNT).fill(CONDITIONAL_TOKEN_NAME);
            const symbols = Array<string>(OUTCOME_COUNT).fill(CONDITIONAL_TOKEN_SYMBOL)
            await registerPositionIds(transmuter, conditionId, collateralToken.address, names, symbols);

            const receipt = await (await balancerMarketFactory.create(
                MARKET_NAME,
                MARKET_SYMBOL,
                conditionId,
                collateralToken.address,
                BALANCER_MARKET_FEE
            )).wait();
            const event = inReceipt(receipt, "MarketCreation");

            // Verify factory registration
            expect(event.args.conditionId).to.equal(conditionId);
            expect(await balancerMarketFactory.isMarketFromFactory(event.args.market))
                .to.equal(true);

            balancerMarket = await ethers.getContractAt("BalancerMarket", event.args.market);

            // Verify storage variables
            expect(await balancerMarket.getConditionId()).to.equal(conditionId);
            expect(await balancerMarket.getConditionalTokens()).to.equal(conditionalTokens.address);
            expect(await balancerMarket.getCollateralToken()).to.equal(collateralToken.address);
            expect(await balancerMarket.getVault()).to.equal(vault.address);

            const poolId = await balancerMarket.getPoolId();
            const [pool,] = await vault.getPool(poolId);
            weightedPool = await ethers.getContractAt("IWeightedPool", pool);
            await verifyBalancerWeightedPool(
                weightedPool,
                MARKET_NAME,
                MARKET_SYMBOL,
                BALANCER_MARKET_FEE,
                ethers.constants.AddressZero
            );

            const [poolTokens,,] = await vault.getPoolTokens(poolId);
            await verifyBalancerWeightedPoolTokens(
                weightedPool,
                transmuter,
                poolTokens,
                collateralToken.address,
                OUTCOME_COUNT
            );
        });

        it("fails require for unprepared condition", async () => {
            const unpreparedConditionId = await conditionalTokens.getConditionId(
                oracle.address,
                CONDITIONAL_TOKENS_QUESTION_ID,
                OUTCOME_COUNT + 1
            );

            await expect(balancerMarketFactory.create(
                MARKET_NAME,
                MARKET_SYMBOL,
                unpreparedConditionId,
                collateralToken.address,
                BALANCER_MARKET_FEE
            )).to.be.revertedWith("condition not prepared");
        });

        it("fails require for too many condition outcomes", async () => {
            const conditionId = await conditionalTokens.getConditionId(
                oracle.address,
                CONDITIONAL_TOKENS_QUESTION_ID,
                BALANCER_MARKET_MAX_OUTCOME_COUNT + 1
            );
            await conditionalTokens.prepareCondition(
                oracle.address,
                CONDITIONAL_TOKENS_QUESTION_ID,
                BALANCER_MARKET_MAX_OUTCOME_COUNT + 1
            );

            await expect(balancerMarketFactory.create(
                MARKET_NAME,
                MARKET_SYMBOL,
                conditionId,
                collateralToken.address,
                BALANCER_MARKET_FEE
            )).to.be.revertedWith("condition has too many outcome slots");
        });

        it("fails require for unregistered conditional token ERC20", async () => {
            await expect(balancerMarketFactory.create(
                MARKET_NAME,
                MARKET_SYMBOL,
                conditionId,
                collateralToken.address,
                BALANCER_MARKET_FEE
            )).to.be.revertedWith("conditional token not registered");
        });

        it("succeeds with max tokens", async () => {
            const conditionId = await conditionalTokens.getConditionId(
                oracle.address,
                CONDITIONAL_TOKENS_QUESTION_ID,
                BALANCER_MARKET_MAX_OUTCOME_COUNT
            );
            await conditionalTokens.prepareCondition(
                oracle.address,
                CONDITIONAL_TOKENS_QUESTION_ID,
                BALANCER_MARKET_MAX_OUTCOME_COUNT
            );
            
            const names = Array<string>(BALANCER_MARKET_MAX_OUTCOME_COUNT).fill(CONDITIONAL_TOKEN_NAME);
            const symbols = Array<string>(BALANCER_MARKET_MAX_OUTCOME_COUNT).fill(CONDITIONAL_TOKEN_SYMBOL)
            await registerPositionIds(transmuter, conditionId, collateralToken.address, names, symbols);

            const receipt = await (await balancerMarketFactory.create(
                MARKET_NAME,
                MARKET_SYMBOL,
                conditionId,
                collateralToken.address,
                BALANCER_MARKET_FEE
            )).wait();
            const event = inReceipt(receipt, "MarketCreation");

            balancerMarket = await ethers.getContractAt("BalancerMarket", event.args.market);
            const poolId = await balancerMarket.getPoolId();
            const [pool,] = await vault.getPool(poolId);
            weightedPool = await ethers.getContractAt("IWeightedPool", pool);
            await verifyBalancerWeightedPool(
                weightedPool,
                MARKET_NAME,
                MARKET_SYMBOL,
                BALANCER_MARKET_FEE,
                ethers.constants.AddressZero
            );

            const [poolTokens,,] = await vault.getPoolTokens(poolId);
            await verifyBalancerWeightedPoolTokens(
                weightedPool,
                transmuter,
                poolTokens,
                collateralToken.address,
                BALANCER_MARKET_MAX_OUTCOME_COUNT
            );
        });
    });
});