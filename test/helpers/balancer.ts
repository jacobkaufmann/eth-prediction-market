import { BigNumber, Contract } from "ethers";
import { ethers } from "hardhat";

export enum JoinKind {
    INIT = 0,
    EXACT_TOKENS_IN_FOR_BPT_OUT = 1,
}

export const joinPool = async (
    poolId: string,
    poolTokens: string[],
    amounts: BigNumber[],
    minBPTAmountOutOnJoin: BigNumber,
    joinKind: JoinKind,
    sender: string,
    receiver: string,
    vault: Contract
) => {
    let userData: string;
    if (joinKind === JoinKind.INIT) {
        userData = ethers.utils.defaultAbiCoder.encode(
            ["uint256", "uint256[]"],
            [JoinKind.INIT, amounts]
        );
    } else {
        userData = ethers.utils.defaultAbiCoder.encode(
            ["uint256", "uint256[]", "uint256"],
            [JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, amounts, minBPTAmountOutOnJoin]
        );
    }

    await vault.joinPool(
        poolId,
        sender,
        receiver,
        [
            poolTokens,
            amounts,
            userData,
            false
        ]
    );
}