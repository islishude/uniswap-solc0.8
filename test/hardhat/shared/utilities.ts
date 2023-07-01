import { BigNumber, utils } from "ethers";

export function expandTo18Decimals(n: number): BigNumber {
    return BigNumber.from(n).mul(BigNumber.from(10).pow(18));
}

export function getCreate2Address(
    factoryAddress: string,
    [tokenA, tokenB]: [string, string],
    bytecode: string
): string {
    const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
    return utils.getCreate2Address(
        factoryAddress,
        utils.keccak256(utils.solidityPack(["address", "address"], [token0, token1])),
        utils.keccak256(bytecode)
    );
}

export function encodePrice(reserve0: BigNumber, reserve1: BigNumber) {
    return [
        reserve1.mul(BigNumber.from(2).pow(112)).div(reserve0),
        reserve0.mul(BigNumber.from(2).pow(112)).div(reserve1),
    ];
}

export const MINIMUM_LIQUIDITY = BigNumber.from(10).pow(3);

export const UniswapVersion = "1";
