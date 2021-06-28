import { ethers, waffle } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { deploy } from "../lib/helpers/deploy";
import {
  CONDITIONAL_TOKENS_QUESTION_ID,
  ERC20_COLLATERAL_DECIMALS,
  ERC20_COLLATERAL_NAME,
  ERC20_COLLATERAL_SYMBOL,
  ZERO_BYTES32
} from "./helpers/constants"
import {
  basicIndexSetForOutcomeIndex,
  positionIdForCondition,
  positionIdsForCondition
} from "./helpers/conditionalTokens";
import { revert, takeSnapshot } from "./helpers/snapshot";

describe("Transmuter", () => {
  const OUTCOME_COUNT = 2;

  let owner: SignerWithAddress;
  let oracle: SignerWithAddress;
  let agent: SignerWithAddress;

  let conditionalTokens: Contract;
  let collateralToken: Contract;

  let conditionId: string;

  before(async () => {
    [owner, oracle, agent] = await ethers.getSigners();
    conditionalTokens = await deploy("ConditionalTokens");

    conditionId = await conditionalTokens.getConditionId(
      oracle.address,
      CONDITIONAL_TOKENS_QUESTION_ID,
      OUTCOME_COUNT
    );
    await conditionalTokens.prepareCondition(oracle.address, CONDITIONAL_TOKENS_QUESTION_ID, OUTCOME_COUNT);

    collateralToken = await deploy("ERC20MintableBurnable", {
      args: [
        owner.address,
        ERC20_COLLATERAL_NAME,
        ERC20_COLLATERAL_SYMBOL,
        ERC20_COLLATERAL_DECIMALS
      ]
    });
  });

  describe("constructor", () => {
    it("deploys", async () => {
      const transmuter = await deploy("Transmuter", { args: [conditionalTokens.address] });

      // Verify storage variables
      expect(await transmuter.getConditionalTokens()).to.equal(conditionalTokens.address);
    });
  });

  describe("register", () => {
    const CONDITIONAL_TOKEN_ERC20_NAME = "Condition";
    const CONDITIONAL_TOKEN_ERC20_SYMBOL = "COND";

    let snapshot: string;
    let transmuter: Contract;

    beforeEach(async () => {
      snapshot = await takeSnapshot(waffle.provider);
      transmuter = await deploy("Transmuter", { args: [conditionalTokens.address] });
    });

    afterEach(async () => {
      if (snapshot !== undefined) {
        await revert(waffle.provider, snapshot);
      }
    });

    it("succeeds", async () => {
      const indexSet = basicIndexSetForOutcomeIndex(0);
      const positionId = await positionIdForCondition(
        conditionId,
        indexSet,
        collateralToken.address,
        ZERO_BYTES32,
        conditionalTokens
      );

      // Verify registration event
      await expect(transmuter.register(
        conditionId,
        collateralToken.address,
        indexSet,
        CONDITIONAL_TOKEN_ERC20_NAME,
        CONDITIONAL_TOKEN_ERC20_SYMBOL
      )).to.emit(transmuter, "ConditionalTokenRegistration")
        .withArgs(positionId, await transmuter.getToken(positionId));

      // Verify registration storage
      const conditionalTokenAddress = await transmuter.getToken(positionId);
      expect(conditionalTokenAddress).to.not.equal(ethers.constants.AddressZero);

      const ConditionalTokensERC20 = await ethers.getContractFactory("ConditionalTokenERC20");
      const conditionalTokenERC20 = ConditionalTokensERC20.attach(conditionalTokenAddress);

      // Verify ERC20 token details
      expect(await conditionalTokenERC20.totalSupply()).to.equal(ethers.constants.Zero);
      expect(await conditionalTokenERC20.name()).to.equal(CONDITIONAL_TOKEN_ERC20_NAME);
      expect(await conditionalTokenERC20.symbol()).to.equal(CONDITIONAL_TOKEN_ERC20_SYMBOL);
      expect(await conditionalTokenERC20.decimals()).to.equal(ERC20_COLLATERAL_DECIMALS);
    });

    it("fails require for unprepared condition", async () => {
      const unpreparedConditionId = await conditionalTokens.getConditionId(
        oracle.address,
        CONDITIONAL_TOKENS_QUESTION_ID,
        OUTCOME_COUNT + 1
      );
      const indexSet = basicIndexSetForOutcomeIndex(0);

      await expect(transmuter.register(
        unpreparedConditionId,
        collateralToken.address,
        indexSet,
        CONDITIONAL_TOKEN_ERC20_NAME,
        CONDITIONAL_TOKEN_ERC20_SYMBOL
      )).to.be.revertedWith("condition not prepared");
    });

    it("fails require for invalid index set - zero index set", async () => {
      const zeroIndexSet = 0;

      await expect(transmuter.register(
        conditionId,
        collateralToken.address,
        zeroIndexSet,
        CONDITIONAL_TOKEN_ERC20_NAME,
        CONDITIONAL_TOKEN_ERC20_SYMBOL
      )).to.be.revertedWith("invalid index set");
    });

    it("fails require for invalid index set - complete index set", async () => {
      // e.g. 0b11 for two outcomes
      const completeIndexSet = (1 << OUTCOME_COUNT) - 1;

      await expect(transmuter.register(
        conditionId,
        collateralToken.address,
        completeIndexSet,
        CONDITIONAL_TOKEN_ERC20_NAME,
        CONDITIONAL_TOKEN_ERC20_SYMBOL
      )).to.be.revertedWith("invalid index set");
    });

    it("fails require for registering a previously registered position ID", async () => {
      const indexSet = basicIndexSetForOutcomeIndex(0);

      await transmuter.register(
        conditionId,
        collateralToken.address,
        indexSet,
        CONDITIONAL_TOKEN_ERC20_NAME,
        CONDITIONAL_TOKEN_ERC20_SYMBOL
      );
      await expect(transmuter.register(
        conditionId,
        collateralToken.address,
        indexSet,
        CONDITIONAL_TOKEN_ERC20_NAME,
        CONDITIONAL_TOKEN_ERC20_SYMBOL
      )).to.be.revertedWith("positionId already registered");
    });
  });

  describe("registerBasicPartitionForCondition", () => {
    const CONDITIONAL_TOKEN_ERC20_NAMES = ["Condition1", "Condition2"];
    const CONDITIONAL_TOKEN_ERC20_SYMBOLS = ["COND1", "COND2"];

    let snapshot: string;
    let transmuter: Contract;

    beforeEach(async () => {
      snapshot = await takeSnapshot(waffle.provider);
      transmuter = await deploy("Transmuter", { args: [conditionalTokens.address] });
    });

    afterEach(async () => {
      if (snapshot !== undefined) {
        await revert(waffle.provider, snapshot);
      }
    });

    it("succeeds", async () => {
      const positionIds = await positionIdsForCondition(
        conditionId,
        OUTCOME_COUNT,
        collateralToken.address,
        ZERO_BYTES32,
        conditionalTokens
      );

      // Verify registration events
      await expect(transmuter.registerBasicPartitionForCondition(
        conditionId,
        collateralToken.address,
        CONDITIONAL_TOKEN_ERC20_NAMES,
        CONDITIONAL_TOKEN_ERC20_SYMBOLS
      )).to.emit(transmuter, "ConditionalTokenRegistration")
        .withArgs(positionIds[0], await transmuter.getToken(positionIds[0]))
        .to.emit(transmuter, "ConditionalTokenRegistration")
        .withArgs(positionIds[1], await transmuter.getToken(positionIds[1]));

      // Verify registration storage
      const conditionalToken1Address = await transmuter.getToken(positionIds[0]);
      expect(conditionalToken1Address).to.not.equal(ethers.constants.AddressZero);
      const conditionalToken2Address = await transmuter.getToken(positionIds[1]);
      expect(conditionalToken2Address).to.not.equal(ethers.constants.AddressZero);

      const ConditionalTokensERC20 = await ethers.getContractFactory("ConditionalTokenERC20");

      // Verify ERC20 token details for first token
      let conditionalTokenERC20 = ConditionalTokensERC20.attach(conditionalToken1Address);
      expect(await conditionalTokenERC20.totalSupply()).to.equal(ethers.constants.Zero);
      expect(await conditionalTokenERC20.name()).to.equal(CONDITIONAL_TOKEN_ERC20_NAMES[0]);
      expect(await conditionalTokenERC20.symbol()).to.equal(CONDITIONAL_TOKEN_ERC20_SYMBOLS[0]);
      expect(await conditionalTokenERC20.decimals()).to.equal(ERC20_COLLATERAL_DECIMALS);

      // Verify ERC20 token details for second token
      conditionalTokenERC20 = conditionalTokenERC20.attach(conditionalToken2Address);
      expect(await conditionalTokenERC20.totalSupply()).to.equal(ethers.constants.Zero);
      expect(await conditionalTokenERC20.name()).to.equal(CONDITIONAL_TOKEN_ERC20_NAMES[1]);
      expect(await conditionalTokenERC20.symbol()).to.equal(CONDITIONAL_TOKEN_ERC20_SYMBOLS[1]);
      expect(await conditionalTokenERC20.decimals()).to.equal(ERC20_COLLATERAL_DECIMALS);
    });

    it("fails require for length of names array (too long)", async () => {
      await expect(transmuter.registerBasicPartitionForCondition(
        conditionId,
        collateralToken.address,
        CONDITIONAL_TOKEN_ERC20_NAMES.concat(["Extra"]),
        CONDITIONAL_TOKEN_ERC20_SYMBOLS
      )).to.be.revertedWith("incorrect length names array");
    });

    it("fails require for length of names array (too short)", async () => {
      await expect(transmuter.registerBasicPartitionForCondition(
        conditionId,
        collateralToken.address,
        CONDITIONAL_TOKEN_ERC20_NAMES.slice(0, OUTCOME_COUNT - 1),
        CONDITIONAL_TOKEN_ERC20_SYMBOLS
      )).to.be.revertedWith("incorrect length names array");
    });

    it("fails require for length of symbols array (too long)", async () => {
      await expect(transmuter.registerBasicPartitionForCondition(
        conditionId,
        collateralToken.address,
        CONDITIONAL_TOKEN_ERC20_NAMES,
        CONDITIONAL_TOKEN_ERC20_SYMBOLS.concat("EXTRA")
      )).to.be.revertedWith("incorrect length symbols array");
    });

    it("fails require for length of symbols array (too short)", async () => {
      await expect(transmuter.registerBasicPartitionForCondition(
        conditionId,
        collateralToken.address,
        CONDITIONAL_TOKEN_ERC20_NAMES,
        CONDITIONAL_TOKEN_ERC20_SYMBOLS.slice(0, OUTCOME_COUNT - 1)
      )).to.be.revertedWith("incorrect length symbols array");
    });

    it("fails require for registering a previously registered position ID", async () => {
      const indexSet = basicIndexSetForOutcomeIndex(0);

      await transmuter.register(
        conditionId,
        collateralToken.address,
        indexSet,
        CONDITIONAL_TOKEN_ERC20_NAMES[0],
        CONDITIONAL_TOKEN_ERC20_SYMBOLS[0]
      );

      await expect(transmuter.registerBasicPartitionForCondition(
        conditionId,
        collateralToken.address,
        CONDITIONAL_TOKEN_ERC20_NAMES,
        CONDITIONAL_TOKEN_ERC20_SYMBOLS
      )).to.be.revertedWith("positionId already registered");
    });
  });
});
