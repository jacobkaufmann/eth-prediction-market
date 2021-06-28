import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, BigNumber } from "ethers";

export const positionIdsForCondition = async (
    conditionId: string,
    outcomeCount: number,
    collateralToken: string,
    parentCollectionId: string,
    conditionalTokens: Contract
): Promise<BigNumber[]> => {
    const positionIds: BigNumber[] = [];

    for (let i = 0; i < outcomeCount; i++) {
        const indexSet = 1 << i;
        const positionId = await positionIdForCondition(
            conditionId,
            indexSet,
            collateralToken,
            parentCollectionId,
            conditionalTokens
        );
        positionIds.push(positionId);
    }

    return positionIds;
}

export const positionIdForCondition = async (
    conditionId: string,
    indexSet: number,
    collateralToken: string,
    parentCollectionId: string,
    conditionalTokens: Contract
): Promise<BigNumber> => {
    const collectionId = await conditionalTokens.getCollectionId(parentCollectionId, conditionId, indexSet);
    return await conditionalTokens.getPositionId(collateralToken, collectionId);
}

export const basicIndexSetPartition = (outcomeCount: number): number[] => {
    const outcomeCollection: number[] = [];
    for (let i = 0; i < outcomeCount; i++) {
        outcomeCollection.push(1 << i);
    }
    return outcomeCollection;
}

export const basicIndexSetForOutcomeIndex = (outcomeIndex: number): number => {
    return 1 << outcomeIndex;
}

export const mintConditionalTokens = async (
    account: SignerWithAddress,
    amount: BigNumber,
    parentCollectionId: string,
    conditionId: string,
    partition: number[],
    conditionalTokens: Contract,
    collateralToken: Contract
) => {
    await collateralToken.mint(account.address, amount);
    await collateralToken.connect(account).approve(conditionalTokens.address, amount);
    await conditionalTokens.connect(account).splitPosition(
        collateralToken.address,
        parentCollectionId,
        conditionId,
        partition,
        amount
    );
}