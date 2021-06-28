import { Contract } from "ethers";

export const registerPositionIds = async (
    transmuter: Contract,
    conditionId: Uint8Array,
    collateralToken: string,
    names: string[],
    symbols: string[]
) => {
    await transmuter.registerBasicPartitionForCondition(
        conditionId,
        collateralToken,
        names,
        symbols
    );
}