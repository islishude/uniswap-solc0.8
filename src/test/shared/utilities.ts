import { ethers } from "ethers";

export function expandTo18Decimals(n: number): bigint {
  return BigInt(n) * 10n ** 18n;
}

export function getCreate2Address(
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  bytecode: string,
): string {
  const [token0, token1] =
    tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
  return ethers.getCreate2Address(
    factoryAddress,
    ethers.keccak256(
      ethers.solidityPacked(["address", "address"], [token0, token1]),
    ),
    ethers.keccak256(bytecode),
  );
}

export function encodePrice(reserve0: bigint, reserve1: bigint) {
  return [
    (reserve1 * 2n ** 112n) / reserve0,
    (reserve0 * 2n ** 112n) / reserve1,
  ];
}

export const MINIMUM_LIQUIDITY = 10n ** 3n;

export const UniswapVersion = "1";
