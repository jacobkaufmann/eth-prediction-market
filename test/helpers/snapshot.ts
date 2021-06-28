import { providers } from "ethers";

export const takeSnapshot = async (provider: providers.Web3Provider): Promise<string> => {
    return (await provider.send("evm_snapshot", [])) as string;
}

export const revert = async (provider: providers.Web3Provider, snapshotId: string): Promise<void> => {
    await provider.send("evm_revert", [snapshotId]);
}
