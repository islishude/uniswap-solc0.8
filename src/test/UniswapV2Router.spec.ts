import { expect } from "chai";
import { MockProvider } from "ethereum-waffle";
import { BigNumber, Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";
import { expandTo18Decimals } from "./shared/utilities";

describe("UniswapV2Router", () => {
  const loadFixture = waffle.createFixtureLoader(
    waffle.provider.getWallets(),
    waffle.provider
  );

  async function v2Fixture([wallet]: Wallet[], provider: MockProvider) {
    const token = await ethers.getContractFactory("ERC20");

    // deploy tokens
    const tokenA = await token.deploy(expandTo18Decimals(10000));
    const tokenB = await token.deploy(expandTo18Decimals(10000));

    const weth = await ethers.getContractFactory("WETH9");
    const WETH = await weth.deploy();

    // deploy V2
    const v2factory = await ethers.getContractFactory("UniswapV2Factory");
    const factoryV2 = await v2factory.deploy(wallet.address);

    // deploy routers

    const router = await ethers.getContractFactory("UniswapV2Router");
    const router02 = await router.deploy(factoryV2.address, WETH.address);

    // initialize V2
    await factoryV2.createPair(tokenA.address, tokenB.address);
    const pairAddress = await factoryV2.getPair(tokenA.address, tokenB.address);
    const pairFactory = await ethers.getContractFactory("UniswapV2Pair");
    const pair = new Contract(
      pairAddress,
      pairFactory.interface,
      provider
    ).connect(wallet);

    const token0Address = await pair.token0();
    const token0 = tokenA.address === token0Address ? tokenA : tokenB;
    const token1 = tokenA.address === token0Address ? tokenB : tokenA;

    return {
      token0,
      token1,
      WETH,
      factoryV2,
      router: router02,
      pair,
      wallet: wallet,
    };
  }

  it("quote", async () => {
    const { router } = await loadFixture(v2Fixture);
    expect(
      await router.quote(
        BigNumber.from(1),
        BigNumber.from(100),
        BigNumber.from(200)
      )
    ).to.eq(BigNumber.from(2));
    expect(
      await router.quote(
        BigNumber.from(2),
        BigNumber.from(200),
        BigNumber.from(100)
      )
    ).to.eq(BigNumber.from(1));
    await expect(
      router.quote(BigNumber.from(0), BigNumber.from(100), BigNumber.from(200))
    ).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_AMOUNT");
    await expect(
      router.quote(BigNumber.from(1), BigNumber.from(0), BigNumber.from(200))
    ).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_LIQUIDITY");
    await expect(
      router.quote(BigNumber.from(1), BigNumber.from(100), BigNumber.from(0))
    ).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_LIQUIDITY");
  });

  it("getAmountOut", async () => {
    const { router } = await loadFixture(v2Fixture);

    expect(
      await router.getAmountOut(
        BigNumber.from(2),
        BigNumber.from(100),
        BigNumber.from(100)
      )
    ).to.eq(BigNumber.from(1));
    await expect(
      router.getAmountOut(
        BigNumber.from(0),
        BigNumber.from(100),
        BigNumber.from(100)
      )
    ).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT");
    await expect(
      router.getAmountOut(
        BigNumber.from(2),
        BigNumber.from(0),
        BigNumber.from(100)
      )
    ).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_LIQUIDITY");
    await expect(
      router.getAmountOut(
        BigNumber.from(2),
        BigNumber.from(100),
        BigNumber.from(0)
      )
    ).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_LIQUIDITY");
  });

  it("getAmountIn", async () => {
    const { router } = await loadFixture(v2Fixture);

    expect(
      await router.getAmountIn(
        BigNumber.from(1),
        BigNumber.from(100),
        BigNumber.from(100)
      )
    ).to.eq(BigNumber.from(2));
    await expect(
      router.getAmountIn(
        BigNumber.from(0),
        BigNumber.from(100),
        BigNumber.from(100)
      )
    ).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_OUTPUT_AMOUNT");
    await expect(
      router.getAmountIn(
        BigNumber.from(1),
        BigNumber.from(0),
        BigNumber.from(100)
      )
    ).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_LIQUIDITY");
    await expect(
      router.getAmountIn(
        BigNumber.from(1),
        BigNumber.from(100),
        BigNumber.from(0)
      )
    ).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_LIQUIDITY");
  });

  it("getAmountsOut", async () => {
    const { router, token0, token1, wallet } = await loadFixture(v2Fixture);

    await token0.approve(router.address, ethers.constants.MaxUint256);
    await token1.approve(router.address, ethers.constants.MaxUint256);
    await router.addLiquidity(
      token0.address,
      token1.address,
      BigNumber.from(10000),
      BigNumber.from(10000),
      0,
      0,
      wallet.address,
      ethers.constants.MaxUint256
    );

    await expect(
      router.getAmountsOut(BigNumber.from(2), [token0.address])
    ).to.be.revertedWith("UniswapV2Library: INVALID_PATH");
    const path = [token0.address, token1.address];
    expect(await router.getAmountsOut(BigNumber.from(2), path)).to.deep.eq([
      BigNumber.from(2),
      BigNumber.from(1),
    ]);
  });

  it("getAmountsIn", async () => {
    const { router, token0, token1, wallet } = await loadFixture(v2Fixture);

    await token0.approve(router.address, ethers.constants.MaxUint256);
    await token1.approve(router.address, ethers.constants.MaxUint256);
    await router.addLiquidity(
      token0.address,
      token1.address,
      BigNumber.from(10000),
      BigNumber.from(10000),
      0,
      0,
      wallet.address,
      ethers.constants.MaxUint256
    );

    await expect(
      router.getAmountsIn(BigNumber.from(1), [token0.address])
    ).to.be.revertedWith("UniswapV2Library: INVALID_PATH");
    const path = [token0.address, token1.address];
    expect(await router.getAmountsIn(BigNumber.from(1), path)).to.deep.eq([
      BigNumber.from(2),
      BigNumber.from(1),
    ]);
  });
});
