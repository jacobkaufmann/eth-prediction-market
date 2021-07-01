import { ethers, waffle } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, BigNumber } from "ethers";
import { deploy } from "../lib/helpers/deploy";
import { takeSnapshot, revert } from "./helpers/snapshot";
import { basicIndexSetPartition, mintConditionalTokens, positionIdsForCondition } from "./helpers/conditionalTokens";
import {
    CONDITIONAL_TOKENS_QUESTION_ID,
    ERC20_COLLATERAL_DECIMALS,
    ERC20_COLLATERAL_NAME,
    ERC20_COLLATERAL_SYMBOL,
    ZERO_BYTES32
} from "./helpers/constants";

describe("ConditionalTokensERC20", () => {
    const OUTCOME_COUNT = 2;
    const PARTITION = basicIndexSetPartition(OUTCOME_COUNT);

    const CONDITIONAL_TOKEN_NAME = "Condition";
    const CONDITIONAL_TOKEN_SYMBOL = "COND";

    const TRANSFER_AMOUNT = ethers.constants.WeiPerEther;

    let owner: SignerWithAddress;
    let oracle: SignerWithAddress;
    let agent0: SignerWithAddress;
    let agent1: SignerWithAddress;

    let conditionalTokens: Contract;
    let collateralToken: Contract;
    let conditionalTokenERC20: Contract;

    let conditionId: Uint8Array;
    let positionId: BigNumber;
    let positionIdOther: BigNumber;

    before(async () => {
        [owner, oracle, agent0, agent1] = await ethers.getSigners();

        conditionalTokens = await deploy("ConditionalTokens");
        collateralToken = await deploy("ERC20MintableBurnable", {
            args: [
                owner.address,
                ERC20_COLLATERAL_NAME,
                ERC20_COLLATERAL_SYMBOL,
                ERC20_COLLATERAL_DECIMALS
            ],
        });

        await conditionalTokens.prepareCondition(oracle.address, CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT);
        conditionId = await conditionalTokens.getConditionId(oracle.address, CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT);
        [positionId, positionIdOther] = await positionIdsForCondition(
            ethers.utils.hexlify(conditionId),
            OUTCOME_COUNT,
            collateralToken.address,
            ZERO_BYTES32,
            conditionalTokens
        );
    });

    describe("constructor", () => {
        it("deploys", async () => {
            conditionalTokenERC20 = await deploy("ConditionalTokenERC20", {
                args: [
                    conditionalTokens.address,
                    positionId,
                    CONDITIONAL_TOKEN_NAME,
                    CONDITIONAL_TOKEN_SYMBOL,
                    ERC20_COLLATERAL_DECIMALS
                ],
            });

            // Verify storage variables
            expect(await conditionalTokenERC20.getConditionalTokens()).to.equal(conditionalTokens.address);
            expect(await conditionalTokenERC20.getPositionId()).to.equal(positionId);
            expect(await conditionalTokenERC20.totalSupply()).to.equal(ethers.constants.Zero);
            expect(await conditionalTokenERC20.name()).to.equal(CONDITIONAL_TOKEN_NAME);
            expect(await conditionalTokenERC20.symbol()).to.equal(CONDITIONAL_TOKEN_SYMBOL);
            expect(await conditionalTokenERC20.decimals()).to.equal(ERC20_COLLATERAL_DECIMALS);
        });
    });

    describe("transferFrom", () => {
        let snapshot: string;

        beforeEach(async () => {
            snapshot = await takeSnapshot(waffle.provider);

            conditionalTokenERC20 = await deploy("ConditionalTokenERC20", {
                args: [
                    conditionalTokens.address,
                    positionId,
                    CONDITIONAL_TOKEN_NAME,
                    CONDITIONAL_TOKEN_SYMBOL,
                    ERC20_COLLATERAL_DECIMALS
                ],
            });
            await mintConditionalTokens(
                agent0,
                TRANSFER_AMOUNT,
                ZERO_BYTES32,
                ethers.utils.hexlify(conditionId),
                PARTITION,
                conditionalTokens,
                collateralToken
            );
            await conditionalTokens.connect(agent0).setApprovalForAll(conditionalTokenERC20.address, true);
        });

        afterEach(async () => {
            if (snapshot !== undefined) {
                await revert(waffle.provider, snapshot);
            }
        });

        it("succeeds for msg.sender == sender", async () => {
            await conditionalTokenERC20.connect(agent0).mint(TRANSFER_AMOUNT);
            await conditionalTokenERC20.connect(agent0).transferFrom(agent0.address, agent1.address, TRANSFER_AMOUNT);

            expect(await conditionalTokenERC20.balanceOf(agent0.address)).to.equal(ethers.constants.Zero);
            expect(await conditionalTokenERC20.balanceOf(agent1.address)).to.equal(TRANSFER_AMOUNT);
        });

        // If some account approves another account with infinite allowance, the allowance should not
        // change after a 'transferFrom' call.
        it("succeeds for msg.sender != sender and infinite allowance", async () => {
            await conditionalTokenERC20.connect(agent0).mint(TRANSFER_AMOUNT);
            await conditionalTokenERC20.connect(agent0).approve(agent1.address, ethers.constants.MaxUint256);
            await conditionalTokenERC20.connect(agent1).transferFrom(agent0.address, agent1.address, TRANSFER_AMOUNT);

            expect(await conditionalTokenERC20.balanceOf(agent0.address)).to.equal(ethers.constants.Zero);
            expect(await conditionalTokenERC20.balanceOf(agent1.address)).to.equal(TRANSFER_AMOUNT);
            expect(await conditionalTokenERC20.allowance(agent0.address, agent1.address))
                .to.equal(ethers.constants.MaxUint256);
        });

        it("succeeds for msg.sender != sender and finite allowance", async () => {
            await conditionalTokenERC20.connect(agent0).mint(TRANSFER_AMOUNT);
            await conditionalTokenERC20.connect(agent0).approve(agent1.address, TRANSFER_AMOUNT);
            await conditionalTokenERC20.connect(agent1).transferFrom(agent0.address, agent1.address, TRANSFER_AMOUNT);

            expect(await conditionalTokenERC20.balanceOf(agent0.address)).to.equal(ethers.constants.Zero);
            expect(await conditionalTokenERC20.balanceOf(agent1.address)).to.equal(TRANSFER_AMOUNT);
            expect(await conditionalTokenERC20.allowance(agent0.address, agent1.address))
                .to.equal(ethers.constants.Zero);
        });

        it("fails require for insufficient allowance", async () => {
            await conditionalTokenERC20.connect(agent0).mint(TRANSFER_AMOUNT);
            await conditionalTokenERC20.connect(agent0).approve(agent1.address, TRANSFER_AMOUNT.sub(1));

            await expect(conditionalTokenERC20.connect(agent1).transferFrom(
                agent0.address,
                agent1.address,
                TRANSFER_AMOUNT
            )).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });

        it("fails require for insufficient balance", async () => {
            await conditionalTokenERC20.connect(agent0).mint(TRANSFER_AMOUNT);

            await expect(conditionalTokenERC20.connect(agent0).transferFrom(
                agent0.address,
                agent1.address,
                TRANSFER_AMOUNT.add(1)
            )).to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });
    });

    describe("mint", () => {
        let snapshot: string;

        beforeEach(async () => {
            snapshot = await takeSnapshot(waffle.provider);

            conditionalTokenERC20 = await deploy("ConditionalTokenERC20", {
                args: [
                    conditionalTokens.address,
                    positionId,
                    CONDITIONAL_TOKEN_NAME,
                    CONDITIONAL_TOKEN_SYMBOL,
                    ERC20_COLLATERAL_DECIMALS
                ],
            });
            await mintConditionalTokens(
                agent0,
                TRANSFER_AMOUNT,
                ZERO_BYTES32,
                ethers.utils.hexlify(conditionId),
                PARTITION,
                conditionalTokens,
                collateralToken
            );
            await conditionalTokens.connect(agent0).setApprovalForAll(conditionalTokenERC20.address, true);
        });

        afterEach(async () => {
            if (snapshot !== undefined) {
                await revert(waffle.provider, snapshot);
            }
        });

        it("succeeds", async () => {
            await conditionalTokenERC20.connect(agent0).mint(TRANSFER_AMOUNT);
            expect(await conditionalTokens.balanceOf(agent0.address, positionId)).to.equal(ethers.constants.Zero);
            expect(await conditionalTokenERC20.balanceOf(agent0.address)).to.equal(TRANSFER_AMOUNT);
        });

        it("fails require for insufficient conditional tokens balance", async () => {
            await expect(conditionalTokenERC20.connect(agent0).mint(TRANSFER_AMOUNT.add(1)))
                .to.be.revertedWith("revert SafeMath: subtraction overflow");
            expect(await conditionalTokens.balanceOf(agent0.address, positionId))
                .to.equal(TRANSFER_AMOUNT);
            expect(await conditionalTokenERC20.balanceOf(agent0.address))
                .to.equal(ethers.constants.Zero);
        });
    });

    describe("burn", () => {
        let snapshot: string;

        beforeEach(async () => {
            snapshot = await takeSnapshot(waffle.provider);

            conditionalTokenERC20 = await deploy("ConditionalTokenERC20", {
                args: [
                    conditionalTokens.address,
                    positionId,
                    CONDITIONAL_TOKEN_NAME,
                    CONDITIONAL_TOKEN_SYMBOL,
                    ERC20_COLLATERAL_DECIMALS
                ],
            });
            await mintConditionalTokens(
                agent0,
                TRANSFER_AMOUNT,
                ZERO_BYTES32,
                ethers.utils.hexlify(conditionId),
                PARTITION,
                conditionalTokens,
                collateralToken
            );
            await conditionalTokens.connect(agent0).setApprovalForAll(conditionalTokenERC20.address, true);
            await conditionalTokenERC20.connect(agent0).mint(TRANSFER_AMOUNT);
        });

        afterEach(async () => {
            if (snapshot !== undefined) {
                await revert(waffle.provider, snapshot);
            }
        });

        it("succeeds", async () => {
            await conditionalTokenERC20.connect(agent0).burn(TRANSFER_AMOUNT);
            expect(await conditionalTokens.balanceOf(agent0.address, positionId))
                .to.equal(TRANSFER_AMOUNT);
            expect(await conditionalTokenERC20.balanceOf(agent0.address))
                .to.equal(ethers.constants.Zero);
        });
        
        it("fails require for insufficient token balance", async () => {
            await expect(conditionalTokenERC20.connect(agent0).burn(TRANSFER_AMOUNT.add(1)))
                .to.be.revertedWith("revert ERC20: burn amount exceeds balance");
            expect(await conditionalTokens.balanceOf(agent0.address, positionId))
                .to.equal(ethers.constants.Zero);
            expect(await conditionalTokenERC20.balanceOf(agent0.address))
                .to.equal(TRANSFER_AMOUNT);
        });
    });

    describe("onERC1155Received", () => {
        let snapshot: string;

        beforeEach(async () => {
            snapshot = await takeSnapshot(waffle.provider);

            conditionalTokenERC20 = await deploy("ConditionalTokenERC20", {
                args: [
                    conditionalTokens.address,
                    positionId,
                    CONDITIONAL_TOKEN_NAME,
                    CONDITIONAL_TOKEN_SYMBOL,
                    ERC20_COLLATERAL_DECIMALS
                ],
            });
            await mintConditionalTokens(
                agent0,
                TRANSFER_AMOUNT,
                ZERO_BYTES32,
                ethers.utils.hexlify(conditionId),
                PARTITION,
                conditionalTokens,
                collateralToken
            );
        });

        afterEach(async () => {
            if (snapshot !== undefined) {
                await revert(waffle.provider, snapshot);
            }
        });

        it("fails for external operator", async () => {
            await expect(conditionalTokens.connect(agent0).safeTransferFrom(
                agent0.address,
                conditionalTokenERC20.address,
                positionId,
                TRANSFER_AMOUNT,
                "0x"
            )).to.be.revertedWith("revert ERC1155: got unknown value from onERC1155Received");

            expect(await conditionalTokens.balanceOf(agent0.address, positionId))
                .to.equal(TRANSFER_AMOUNT);
            expect(await conditionalTokenERC20.balanceOf(agent0.address))
                .to.equal(ethers.constants.Zero);
        });
    });

    describe("onERC1155BatchReceived", async () => {
        let snapshot: string;

        beforeEach(async () => {
            snapshot = await takeSnapshot(waffle.provider);

            conditionalTokenERC20 = await deploy("ConditionalTokenERC20", {
                args: [
                    conditionalTokens.address,
                    positionId,
                    CONDITIONAL_TOKEN_NAME,
                    CONDITIONAL_TOKEN_SYMBOL,
                    ERC20_COLLATERAL_DECIMALS
                ],
            });
            await mintConditionalTokens(
                agent0,
                TRANSFER_AMOUNT,
                ZERO_BYTES32,
                ethers.utils.hexlify(conditionId),
                PARTITION,
                conditionalTokens,
                collateralToken
            );
        });

        afterEach(async () => {
            if (snapshot !== undefined) {
                await revert(waffle.provider, snapshot);
            }
        });

        it("fails", async () => {
            await expect(conditionalTokens.connect(agent0).safeBatchTransferFrom(
                agent0.address,
                conditionalTokenERC20.address,
                [positionId, positionIdOther],
                [TRANSFER_AMOUNT, TRANSFER_AMOUNT],
                "0x"
            )).to.be.revertedWith("revert ERC1155: got unknown value from onERC1155BatchReceived");

            expect(await conditionalTokens.balanceOf(agent0.address, positionId))
                .to.equal(TRANSFER_AMOUNT);
            expect(await conditionalTokens.balanceOf(agent0.address, positionIdOther))
                .to.equal(TRANSFER_AMOUNT);
            expect(await conditionalTokenERC20.balanceOf(agent0.address))
                .to.equal(ethers.constants.Zero);
        });
    });
});
