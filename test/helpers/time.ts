import { providers } from "ethers";

export const increaseTime = async (provider: providers.Web3Provider, duration: number) => {
    if (duration < 0) {
        throw Error(`Cannot increase time by a negative amount (${duration})`);
    }
    await provider.send("evm_increaseTime", [duration]);
    await provider.send("evm_mine", []);
}

export const increaseTimeTo = async (provider: providers.Web3Provider, timestamp: number) => {
    const latestTimestamp = (await provider.getBlock("latest")).timestamp;
    if (timestamp < latestTimestamp) {
        throw Error(`Cannot decrease time from ${latestTimestamp} to ${timestamp}`);
    }
    await provider.send("evm_setNextBlockTimestamp", [timestamp]);
    await provider.send("evm_mine", []);
}