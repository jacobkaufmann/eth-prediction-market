import { ethers, waffle } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, BigNumber } from "ethers";
import { deploy } from "../lib/helpers/deploy";
import { increaseTimeTo } from "./helpers/time";
import { CONDITIONAL_TOKENS_QUESTION_ID } from "./helpers/constants";
import { revert, takeSnapshot } from "./helpers/snapshot";

describe("Oracle", () => {
    const OUTCOME_COUNT = 2;
    const PAYOUTS = [1, 0];
    const RESOLUTION_INTERVAL = 3600;

    let owner: SignerWithAddress;
    let agent: SignerWithAddress;
    let conditionalTokens: Contract;

    before(async () => {
        [owner, agent] = await ethers.getSigners();
        conditionalTokens = await deploy("ConditionalTokens", { from: owner });
    });

    describe("constructor", () => {
        it("deploys", async () => {
            const oracle = await deploy("Oracle", { args: [conditionalTokens.address] });

            // Verify storage variables
            expect(await oracle.owner()).to.equal(owner.address);
            expect(await oracle.getConditionalTokens()).to.equal(conditionalTokens.address);
        });
    });

    describe("register", () => {
        let snapshot: string;
        let oracle: Contract;
        let conditionId: string;
        let resolutionTimestamp: number;

        beforeEach(async () => {
            snapshot = await takeSnapshot(waffle.provider);
            
            oracle = await deploy("Oracle", { args: [conditionalTokens.address] });
            conditionId = await conditionalTokens.getConditionId(
                oracle.address,
                CONDITIONAL_TOKENS_QUESTION_ID,
                OUTCOME_COUNT
            );
            resolutionTimestamp = (await waffle.provider.getBlock("latest")).timestamp + RESOLUTION_INTERVAL;
            await conditionalTokens.prepareCondition(
                oracle.address,
                CONDITIONAL_TOKENS_QUESTION_ID,
                OUTCOME_COUNT
            );
        });

        afterEach(async () => {
            if (snapshot !== undefined) {
                await revert(waffle.provider, snapshot);
            }
        });

        it("succeeds", async () => {
            await expect(oracle.register(CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT, resolutionTimestamp))
                .to.emit(oracle, "ConditionRegistration")
                .withArgs(
                    ethers.utils.hexlify(CONDITIONAL_TOKENS_QUESTION_ID),
                    ethers.utils.hexlify(conditionId),
                    resolutionTimestamp
                );
            expect(await oracle.getResolutionTimestamp(CONDITIONAL_TOKENS_QUESTION_ID))
                .to.equal(resolutionTimestamp);
        });

        it("fails require for unprepared condition ID", async () => {
            await expect(oracle.register(CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT + 1, resolutionTimestamp))
                .to.be.revertedWith("condition not prepared");
        });

        it("fails require for resolved condition ID", async () => {
            // TODO: Determine whether it is worth it to introduce a mock just for this test. In
            // ethers.js, there is no way to invoke a call to reportPayouts with the oracle contract
            // as the message sender. It's not great that we rely on the contract's resolve function
            // here.
            await oracle.register(CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT, resolutionTimestamp);
            await increaseTimeTo(waffle.provider, resolutionTimestamp + 1);
            await oracle.resolve(CONDITIONAL_TOKENS_QUESTION_ID, PAYOUTS);

            await expect(oracle.register(CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT, resolutionTimestamp))
                .to.be.revertedWith("condition already resolved");
        });

        it("fails require for previously registered question ID", async () => {
            await oracle.register(CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT, resolutionTimestamp);

            await expect(oracle.register(CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT, resolutionTimestamp))
                .to.be.revertedWith("question already registered");
        });

        it("fails require for past resolution timestamp", async () => {
            const invalidResolutionTimestamp = BigNumber.from(Math.floor((Date.now() / 1000)) - RESOLUTION_INTERVAL);

            await expect(oracle.register(CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT, invalidResolutionTimestamp))
                .to.be.revertedWith("resolution timestamp must be in the future");
        });

        it("fails onlyOwner modifier for non-owner", async () => {
            await expect(oracle.connect(agent).register(
                CONDITIONAL_TOKENS_QUESTION_ID,
                OUTCOME_COUNT,
                resolutionTimestamp
            )).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("resolve", () => {
        let snapshot: string;
        let oracle: Contract;
        let conditionId: string;
        let resolutionTimestamp: number;

        beforeEach(async () => {
            snapshot = await takeSnapshot(waffle.provider);

            oracle = await deploy("Oracle", { args: [conditionalTokens.address] });
            conditionId = await conditionalTokens.getConditionId(
                oracle.address,
                CONDITIONAL_TOKENS_QUESTION_ID,
                OUTCOME_COUNT
            );
            resolutionTimestamp = (await waffle.provider.getBlock("latest")).timestamp + RESOLUTION_INTERVAL;
            await conditionalTokens.prepareCondition(
                oracle.address,
                CONDITIONAL_TOKENS_QUESTION_ID,
                OUTCOME_COUNT
            );
        });

        afterEach(async () => {
            if (snapshot !== undefined) {
                await revert(waffle.provider, snapshot);
            }
        });

        it("succeeds", async () => {
            await oracle.register(CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT, resolutionTimestamp);
            await increaseTimeTo(waffle.provider, resolutionTimestamp + 1);

            await oracle.resolve(CONDITIONAL_TOKENS_QUESTION_ID, PAYOUTS);
        });

        it("fails require for unregistered question ID", async () => {
            await expect(oracle.resolve(CONDITIONAL_TOKENS_QUESTION_ID, PAYOUTS))
                .to.be.revertedWith("question not registered");
        });

        it("fails require for not reaching resolution timestamp", async () => {
            await oracle.register(CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT, resolutionTimestamp);

            await expect(oracle.resolve(CONDITIONAL_TOKENS_QUESTION_ID, PAYOUTS))
                .to.be.revertedWith("resolution timestamp not reached");
        });

        it("fails onlyOwner modifier for non-owner", async () => {
            await expect(oracle.connect(agent).resolve(CONDITIONAL_TOKENS_QUESTION_ID, PAYOUTS))
                .to.be.revertedWith("Ownable: caller is not the owner");
        });
    });
});