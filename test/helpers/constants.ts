import { BigNumber } from "ethers";
import { ethers } from "hardhat";

// General
export const ZERO_BYTES32 = ethers.utils.hexZeroPad([0], 32);

// Token
export const ERC20_COLLATERAL_NAME = "Token";
export const ERC20_COLLATERAL_SYMBOL = "TOK";
export const ERC20_COLLATERAL_DECIMALS = 18;

// Market
export const MARKET_NAME = "Market";
export const MARKET_SYMBOL = "MKT";

// Conditional Tokens
export const CONDITIONAL_TOKENS_QUESTION_ID = ethers.utils.hexZeroPad("0x2a", 32);

// Balancer
export const BALANCER_WEIGHTED_POOL_FULL_WEIGHT = BigNumber.from(10).pow(18);
export const BALANCER_WEIGHTED_POOL_HALF_WEIGHT = BALANCER_WEIGHTED_POOL_FULL_WEIGHT.div(2);
export const BALANCER_MIN_BPT = BigNumber.from(10).pow(6);

// Balancer Market
export const BALANCER_MARKET_MAX_TOKENS = 5;
export const BALANCER_MARKET_MAX_OUTCOME_COUNT = BALANCER_MARKET_MAX_TOKENS - 1;
export const BALANCER_MARKET_FEE = BigNumber.from(10).pow(16); // 1%
