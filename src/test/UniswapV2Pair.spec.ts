import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import {
  expandTo18Decimals,
  encodePrice,
  MINIMUM_LIQUIDITY,
} from "./shared/utilities";
import { UniswapV2Pair, ERC20 } from "../../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Signer } from "ethers";

describe("UniswapV2Pair", () => {
  async function fixture() {
    const [pairFactory, erc20Factory] = await Promise.all([
      ethers.getContractFactory("UniswapV2Pair"),
      ethers.getContractFactory("ERC20"),
    ]);
    const [wallet, other] = await ethers.getSigners();

    const factory = await (
      await ethers.getContractFactory("UniswapV2Factory")
    ).deploy(wallet.address);

    const tokenA = (await erc20Factory.deploy(
      expandTo18Decimals(10000),
    )) as ERC20;
    const tokenB = (await erc20Factory.deploy(
      expandTo18Decimals(10000),
    )) as ERC20;

    const [tokenAAddress, tokenBAddress] = await Promise.all([
      tokenA.getAddress(),
      tokenB.getAddress(),
    ]);

    await factory.createPair(tokenAAddress, tokenBAddress);
    const pair = pairFactory.attach(
      await factory.getPair(tokenAAddress, tokenBAddress),
    ) as UniswapV2Pair;
    const token0Address = await pair.token0();
    const token0 = tokenAAddress === token0Address ? tokenA : tokenB;
    const token1 = tokenAAddress === token0Address ? tokenB : tokenA;
    return { pair, token0, token1, wallet, other, factory };
  }

  it("mint", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);
    const token0Amount = expandTo18Decimals(1);
    const token1Amount = expandTo18Decimals(4);
    await token0.transfer(await pair.getAddress(), token0Amount);
    await token1.transfer(await pair.getAddress(), token1Amount);

    const expectedLiquidity = expandTo18Decimals(2);
    await expect(pair.mint(wallet.address))
      .to.emit(pair, "Transfer")
      .withArgs(ethers.ZeroAddress, ethers.ZeroAddress, MINIMUM_LIQUIDITY)
      .to.emit(pair, "Transfer")
      .withArgs(
        ethers.ZeroAddress,
        wallet.address,
        expectedLiquidity - MINIMUM_LIQUIDITY,
      )
      .to.emit(pair, "Sync")
      .withArgs(token0Amount, token1Amount)
      .to.emit(pair, "Mint")
      .withArgs(wallet.address, token0Amount, token1Amount);

    expect(await pair.totalSupply()).to.eq(expectedLiquidity);
    expect(await pair.balanceOf(wallet.address)).to.eq(
      expectedLiquidity - MINIMUM_LIQUIDITY,
    );
    expect(await token0.balanceOf(await pair.getAddress())).to.eq(token0Amount);
    expect(await token1.balanceOf(await pair.getAddress())).to.eq(token1Amount);
    const reserves = await pair.getReserves();
    expect(reserves[0]).to.eq(token0Amount);
    expect(reserves[1]).to.eq(token1Amount);
  });

  async function addLiquidity(
    token0: ERC20,
    token1: ERC20,
    pair: UniswapV2Pair,
    wallet: Signer,
    token0Amount: bigint,
    token1Amount: bigint,
  ) {
    const pairAddress = await pair.getAddress();
    await token0.transfer(pairAddress, token0Amount);
    await token1.transfer(pairAddress, token1Amount);
    await pair.mint(await wallet.getAddress());
  }

  const swapTestCases: bigint[][] = [
    [1, 5, 10, "1662497915624478906"],
    [1, 10, 5, "453305446940074565"],

    [2, 5, 10, "2851015155847869602"],
    [2, 10, 5, "831248957812239453"],

    [1, 10, 10, "906610893880149131"],
    [1, 100, 100, "987158034397061298"],
    [1, 1000, 1000, "996006981039903216"],
  ].map((a) =>
    a.map((n) => (typeof n === "string" ? BigInt(n) : expandTo18Decimals(n))),
  );
  swapTestCases.forEach((swapTestCase, i) => {
    it(`getInputPrice:${i}`, async () => {
      const { pair, wallet, token0, token1 } = await loadFixture(fixture);

      const [swapAmount, token0Amount, token1Amount, expectedOutputAmount] =
        swapTestCase;
      await addLiquidity(
        token0,
        token1,
        pair,
        wallet,
        token0Amount,
        token1Amount,
      );
      await token0.transfer(await pair.getAddress(), swapAmount);
      await expect(
        pair.swap(0, expectedOutputAmount + 1n, wallet.address, "0x"),
      ).to.be.revertedWith("UniswapV2: K");
      await pair.swap(0, expectedOutputAmount, wallet.address, "0x");
    });
  });

  const optimisticTestCases: bigint[][] = [
    ["997000000000000000", 5, 10, 1], // given amountIn, amountOut = floor(amountIn * .997)
    ["997000000000000000", 10, 5, 1],
    ["997000000000000000", 5, 5, 1],
    [1, 5, 5, "1003009027081243732"], // given amountOut, amountIn = ceiling(amountOut / .997)
  ].map((a) =>
    a.map((n) => (typeof n === "string" ? BigInt(n) : expandTo18Decimals(n))),
  );
  optimisticTestCases.forEach((optimisticTestCase, i) => {
    it(`optimistic:${i}`, async () => {
      const { pair, wallet, token0, token1 } = await loadFixture(fixture);

      const [outputAmount, token0Amount, token1Amount, inputAmount] =
        optimisticTestCase;
      await addLiquidity(
        token0,
        token1,
        pair,
        wallet,
        token0Amount,
        token1Amount,
      );
      await token0.transfer(await pair.getAddress(), inputAmount);
      await expect(
        pair.swap(outputAmount + 1n, 0n, wallet.address, "0x"),
      ).to.be.revertedWith("UniswapV2: K");
      await pair.swap(outputAmount, 0, wallet.address, "0x");
    });
  });

  it("swap:token0", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);

    const token0Amount = expandTo18Decimals(5);
    const token1Amount = expandTo18Decimals(10);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount,
    );

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = 1662497915624478906n;
    await token0.transfer(await pair.getAddress(), swapAmount);
    await expect(pair.swap(0, expectedOutputAmount, wallet.address, "0x"))
      .to.emit(token1, "Transfer")
      .withArgs(await pair.getAddress(), wallet.address, expectedOutputAmount)
      .to.emit(pair, "Sync")
      .withArgs(token0Amount + swapAmount, token1Amount - expectedOutputAmount)
      .to.emit(pair, "Swap")
      .withArgs(
        wallet.address,
        swapAmount,
        0,
        0,
        expectedOutputAmount,
        wallet.address,
      );

    const reserves = await pair.getReserves();
    expect(reserves[0]).to.eq(token0Amount + swapAmount);
    expect(reserves[1]).to.eq(token1Amount - expectedOutputAmount);
    expect(await token0.balanceOf(await pair.getAddress())).to.eq(
      token0Amount + swapAmount,
    );
    expect(await token1.balanceOf(await pair.getAddress())).to.eq(
      token1Amount - expectedOutputAmount,
    );
    const totalSupplyToken0 = await token0.totalSupply();
    const totalSupplyToken1 = await token1.totalSupply();
    expect(await token0.balanceOf(wallet.address)).to.eq(
      totalSupplyToken0 - token0Amount - swapAmount,
    );
    expect(await token1.balanceOf(wallet.address)).to.eq(
      totalSupplyToken1 - token1Amount + expectedOutputAmount,
    );
  });

  it("swap:token1", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);

    const token0Amount = expandTo18Decimals(5);
    const token1Amount = expandTo18Decimals(10);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount,
    );

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = 453305446940074565n;
    await token1.transfer(await pair.getAddress(), swapAmount);
    await expect(pair.swap(expectedOutputAmount, 0, wallet.address, "0x"))
      .to.emit(token0, "Transfer")
      .withArgs(await pair.getAddress(), wallet.address, expectedOutputAmount)
      .to.emit(pair, "Sync")
      .withArgs(token0Amount - expectedOutputAmount, token1Amount + swapAmount)
      .to.emit(pair, "Swap")
      .withArgs(
        wallet.address,
        0,
        swapAmount,
        expectedOutputAmount,
        0,
        wallet.address,
      );

    const reserves = await pair.getReserves();
    expect(reserves[0]).to.eq(token0Amount - expectedOutputAmount);
    expect(reserves[1]).to.eq(token1Amount + swapAmount);
    expect(await token0.balanceOf(await pair.getAddress())).to.eq(
      token0Amount - expectedOutputAmount,
    );
    expect(await token1.balanceOf(await pair.getAddress())).to.eq(
      token1Amount + swapAmount,
    );
    const totalSupplyToken0 = await token0.totalSupply();
    const totalSupplyToken1 = await token1.totalSupply();
    expect(await token0.balanceOf(wallet.address)).to.eq(
      totalSupplyToken0 - token0Amount + expectedOutputAmount,
    );
    expect(await token1.balanceOf(wallet.address)).to.eq(
      totalSupplyToken1 - token1Amount - swapAmount,
    );
  });

  it("swap:gas", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);

    const token0Amount = expandTo18Decimals(5);
    const token1Amount = expandTo18Decimals(10);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount,
    );

    // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
    await ethers.provider.send("evm_mine", [
      (await wallet.provider.getBlock("latest"))!.timestamp + 1,
    ]);

    await time.setNextBlockTimestamp(
      (await wallet.provider.getBlock("latest"))!.timestamp + 1,
    );
    await pair.sync();

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = 453305446940074565n;
    await token1.transfer(await pair.getAddress(), swapAmount);
    await time.setNextBlockTimestamp(
      (await wallet.provider.getBlock("latest"))!.timestamp + 1,
    );
    const tx = await pair.swap(expectedOutputAmount, 0, wallet.address, "0x");
    const receipt = await tx.wait();
    expect(receipt!.gasUsed).to.eq(73959);
  });

  it("burn", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);

    const token0Amount = expandTo18Decimals(3);
    const token1Amount = expandTo18Decimals(3);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount,
    );

    const expectedLiquidity = expandTo18Decimals(3);
    await pair.transfer(
      await pair.getAddress(),
      expectedLiquidity - MINIMUM_LIQUIDITY,
    );
    await expect(pair.burn(wallet.address))
      .to.emit(pair, "Transfer")
      .withArgs(
        await pair.getAddress(),
        ethers.ZeroAddress,
        expectedLiquidity - MINIMUM_LIQUIDITY,
      )
      .to.emit(token0, "Transfer")
      .withArgs(await pair.getAddress(), wallet.address, token0Amount - 1000n)
      .to.emit(token1, "Transfer")
      .withArgs(await pair.getAddress(), wallet.address, token1Amount - 1000n)
      .to.emit(pair, "Sync")
      .withArgs(1000, 1000)
      .to.emit(pair, "Burn")
      .withArgs(
        wallet.address,
        token0Amount - 1000n,
        token1Amount - 1000n,
        wallet.address,
      );

    expect(await pair.balanceOf(wallet.address)).to.eq(0);
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY);
    expect(await token0.balanceOf(await pair.getAddress())).to.eq(1000);
    expect(await token1.balanceOf(await pair.getAddress())).to.eq(1000);
    const totalSupplyToken0 = await token0.totalSupply();
    const totalSupplyToken1 = await token1.totalSupply();
    expect(await token0.balanceOf(wallet.address)).to.eq(
      totalSupplyToken0 - 1000n,
    );
    expect(await token1.balanceOf(wallet.address)).to.eq(
      totalSupplyToken1 - 1000n,
    );
  });

  it("price{0,1}CumulativeLast", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);

    const token0Amount = expandTo18Decimals(3);
    const token1Amount = expandTo18Decimals(3);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount,
    );

    const blockTimestamp = (await pair.getReserves())[2];
    await time.setNextBlockTimestamp(blockTimestamp + 1n);
    await pair.sync();

    const initialPrice = encodePrice(token0Amount, token1Amount);
    expect(await pair.price0CumulativeLast()).to.eq(initialPrice[0]);
    expect(await pair.price1CumulativeLast()).to.eq(initialPrice[1]);
    expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 1n);

    const swapAmount = expandTo18Decimals(3);
    await token0.transfer(await pair.getAddress(), swapAmount);
    await time.setNextBlockTimestamp(blockTimestamp + 10n);
    // swap to a new price eagerly instead of syncing
    await pair.swap(0, expandTo18Decimals(1), wallet.address, "0x"); // make the price nice

    expect(await pair.price0CumulativeLast()).to.eq(initialPrice[0] * 10n);
    expect(await pair.price1CumulativeLast()).to.eq(initialPrice[1] * 10n);
    expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 10n);

    await time.setNextBlockTimestamp(blockTimestamp + 20n);
    await pair.sync();

    const newPrice = encodePrice(expandTo18Decimals(6), expandTo18Decimals(2));
    expect(await pair.price0CumulativeLast()).to.eq(
      initialPrice[0] * 10n + newPrice[0] * 10n,
    );
    expect(await pair.price1CumulativeLast()).to.eq(
      initialPrice[1] * 10n + newPrice[1] * 10n,
    );
    expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 20n);
  });

  it("feeTo:off", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);

    const token0Amount = expandTo18Decimals(1000);
    const token1Amount = expandTo18Decimals(1000);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount,
    );

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = 996006981039903216n;
    await token1.transfer(await pair.getAddress(), swapAmount);
    await pair.swap(expectedOutputAmount, 0, wallet.address, "0x");

    const expectedLiquidity = expandTo18Decimals(1000);
    await pair.transfer(
      await pair.getAddress(),
      expectedLiquidity - MINIMUM_LIQUIDITY,
    );
    await pair.burn(wallet.address);
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY);
  });

  it("feeTo:on", async () => {
    const { pair, wallet, token0, token1, other, factory } = await loadFixture(
      fixture,
    );

    await factory.setFeeTo(other.address);

    const token0Amount = expandTo18Decimals(1000);
    const token1Amount = expandTo18Decimals(1000);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount,
    );

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = 996006981039903216n;
    await token1.transfer(await pair.getAddress(), swapAmount);
    await pair.swap(expectedOutputAmount, 0, wallet.address, "0x");

    const expectedLiquidity = expandTo18Decimals(1000);
    await pair.transfer(
      await pair.getAddress(),
      expectedLiquidity - MINIMUM_LIQUIDITY,
    );
    await pair.burn(wallet.address);
    expect(await pair.totalSupply()).to.eq(
      MINIMUM_LIQUIDITY + 249750499251388n,
    );
    expect(await pair.balanceOf(other.address)).to.eq(249750499251388n);

    // using 1000 here instead of the symbolic MINIMUM_LIQUIDITY because the amounts only happen to be equal...
    // ...because the initial liquidity amounts were equal
    expect(await token0.balanceOf(await pair.getAddress())).to.eq(
      1000n + 249501683697445n,
    );
    expect(await token1.balanceOf(await pair.getAddress())).to.eq(
      1000n + 250000187312969n,
    );
  });
});
