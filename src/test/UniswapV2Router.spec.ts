import { Provider } from "@ethersproject/providers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber, Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";
import {
  expandTo18Decimals,
  getApprovalDigest,
  MINIMUM_LIQUIDITY,
} from "./shared/utilities";

describe("UniswapV2Router", () => {
  const loadFixture = waffle.createFixtureLoader(
    waffle.provider.getWallets(),
    waffle.provider
  );

  async function v2Fixture([wallet]: Wallet[], provider: Provider) {
    const token = await ethers.getContractFactory("ERC20");

    // deploy tokens
    const tokenA = await token.deploy(expandTo18Decimals(10000));
    const tokenB = await token.deploy(expandTo18Decimals(10000));

    const weth = await ethers.getContractFactory("WETH9");
    const WETH = await weth.deploy();

    const erc20 = await ethers.getContractFactory("ERC20");
    const WETHPartner = await erc20.deploy(expandTo18Decimals(10000));

    // deploy V2
    const v2factory = await ethers.getContractFactory("UniswapV2Factory");
    const factoryV2 = await v2factory.deploy(wallet.address);

    const routerEmit = await ethers.getContractFactory("RouterEventEmitter");

    const RouterEmit = await routerEmit.deploy();

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

    await factoryV2.createPair(WETH.address, WETHPartner.address);
    const WETHPairAddress = await factoryV2.getPair(
      WETH.address,
      WETHPartner.address
    );

    const wethPair = new Contract(
      WETHPairAddress,
      pairFactory.interface,
      provider
    ).connect(wallet);

    return {
      token0,
      token1,
      WETH,
      WETHPartner,
      factoryV2,
      router02,
      pair,
      RouterEmit,
      wallet,
      wethPair,
      provider,
    };
  }

  it("quote", async () => {
    const { router02: router } = await loadFixture(v2Fixture);
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
    const { router02: router } = await loadFixture(v2Fixture);

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
    const { router02: router } = await loadFixture(v2Fixture);

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
    const {
      router02: router,
      token0,
      token1,
      wallet,
    } = await loadFixture(v2Fixture);

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
    const {
      router02: router,
      token0,
      token1,
      wallet,
    } = await loadFixture(v2Fixture);

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

  it("factory, WETH", async () => {
    const { router02, factoryV2, WETH } = await loadFixture(v2Fixture);
    expect(await router02.factory()).to.eq(factoryV2.address);
    expect(await router02.WETH()).to.eq(WETH.address);
  });

  it("addLiquidity", async () => {
    const { router02, token0, token1, wallet, pair } = await loadFixture(
      v2Fixture
    );

    const token0Amount = expandTo18Decimals(1);
    const token1Amount = expandTo18Decimals(4);

    const expectedLiquidity = expandTo18Decimals(2);
    await token0.approve(router02.address, ethers.constants.MaxUint256);
    await token1.approve(router02.address, ethers.constants.MaxUint256);
    await expect(
      router02.addLiquidity(
        token0.address,
        token1.address,
        token0Amount,
        token1Amount,
        0,
        0,
        wallet.address,
        ethers.constants.MaxUint256
      )
    )
      .to.emit(token0, "Transfer")
      .withArgs(wallet.address, pair.address, token0Amount)
      .to.emit(token1, "Transfer")
      .withArgs(wallet.address, pair.address, token1Amount)
      .to.emit(pair, "Transfer")
      .withArgs(
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        MINIMUM_LIQUIDITY
      )
      .to.emit(pair, "Transfer")
      .withArgs(
        ethers.constants.AddressZero,
        wallet.address,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      )
      .to.emit(pair, "Sync")
      .withArgs(token0Amount, token1Amount)
      .to.emit(pair, "Mint")
      .withArgs(router02.address, token0Amount, token1Amount);

    expect(await pair.balanceOf(wallet.address)).to.eq(
      expectedLiquidity.sub(MINIMUM_LIQUIDITY)
    );
  });

  it("removeLiquidity", async () => {
    const { router02, token0, token1, wallet, pair } = await loadFixture(
      v2Fixture
    );

    const token0Amount = expandTo18Decimals(1);
    const token1Amount = expandTo18Decimals(4);
    await token0.transfer(pair.address, token0Amount);
    await token1.transfer(pair.address, token1Amount);
    await pair.mint(wallet.address);

    const expectedLiquidity = expandTo18Decimals(2);
    await pair.approve(router02.address, ethers.constants.MaxUint256);
    await expect(
      router02.removeLiquidity(
        token0.address,
        token1.address,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY),
        0,
        0,
        wallet.address,
        ethers.constants.MaxUint256
      )
    )
      .to.emit(pair, "Transfer")
      .withArgs(
        wallet.address,
        pair.address,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      )
      .to.emit(pair, "Transfer")
      .withArgs(
        pair.address,
        ethers.constants.AddressZero,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      )
      .to.emit(token0, "Transfer")
      .withArgs(pair.address, wallet.address, token0Amount.sub(500))
      .to.emit(token1, "Transfer")
      .withArgs(pair.address, wallet.address, token1Amount.sub(2000))
      .to.emit(pair, "Sync")
      .withArgs(500, 2000)
      .to.emit(pair, "Burn")
      .withArgs(
        router02.address,
        token0Amount.sub(500),
        token1Amount.sub(2000),
        wallet.address
      );

    expect(await pair.balanceOf(wallet.address)).to.eq(0);
    const totalSupplyToken0 = await token0.totalSupply();
    const totalSupplyToken1 = await token1.totalSupply();
    expect(await token0.balanceOf(wallet.address)).to.eq(
      totalSupplyToken0.sub(500)
    );
    expect(await token1.balanceOf(wallet.address)).to.eq(
      totalSupplyToken1.sub(2000)
    );
  });

  it("removeLiquidityETH", async () => {
    const {
      router02,
      wallet,
      WETHPartner,
      WETH,
      wethPair: WETHPair,
    } = await loadFixture(v2Fixture);

    const WETHPartnerAmount = expandTo18Decimals(1);
    const ETHAmount = expandTo18Decimals(4);
    await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
    await WETH.deposit({ value: ETHAmount });
    await WETH.transfer(WETHPair.address, ETHAmount);
    await WETHPair.mint(wallet.address);

    const expectedLiquidity = expandTo18Decimals(2);
    const WETHPairToken0 = await WETHPair.token0();
    await WETHPair.approve(router02.address, ethers.constants.MaxUint256);
    await expect(
      router02.removeLiquidityETH(
        WETHPartner.address,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY),
        0,
        0,
        wallet.address,
        ethers.constants.MaxUint256
      )
    )
      .to.emit(WETHPair, "Transfer")
      .withArgs(
        wallet.address,
        WETHPair.address,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      )
      .to.emit(WETHPair, "Transfer")
      .withArgs(
        WETHPair.address,
        ethers.constants.AddressZero,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      )
      .to.emit(WETH, "Transfer")
      .withArgs(WETHPair.address, router02.address, ETHAmount.sub(2000))
      .to.emit(WETHPartner, "Transfer")
      .withArgs(WETHPair.address, router02.address, WETHPartnerAmount.sub(500))
      .to.emit(WETHPartner, "Transfer")
      .withArgs(router02.address, wallet.address, WETHPartnerAmount.sub(500))
      .to.emit(WETHPair, "Sync")
      .withArgs(
        WETHPairToken0 === WETHPartner.address ? 500 : 2000,
        WETHPairToken0 === WETHPartner.address ? 2000 : 500
      )
      .to.emit(WETHPair, "Burn")
      .withArgs(
        router02.address,
        WETHPairToken0 === WETHPartner.address
          ? WETHPartnerAmount.sub(500)
          : ETHAmount.sub(2000),
        WETHPairToken0 === WETHPartner.address
          ? ETHAmount.sub(2000)
          : WETHPartnerAmount.sub(500),
        router02.address
      );

    expect(await WETHPair.balanceOf(wallet.address)).to.eq(0);
    const totalSupplyWETHPartner = await WETHPartner.totalSupply();
    const totalSupplyWETH = await WETH.totalSupply();
    expect(await WETHPartner.balanceOf(wallet.address)).to.eq(
      totalSupplyWETHPartner.sub(500)
    );
    expect(await WETH.balanceOf(wallet.address)).to.eq(
      totalSupplyWETH.sub(2000)
    );
  });

  it("removeLiquidityWithPermit", async () => {
    const { router02, token0, token1, wallet, pair } = await loadFixture(
      v2Fixture
    );

    const token0Amount = expandTo18Decimals(1);
    const token1Amount = expandTo18Decimals(4);
    await token0.transfer(pair.address, token0Amount);
    await token1.transfer(pair.address, token1Amount);
    await pair.mint(wallet.address);

    const expectedLiquidity = expandTo18Decimals(2);

    const nonce = await pair.nonces(wallet.address);
    const digest = await getApprovalDigest(
      pair,
      {
        owner: wallet.address,
        spender: router02.address,
        value: expectedLiquidity.sub(MINIMUM_LIQUIDITY),
      },
      nonce,
      ethers.constants.MaxUint256
    );

    const { v, r, s } = wallet
      ._signingKey()
      .signDigest(Buffer.from(digest.slice(2), "hex"));

    await router02.removeLiquidityWithPermit(
      token0.address,
      token1.address,
      expectedLiquidity.sub(MINIMUM_LIQUIDITY),
      0,
      0,
      wallet.address,
      ethers.constants.MaxUint256,
      false,
      v,
      r,
      s
    );
  });

  it("removeLiquidityETHWithPermit", async () => {
    const { router02, wallet, WETHPartner, wethPair, WETH } = await loadFixture(
      v2Fixture
    );

    const WETHPartnerAmount = expandTo18Decimals(1);
    const ETHAmount = expandTo18Decimals(4);
    await WETHPartner.transfer(wethPair.address, WETHPartnerAmount);
    await WETH.deposit({ value: ETHAmount });
    await WETH.transfer(wethPair.address, ETHAmount);
    await wethPair.mint(wallet.address);

    const expectedLiquidity = expandTo18Decimals(2);

    const nonce = await wethPair.nonces(wallet.address);
    const digest = await getApprovalDigest(
      wethPair,
      {
        owner: wallet.address,
        spender: router02.address,
        value: expectedLiquidity.sub(MINIMUM_LIQUIDITY),
      },
      nonce,
      ethers.constants.MaxUint256
    );

    const { v, r, s } = wallet
      ._signingKey()
      .signDigest(Buffer.from(digest.slice(2), "hex"));

    await router02.removeLiquidityETHWithPermit(
      WETHPartner.address,
      expectedLiquidity.sub(MINIMUM_LIQUIDITY),
      0,
      0,
      wallet.address,
      ethers.constants.MaxUint256,
      false,
      v,
      r,
      s
    );
  });

  describe("swapExactTokensForTokens", () => {
    const token0Amount = expandTo18Decimals(5);
    const token1Amount = expandTo18Decimals(10);
    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("1662497915624478906");

    it("happy path", async () => {
      const { router02, token0, token1, wallet, pair } = await loadFixture(
        v2Fixture
      );

      // before each
      await token0.transfer(pair.address, token0Amount);
      await token1.transfer(pair.address, token1Amount);
      await pair.mint(wallet.address);

      await token0.approve(router02.address, ethers.constants.MaxUint256);

      await expect(
        router02.swapExactTokensForTokens(
          swapAmount,
          0,
          [token0.address, token1.address],
          wallet.address,
          ethers.constants.MaxUint256
        )
      )
        .to.emit(token0, "Transfer")
        .withArgs(wallet.address, pair.address, swapAmount)
        .to.emit(token1, "Transfer")
        .withArgs(pair.address, wallet.address, expectedOutputAmount)
        .to.emit(pair, "Sync")
        .withArgs(
          token0Amount.add(swapAmount),
          token1Amount.sub(expectedOutputAmount)
        )
        .to.emit(pair, "Swap")
        .withArgs(
          router02.address,
          swapAmount,
          0,
          0,
          expectedOutputAmount,
          wallet.address
        );
    });

    it("amounts", async () => {
      const { router02, token0, token1, wallet, pair, RouterEmit } =
        await loadFixture(v2Fixture);

      // before each
      await token0.transfer(pair.address, token0Amount);
      await token1.transfer(pair.address, token1Amount);
      await pair.mint(wallet.address);
      await token0.approve(router02.address, ethers.constants.MaxUint256);

      await token0.approve(RouterEmit.address, ethers.constants.MaxUint256);
      await expect(
        RouterEmit.swapExactTokensForTokens(
          router02.address,
          swapAmount,
          0,
          [token0.address, token1.address],
          wallet.address,
          ethers.constants.MaxUint256
        )
      )
        .to.emit(RouterEmit, "Amounts")
        .withArgs([swapAmount, expectedOutputAmount]);
    });

    it("gas", async () => {
      const { router02, token0, token1, wallet, pair, provider } =
        await loadFixture(v2Fixture);

      // before each
      await token0.transfer(pair.address, token0Amount);
      await token1.transfer(pair.address, token1Amount);
      await pair.mint(wallet.address);
      await token0.approve(router02.address, ethers.constants.MaxUint256);

      // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
      await time.setNextBlockTimestamp(
        (await provider.getBlock("latest")).timestamp + 1
      );
      await pair.sync();

      await token0.approve(router02.address, ethers.constants.MaxUint256);
      await time.setNextBlockTimestamp(
        (await provider.getBlock("latest")).timestamp + 1
      );
      const tx = await router02.swapExactTokensForTokens(
        swapAmount,
        0,
        [token0.address, token1.address],
        wallet.address,
        ethers.constants.MaxUint256
      );
      const receipt = await tx.wait();
      expect(receipt.gasUsed).to.eq(101097, "gas used");
    });
  });

  describe("swapTokensForExactTokens", () => {
    const token0Amount = expandTo18Decimals(5);
    const token1Amount = expandTo18Decimals(10);
    const expectedSwapAmount = BigNumber.from("557227237267357629");
    const outputAmount = expandTo18Decimals(1);

    it("happy path", async () => {
      const { router02, token0, token1, wallet, pair } = await loadFixture(
        v2Fixture
      );

      // before each
      await token0.transfer(pair.address, token0Amount);
      await token1.transfer(pair.address, token1Amount);
      await pair.mint(wallet.address);

      await token0.approve(router02.address, ethers.constants.MaxUint256);
      await expect(
        router02.swapTokensForExactTokens(
          outputAmount,
          ethers.constants.MaxUint256,
          [token0.address, token1.address],
          wallet.address,
          ethers.constants.MaxUint256
        )
      )
        .to.emit(token0, "Transfer")
        .withArgs(wallet.address, pair.address, expectedSwapAmount)
        .to.emit(token1, "Transfer")
        .withArgs(pair.address, wallet.address, outputAmount)
        .to.emit(pair, "Sync")
        .withArgs(
          token0Amount.add(expectedSwapAmount),
          token1Amount.sub(outputAmount)
        )
        .to.emit(pair, "Swap")
        .withArgs(
          router02.address,
          expectedSwapAmount,
          0,
          0,
          outputAmount,
          wallet.address
        );
    });

    it("amounts", async () => {
      const { router02, token0, token1, wallet, pair, RouterEmit } =
        await loadFixture(v2Fixture);

      // before each
      await token0.transfer(pair.address, token0Amount);
      await token1.transfer(pair.address, token1Amount);
      await pair.mint(wallet.address);

      await token0.approve(RouterEmit.address, ethers.constants.MaxUint256);
      await expect(
        RouterEmit.swapTokensForExactTokens(
          router02.address,
          outputAmount,
          ethers.constants.MaxUint256,
          [token0.address, token1.address],
          wallet.address,
          ethers.constants.MaxUint256
        )
      )
        .to.emit(RouterEmit, "Amounts")
        .withArgs([expectedSwapAmount, outputAmount]);
    });
  });

  describe("swapExactETHForTokens", () => {
    const WETHPartnerAmount = expandTo18Decimals(10);
    const ETHAmount = expandTo18Decimals(5);
    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("1662497915624478906");

    it("happy path", async () => {
      const {
        router02,
        token0,
        wallet,
        WETHPartner,
        wethPair: WETHPair,
        WETH,
      } = await loadFixture(v2Fixture);

      // before each
      await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(WETHPair.address, ETHAmount);
      await WETHPair.mint(wallet.address);
      await token0.approve(router02.address, ethers.constants.MaxUint256);

      const WETHPairToken0 = await WETHPair.token0();
      await expect(
        router02.swapExactETHForTokens(
          0,
          [WETH.address, WETHPartner.address],
          wallet.address,
          ethers.constants.MaxUint256,
          {
            value: swapAmount,
          }
        )
      )
        .to.emit(WETH, "Transfer")
        .withArgs(router02.address, WETHPair.address, swapAmount)
        .to.emit(WETHPartner, "Transfer")
        .withArgs(WETHPair.address, wallet.address, expectedOutputAmount)
        .to.emit(WETHPair, "Sync")
        .withArgs(
          WETHPairToken0 === WETHPartner.address
            ? WETHPartnerAmount.sub(expectedOutputAmount)
            : ETHAmount.add(swapAmount),
          WETHPairToken0 === WETHPartner.address
            ? ETHAmount.add(swapAmount)
            : WETHPartnerAmount.sub(expectedOutputAmount)
        )
        .to.emit(WETHPair, "Swap")
        .withArgs(
          router02.address,
          WETHPairToken0 === WETHPartner.address ? 0 : swapAmount,
          WETHPairToken0 === WETHPartner.address ? swapAmount : 0,
          WETHPairToken0 === WETHPartner.address ? expectedOutputAmount : 0,
          WETHPairToken0 === WETHPartner.address ? 0 : expectedOutputAmount,
          wallet.address
        );
    });

    it("amounts", async () => {
      const {
        router02,
        token0,
        wallet,
        WETHPartner,
        wethPair: WETHPair,
        WETH,
        RouterEmit,
      } = await loadFixture(v2Fixture);

      // before each
      await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(WETHPair.address, ETHAmount);
      await WETHPair.mint(wallet.address);
      await token0.approve(router02.address, ethers.constants.MaxUint256);

      await expect(
        RouterEmit.swapExactETHForTokens(
          router02.address,
          0,
          [WETH.address, WETHPartner.address],
          wallet.address,
          ethers.constants.MaxUint256,
          {
            value: swapAmount,
          }
        )
      )
        .to.emit(RouterEmit, "Amounts")
        .withArgs([swapAmount, expectedOutputAmount]);
    });

    it("gas", async () => {
      const {
        router02,
        token0,
        wallet,
        pair,
        WETHPartner,
        wethPair: WETHPair,
        WETH,
        provider,
      } = await loadFixture(v2Fixture);

      const WETHPartnerAmount = expandTo18Decimals(10);
      const ETHAmount = expandTo18Decimals(5);

      // before each
      await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(WETHPair.address, ETHAmount);
      await WETHPair.mint(wallet.address);
      await token0.approve(router02.address, ethers.constants.MaxUint256);

      // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
      await time.setNextBlockTimestamp(
        (await provider.getBlock("latest")).timestamp + 1
      );
      await pair.sync();

      const swapAmount = expandTo18Decimals(1);
      await time.setNextBlockTimestamp(
        (await provider.getBlock("latest")).timestamp + 1
      );
      const tx = await router02.swapExactETHForTokens(
        0,
        [WETH.address, WETHPartner.address],
        wallet.address,
        ethers.constants.MaxUint256,
        {
          value: swapAmount,
        }
      );
      const receipt = await tx.wait();
      expect(receipt.gasUsed).to.eq(138689, "gas used");
    }).retries(3);
  });

  describe("swapTokensForExactETH", () => {
    const WETHPartnerAmount = expandTo18Decimals(5);
    const ETHAmount = expandTo18Decimals(10);
    const expectedSwapAmount = BigNumber.from("557227237267357629");
    const outputAmount = expandTo18Decimals(1);

    it("happy path", async () => {
      const {
        router02,
        wallet,
        WETHPartner,
        wethPair: WETHPair,
        WETH,
      } = await loadFixture(v2Fixture);

      // before each
      await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(WETHPair.address, ETHAmount);
      await WETHPair.mint(wallet.address);

      await WETHPartner.approve(router02.address, ethers.constants.MaxUint256);
      const WETHPairToken0 = await WETHPair.token0();
      await expect(
        router02.swapTokensForExactETH(
          outputAmount,
          ethers.constants.MaxUint256,
          [WETHPartner.address, WETH.address],
          wallet.address,
          ethers.constants.MaxUint256
        )
      )
        .to.emit(WETHPartner, "Transfer")
        .withArgs(wallet.address, WETHPair.address, expectedSwapAmount)
        .to.emit(WETH, "Transfer")
        .withArgs(WETHPair.address, router02.address, outputAmount)
        .to.emit(WETHPair, "Sync")
        .withArgs(
          WETHPairToken0 === WETHPartner.address
            ? WETHPartnerAmount.add(expectedSwapAmount)
            : ETHAmount.sub(outputAmount),
          WETHPairToken0 === WETHPartner.address
            ? ETHAmount.sub(outputAmount)
            : WETHPartnerAmount.add(expectedSwapAmount)
        )
        .to.emit(WETHPair, "Swap")
        .withArgs(
          router02.address,
          WETHPairToken0 === WETHPartner.address ? expectedSwapAmount : 0,
          WETHPairToken0 === WETHPartner.address ? 0 : expectedSwapAmount,
          WETHPairToken0 === WETHPartner.address ? 0 : outputAmount,
          WETHPairToken0 === WETHPartner.address ? outputAmount : 0,
          router02.address
        );
    });

    it("amounts", async () => {
      const {
        router02,
        wallet,
        WETHPartner,
        wethPair: WETHPair,
        WETH,
        RouterEmit,
      } = await loadFixture(v2Fixture);

      // before each
      await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(WETHPair.address, ETHAmount);
      await WETHPair.mint(wallet.address);

      await WETHPartner.approve(
        RouterEmit.address,
        ethers.constants.MaxUint256
      );
      await expect(
        RouterEmit.swapTokensForExactETH(
          router02.address,
          outputAmount,
          ethers.constants.MaxUint256,
          [WETHPartner.address, WETH.address],
          wallet.address,
          ethers.constants.MaxUint256
        )
      )
        .to.emit(RouterEmit, "Amounts")
        .withArgs([expectedSwapAmount, outputAmount]);
    });
  });

  describe("swapExactTokensForETH", () => {
    const WETHPartnerAmount = expandTo18Decimals(5);
    const ETHAmount = expandTo18Decimals(10);
    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("1662497915624478906");

    it("happy path", async () => {
      const {
        router02,
        wallet,
        WETHPartner,
        wethPair: WETHPair,
        WETH,
      } = await loadFixture(v2Fixture);

      //before each
      await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(WETHPair.address, ETHAmount);
      await WETHPair.mint(wallet.address);

      await WETHPartner.approve(router02.address, ethers.constants.MaxUint256);
      const WETHPairToken0 = await WETHPair.token0();
      await expect(
        router02.swapExactTokensForETH(
          swapAmount,
          0,
          [WETHPartner.address, WETH.address],
          wallet.address,
          ethers.constants.MaxUint256
        )
      )
        .to.emit(WETHPartner, "Transfer")
        .withArgs(wallet.address, WETHPair.address, swapAmount)
        .to.emit(WETH, "Transfer")
        .withArgs(WETHPair.address, router02.address, expectedOutputAmount)
        .to.emit(WETHPair, "Sync")
        .withArgs(
          WETHPairToken0 === WETHPartner.address
            ? WETHPartnerAmount.add(swapAmount)
            : ETHAmount.sub(expectedOutputAmount),
          WETHPairToken0 === WETHPartner.address
            ? ETHAmount.sub(expectedOutputAmount)
            : WETHPartnerAmount.add(swapAmount)
        )
        .to.emit(WETHPair, "Swap")
        .withArgs(
          router02.address,
          WETHPairToken0 === WETHPartner.address ? swapAmount : 0,
          WETHPairToken0 === WETHPartner.address ? 0 : swapAmount,
          WETHPairToken0 === WETHPartner.address ? 0 : expectedOutputAmount,
          WETHPairToken0 === WETHPartner.address ? expectedOutputAmount : 0,
          router02.address
        );
    });

    it("amounts", async () => {
      const {
        router02,
        wallet,
        WETHPartner,
        wethPair: WETHPair,
        WETH,
        RouterEmit,
      } = await loadFixture(v2Fixture);

      //before each
      await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(WETHPair.address, ETHAmount);
      await WETHPair.mint(wallet.address);

      await WETHPartner.approve(
        RouterEmit.address,
        ethers.constants.MaxUint256
      );
      await expect(
        RouterEmit.swapExactTokensForETH(
          router02.address,
          swapAmount,
          0,
          [WETHPartner.address, WETH.address],
          wallet.address,
          ethers.constants.MaxUint256
        )
      )
        .to.emit(RouterEmit, "Amounts")
        .withArgs([swapAmount, expectedOutputAmount]);
    });
  });

  describe("swapETHForExactTokens", () => {
    const WETHPartnerAmount = expandTo18Decimals(10);
    const ETHAmount = expandTo18Decimals(5);
    const expectedSwapAmount = BigNumber.from("557227237267357629");
    const outputAmount = expandTo18Decimals(1);

    it("happy path", async () => {
      const {
        router02,
        wallet,
        WETHPartner,
        wethPair: WETHPair,
        WETH,
      } = await loadFixture(v2Fixture);

      await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(WETHPair.address, ETHAmount);
      await WETHPair.mint(wallet.address);

      const WETHPairToken0 = await WETHPair.token0();
      await expect(
        router02.swapETHForExactTokens(
          outputAmount,
          [WETH.address, WETHPartner.address],
          wallet.address,
          ethers.constants.MaxUint256,
          {
            value: expectedSwapAmount,
          }
        )
      )
        .to.emit(WETH, "Transfer")
        .withArgs(router02.address, WETHPair.address, expectedSwapAmount)
        .to.emit(WETHPartner, "Transfer")
        .withArgs(WETHPair.address, wallet.address, outputAmount)
        .to.emit(WETHPair, "Sync")
        .withArgs(
          WETHPairToken0 === WETHPartner.address
            ? WETHPartnerAmount.sub(outputAmount)
            : ETHAmount.add(expectedSwapAmount),
          WETHPairToken0 === WETHPartner.address
            ? ETHAmount.add(expectedSwapAmount)
            : WETHPartnerAmount.sub(outputAmount)
        )
        .to.emit(WETHPair, "Swap")
        .withArgs(
          router02.address,
          WETHPairToken0 === WETHPartner.address ? 0 : expectedSwapAmount,
          WETHPairToken0 === WETHPartner.address ? expectedSwapAmount : 0,
          WETHPairToken0 === WETHPartner.address ? outputAmount : 0,
          WETHPairToken0 === WETHPartner.address ? 0 : outputAmount,
          wallet.address
        );
    });

    it("amounts", async () => {
      const {
        router02,
        wallet,
        WETHPartner,
        wethPair: WETHPair,
        WETH,
        RouterEmit,
      } = await loadFixture(v2Fixture);

      await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(WETHPair.address, ETHAmount);
      await WETHPair.mint(wallet.address);

      await expect(
        RouterEmit.swapETHForExactTokens(
          router02.address,
          outputAmount,
          [WETH.address, WETHPartner.address],
          wallet.address,
          ethers.constants.MaxUint256,
          {
            value: expectedSwapAmount,
          }
        )
      )
        .to.emit(RouterEmit, "Amounts")
        .withArgs([expectedSwapAmount, outputAmount]);
    });
  });
});
