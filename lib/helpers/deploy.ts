import { ethers } from 'hardhat';
import { Contract, ContractFactory } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

const factories: Map<string, ContractFactory> = new Map();

export type ContractDeploymentParams = {
    from?: SignerWithAddress;
    args?: Array<unknown>;
};

export async function deploy(contract: string, { from, args }: ContractDeploymentParams = {}): Promise<Contract> {
    if (!args) args = [];
    if (!from) from = (await ethers.getSigners())[0];
    const factory = (await getFactory(contract)).connect(from);
    const instance = await factory.deploy(...args);
    return instance.deployed();
}

export async function getFactory(contractName: string): Promise<ContractFactory> {
    // Cache factory creation to avoid processing the compiled artifacts multiple times
    let factory = factories.get(contractName);

    if (factory === undefined) {
        factory = await ethers.getContractFactory(contractName);
        factories.set(contractName, factory);
    }

    return factory;
}