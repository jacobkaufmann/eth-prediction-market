import { BigNumber, Contract } from "ethers";

export const getERC20Allowance = async (owner: string, spender: string, erc20: Contract): Promise<BigNumber> => {
    return await erc20.allowance(owner, spender);
}

export const getERC20Balance = async (owner: string, erc20: Contract): Promise<BigNumber> => {
    return await erc20.balanceOf(owner);
}
