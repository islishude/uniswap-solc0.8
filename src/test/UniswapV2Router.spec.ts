import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  expandTo18Decimals,
  MINIMUM_LIQUIDITY,
  UniswapVersion,
} from "./shared/utilities";
import { UniswapV2Pair } from "../../typechain-types";

describe("UniswapV2Router", () => {
  async function v2Fixture() {
    const [wallet] = await ethers.getSigners();
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

    const [tokenAAddress, tokenBAddress, WETHAddress, factoryV2Address] =
      await Promise.all([
        tokenA.getAddress(),
        tokenB.getAddress(),
        WETH.getAddress(),
        factoryV2.getAddress(),
      ]);

    // deploy routers
    const router = await ethers.getContractFactory("UniswapV2Router");
    const router02 = await router.deploy(factoryV2Address, WETHAddress);

    // initialize V2
    await factoryV2.createPair(tokenAAddress, tokenBAddress);
    const pairAddress = await factoryV2.getPair(tokenAAddress, tokenBAddress);
    const pairFactory = await ethers.getContractFactory("UniswapV2Pair");
    const pair = (await pairFactory.attach(pairAddress)) as UniswapV2Pair;

    const token0Address = await pair.token0();
    const token0 = tokenAAddress === token0Address ? tokenA : tokenB;
    const token1 = tokenAAddress === token0Address ? tokenB : tokenA;

    await factoryV2.createPair(WETHAddress, await WETHPartner.getAddress());
    const WETHPairAddress = await factoryV2.getPair(
      WETHAddress,
      await WETHPartner.getAddress(),
    );

    const wethPair = new Contract(
      WETHPairAddress,
      pairFactory.interface,
      wallet,
    );

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
    };
  }

  it("quote", async () => {
    const { router02: router } = await loadFixture(v2Fixture);
    expect(await router.quote(1n, 100n, 200n)).to.eq(2n);
    expect(await router.quote(2n, 200n, 100n)).to.eq(1n);
    await expect(router.quote(0n, 100n, 200n)).to.be.revertedWith(
      "UniswapV2Library: INSUFFICIENT_AMOUNT",
    );
    await expect(router.quote(1n, 0n, 200n)).to.be.revertedWith(
      "UniswapV2Library: INSUFFICIENT_LIQUIDITY",
    );
    await expect(router.quote(1n, 100n, 0n)).to.be.revertedWith(
      "UniswapV2Library: INSUFFICIENT_LIQUIDITY",
    );
  });

  it("getAmountOut", async () => {
    const { router02: router } = await loadFixture(v2Fixture);

    expect(await router.getAmountOut(2n, 100n, 100n)).to.eq(1n);
    await expect(router.getAmountOut(0n, 100n, 100n)).to.be.revertedWith(
      "UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT",
    );
    await expect(router.getAmountOut(2n, 0n, 100n)).to.be.revertedWith(
      "UniswapV2Library: INSUFFICIENT_LIQUIDITY",
    );
    await expect(router.getAmountOut(2n, 100n, 0n)).to.be.revertedWith(
      "UniswapV2Library: INSUFFICIENT_LIQUIDITY",
    );
  });

  it("getAmountIn", async () => {
    const { router02: router } = await loadFixture(v2Fixture);

    expect(await router.getAmountIn(1n, 100n, 100n)).to.eq(2n);
    await expect(router.getAmountIn(0n, 100n, 100n)).to.be.revertedWith(
      "UniswapV2Library: INSUFFICIENT_OUTPUT_AMOUNT",
    );
    await expect(router.getAmountIn(1n, 0n, 100n)).to.be.revertedWith(
      "UniswapV2Library: INSUFFICIENT_LIQUIDITY",
    );
    await expect(router.getAmountIn(1n, 100n, 0n)).to.be.revertedWith(
      "UniswapV2Library: INSUFFICIENT_LIQUIDITY",
    );
  });

  it("getAmountsOut", async () => {
    const {
      router02: router,
      token0,
      token1,
      wallet,
    } = await loadFixture(v2Fixture);

    await token0.approve(await router.getAddress(), ethers.MaxUint256);
    await token1.approve(await router.getAddress(), ethers.MaxUint256);
    await router.addLiquidity(
      await token0.getAddress(),
      await token1.getAddress(),
      10000n,
      10000n,
      0,
      0,
      wallet.address,
      ethers.MaxUint256,
    );

    await expect(
      router.getAmountsOut(2n, [await token0.getAddress()]),
    ).to.be.revertedWith("UniswapV2Library: INVALID_PATH");
    const path = [await token0.getAddress(), await token1.getAddress()];
    expect(await router.getAmountsOut(2n, path)).to.deep.eq([2n, 1n]);
  });

  it("getAmountsIn", async () => {
    const {
      router02: router,
      token0,
      token1,
      wallet,
    } = await loadFixture(v2Fixture);

    await token0.approve(await router.getAddress(), ethers.MaxUint256);
    await token1.approve(await router.getAddress(), ethers.MaxUint256);
    await router.addLiquidity(
      await token0.getAddress(),
      await token1.getAddress(),
      10000n,
      10000n,
      0,
      0,
      wallet.address,
      ethers.MaxUint256,
    );

    await expect(
      router.getAmountsIn(1n, [await token0.getAddress()]),
    ).to.be.revertedWith("UniswapV2Library: INVALID_PATH");
    const path = [await token0.getAddress(), await token1.getAddress()];
    expect(await router.getAmountsIn(1n, path)).to.deep.eq([2n, 1n]);
  });

  it("factory, WETH", async () => {
    const { router02, factoryV2, WETH } = await loadFixture(v2Fixture);
    expect(await router02.factory()).to.eq(await factoryV2.getAddress());
    expect(await router02.WETH()).to.eq(await WETH.getAddress());
  });

  it("addLiquidity", async () => {
    const { router02, token0, token1, wallet, pair } = await loadFixture(
      v2Fixture,
    );

    const token0Amount = expandTo18Decimals(1);
    const token1Amount = expandTo18Decimals(4);

    const expectedLiquidity = expandTo18Decimals(2);
    await token0.approve(await router02.getAddress(), ethers.MaxUint256);
    await token1.approve(await router02.getAddress(), ethers.MaxUint256);
    await expect(
      router02.addLiquidity(
        await token0.getAddress(),
        await token1.getAddress(),
        token0Amount,
        token1Amount,
        0,
        0,
        wallet.address,
        ethers.MaxUint256,
      ),
    )
      .to.emit(token0, "Transfer")
      .withArgs(wallet.address, await pair.getAddress(), token0Amount)
      .to.emit(token1, "Transfer")
      .withArgs(wallet.address, await pair.getAddress(), token1Amount)
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
      .withArgs(await router02.getAddress(), token0Amount, token1Amount);

    expect(await pair.balanceOf(wallet.address)).to.eq(
      expectedLiquidity - MINIMUM_LIQUIDITY,
    );
  });

  it("removeLiquidity", async () => {
    const { router02, token0, token1, wallet, pair } = await loadFixture(
      v2Fixture,
    );

    const token0Amount = expandTo18Decimals(1);
    const token1Amount = expandTo18Decimals(4);
    await token0.transfer(await pair.getAddress(), token0Amount);
    await token1.transfer(await pair.getAddress(), token1Amount);
    await pair.mint(wallet.address);

    const expectedLiquidity = expandTo18Decimals(2);
    await pair.approve(await router02.getAddress(), ethers.MaxUint256);
    await expect(
      router02.removeLiquidity(
        await token0.getAddress(),
        await token1.getAddress(),
        expectedLiquidity - MINIMUM_LIQUIDITY,
        0,
        0,
        wallet.address,
        ethers.MaxUint256,
      ),
    )
      .to.emit(pair, "Transfer")
      .withArgs(
        wallet.address,
        await pair.getAddress(),
        expectedLiquidity - MINIMUM_LIQUIDITY,
      )
      .to.emit(pair, "Transfer")
      .withArgs(
        await pair.getAddress(),
        ethers.ZeroAddress,
        expectedLiquidity - MINIMUM_LIQUIDITY,
      )
      .to.emit(token0, "Transfer")
      .withArgs(await pair.getAddress(), wallet.address, token0Amount - 500n)
      .to.emit(token1, "Transfer")
      .withArgs(await pair.getAddress(), wallet.address, token1Amount - 2000n)
      .to.emit(pair, "Sync")
      .withArgs(500n, 2000n)
      .to.emit(pair, "Burn")
      .withArgs(
        await router02.getAddress(),
        token0Amount - 500n,
        token1Amount - 2000n,
        wallet.address,
      );

    expect(await pair.balanceOf(wallet.address)).to.eq(0);
    const totalSupplyToken0 = await token0.totalSupply();
    const totalSupplyToken1 = await token1.totalSupply();
    expect(await token0.balanceOf(wallet.address)).to.eq(
      totalSupplyToken0 - 500n,
    );
    expect(await token1.balanceOf(wallet.address)).to.eq(
      totalSupplyToken1 - 2000n,
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
    await WETHPartner.transfer(await WETHPair.getAddress(), WETHPartnerAmount);
    await WETH.deposit({ value: ETHAmount });
    await WETH.transfer(await WETHPair.getAddress(), ETHAmount);
    await WETHPair.mint(wallet.address);

    const expectedLiquidity = expandTo18Decimals(2);
    const WETHPairToken0 = await WETHPair.token0();
    await WETHPair.approve(await router02.getAddress(), ethers.MaxUint256);
    await expect(
      router02.removeLiquidityETH(
        await WETHPartner.getAddress(),
        expectedLiquidity - MINIMUM_LIQUIDITY,
        0,
        0,
        wallet.address,
        ethers.MaxUint256,
      ),
    )
      .to.emit(WETHPair, "Transfer")
      .withArgs(
        wallet.address,
        await WETHPair.getAddress(),
        expectedLiquidity - MINIMUM_LIQUIDITY,
      )
      .to.emit(WETHPair, "Transfer")
      .withArgs(
        await WETHPair.getAddress(),
        ethers.ZeroAddress,
        expectedLiquidity - MINIMUM_LIQUIDITY,
      )
      .to.emit(WETH, "Transfer")
      .withArgs(
        await WETHPair.getAddress(),
        await router02.getAddress(),
        ETHAmount - 2000n,
      )
      .to.emit(WETHPartner, "Transfer")
      .withArgs(
        await WETHPair.getAddress(),
        await router02.getAddress(),
        WETHPartnerAmount - 500n,
      )
      .to.emit(WETHPartner, "Transfer")
      .withArgs(
        await router02.getAddress(),
        wallet.address,
        WETHPartnerAmount - 500n,
      )
      .to.emit(WETHPair, "Sync")
      .withArgs(
        WETHPairToken0 === (await WETHPartner.getAddress()) ? 500n : 2000n,
        WETHPairToken0 === (await WETHPartner.getAddress()) ? 2000n : 500n,
      )
      .to.emit(WETHPair, "Burn")
      .withArgs(
        await router02.getAddress(),
        WETHPairToken0 === (await WETHPartner.getAddress())
          ? WETHPartnerAmount - 500n
          : ETHAmount - 2000n,
        WETHPairToken0 === (await WETHPartner.getAddress())
          ? ETHAmount - 2000n
          : WETHPartnerAmount - 500n,
        await router02.getAddress(),
      );

    expect(await WETHPair.balanceOf(wallet.address)).to.eq(0);
    const totalSupplyWETHPartner = await WETHPartner.totalSupply();
    const totalSupplyWETH = await WETH.totalSupply();
    expect(await WETHPartner.balanceOf(wallet.address)).to.eq(
      totalSupplyWETHPartner - 500n,
    );
    expect(await WETH.balanceOf(wallet.address)).to.eq(totalSupplyWETH - 2000n);
  });

  it("removeLiquidityWithPermit", async () => {
    const { router02, token0, token1, wallet, pair } = await loadFixture(
      v2Fixture,
    );

    const token0Amount = expandTo18Decimals(1);
    const token1Amount = expandTo18Decimals(4);
    await token0.transfer(await pair.getAddress(), token0Amount);
    await token1.transfer(await pair.getAddress(), token1Amount);
    await pair.mint(wallet.address);

    const expectedLiquidity = expandTo18Decimals(2);

    const nonce = await pair.nonces(wallet.address);
    const tokenName = await pair.name();
    const { chainId } = await wallet.provider.getNetwork();
    const sig = await wallet.signTypedData(
      // "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
      {
        name: tokenName,
        version: UniswapVersion,
        chainId: chainId,
        verifyingContract: await pair.getAddress(),
      },
      // "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        owner: wallet.address,
        spender: await router02.getAddress(),
        value: expectedLiquidity - MINIMUM_LIQUIDITY,
        nonce: nonce,
        deadline: ethers.MaxUint256,
      },
    );

    const { r, s, v } = ethers.Signature.from(sig);

    await router02.removeLiquidityWithPermit(
      await token0.getAddress(),
      await token1.getAddress(),
      expectedLiquidity - MINIMUM_LIQUIDITY,
      0,
      0,
      wallet.address,
      ethers.MaxUint256,
      false,
      v,
      r,
      s,
    );
  });

  it("removeLiquidityETHWithPermit", async () => {
    const { router02, wallet, WETHPartner, wethPair, WETH } = await loadFixture(
      v2Fixture,
    );

    const WETHPartnerAmount = expandTo18Decimals(1);
    const ETHAmount = expandTo18Decimals(4);
    await WETHPartner.transfer(await wethPair.getAddress(), WETHPartnerAmount);
    await WETH.deposit({ value: ETHAmount });
    await WETH.transfer(await wethPair.getAddress(), ETHAmount);
    await wethPair.mint(wallet.address);

    const expectedLiquidity = expandTo18Decimals(2);

    const nonce = await wethPair.nonces(wallet.address);

    const tokenName = await wethPair.name();
    const { chainId } = await wallet.provider.getNetwork();

    const sig = await wallet.signTypedData(
      // "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
      {
        name: tokenName,
        version: UniswapVersion,
        chainId: chainId,
        verifyingContract: await wethPair.getAddress(),
      },
      // "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        owner: wallet.address,
        spender: await router02.getAddress(),
        value: expectedLiquidity - MINIMUM_LIQUIDITY,
        nonce: nonce,
        deadline: ethers.MaxUint256,
      },
    );

    const { r, s, v } = ethers.Signature.from(sig);

    await router02.removeLiquidityETHWithPermit(
      await WETHPartner.getAddress(),
      expectedLiquidity - MINIMUM_LIQUIDITY,
      0,
      0,
      wallet.address,
      ethers.MaxUint256,
      false,
      v,
      r,
      s,
    );
  });

  describe("swapExactTokensForTokens", () => {
    const token0Amount = expandTo18Decimals(5);
    const token1Amount = expandTo18Decimals(10);
    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = 1662497915624478906n;

    it("happy path", async () => {
      const { router02, token0, token1, wallet, pair } = await loadFixture(
        v2Fixture,
      );

      // before each
      await token0.transfer(await pair.getAddress(), token0Amount);
      await token1.transfer(await pair.getAddress(), token1Amount);
      await pair.mint(wallet.address);

      await token0.approve(await router02.getAddress(), ethers.MaxUint256);

      await expect(
        router02.swapExactTokensForTokens(
          swapAmount,
          0,
          [await token0.getAddress(), await token1.getAddress()],
          wallet.address,
          ethers.MaxUint256,
        ),
      )
        .to.emit(token0, "Transfer")
        .withArgs(wallet.address, await pair.getAddress(), swapAmount)
        .to.emit(token1, "Transfer")
        .withArgs(await pair.getAddress(), wallet.address, expectedOutputAmount)
        .to.emit(pair, "Sync")
        .withArgs(
          token0Amount + swapAmount,
          token1Amount - expectedOutputAmount,
        )
        .to.emit(pair, "Swap")
        .withArgs(
          await router02.getAddress(),
          swapAmount,
          0,
          0,
          expectedOutputAmount,
          wallet.address,
        );
    });

    it("amounts", async () => {
      const { router02, token0, token1, wallet, pair, RouterEmit } =
        await loadFixture(v2Fixture);

      // before each
      await token0.transfer(await pair.getAddress(), token0Amount);
      await token1.transfer(await pair.getAddress(), token1Amount);
      await pair.mint(wallet.address);
      await token0.approve(await router02.getAddress(), ethers.MaxUint256);

      await token0.approve(await RouterEmit.getAddress(), ethers.MaxUint256);
      await expect(
        RouterEmit.swapExactTokensForTokens(
          await router02.getAddress(),
          swapAmount,
          0,
          [await token0.getAddress(), await token1.getAddress()],
          wallet.address,
          ethers.MaxUint256,
        ),
      )
        .to.emit(RouterEmit, "Amounts")
        .withArgs([swapAmount, expectedOutputAmount]);
    });

    it("gas", async () => {
      const { router02, token0, token1, wallet, pair } = await loadFixture(
        v2Fixture,
      );

      // before each
      await token0.transfer(await pair.getAddress(), token0Amount);
      await token1.transfer(await pair.getAddress(), token1Amount);
      await pair.mint(wallet.address);
      await token0.approve(await router02.getAddress(), ethers.MaxUint256);

      // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
      await time.setNextBlockTimestamp(
        (await ethers.provider.getBlock("latest"))!.timestamp + 1,
      );
      await pair.sync();

      await token0.approve(await router02.getAddress(), ethers.MaxUint256);
      await time.setNextBlockTimestamp(
        (await ethers.provider.getBlock("latest"))!.timestamp + 1,
      );
      const tx = await router02.swapExactTokensForTokens(
        swapAmount,
        0,
        [await token0.getAddress(), await token1.getAddress()],
        wallet.address,
        ethers.MaxUint256,
      );
      const receipt = await tx.wait();
      expect(receipt!.gasUsed).to.eq(101097, "gas used");
    });
  });

  describe("swapTokensForExactTokens", () => {
    const token0Amount = expandTo18Decimals(5);
    const token1Amount = expandTo18Decimals(10);
    const expectedSwapAmount = 557227237267357629n;
    const outputAmount = expandTo18Decimals(1);

    it("happy path", async () => {
      const { router02, token0, token1, wallet, pair } = await loadFixture(
        v2Fixture,
      );

      // before each
      await token0.transfer(await pair.getAddress(), token0Amount);
      await token1.transfer(await pair.getAddress(), token1Amount);
      await pair.mint(wallet.address);

      await token0.approve(await router02.getAddress(), ethers.MaxUint256);
      await expect(
        router02.swapTokensForExactTokens(
          outputAmount,
          ethers.MaxUint256,
          [await token0.getAddress(), await token1.getAddress()],
          wallet.address,
          ethers.MaxUint256,
        ),
      )
        .to.emit(token0, "Transfer")
        .withArgs(wallet.address, await pair.getAddress(), expectedSwapAmount)
        .to.emit(token1, "Transfer")
        .withArgs(await pair.getAddress(), wallet.address, outputAmount)
        .to.emit(pair, "Sync")
        .withArgs(
          token0Amount + expectedSwapAmount,
          token1Amount - outputAmount,
        )
        .to.emit(pair, "Swap")
        .withArgs(
          await router02.getAddress(),
          expectedSwapAmount,
          0,
          0,
          outputAmount,
          wallet.address,
        );
    });

    it("amounts", async () => {
      const { router02, token0, token1, wallet, pair, RouterEmit } =
        await loadFixture(v2Fixture);

      // before each
      await token0.transfer(await pair.getAddress(), token0Amount);
      await token1.transfer(await pair.getAddress(), token1Amount);
      await pair.mint(wallet.address);

      await token0.approve(await RouterEmit.getAddress(), ethers.MaxUint256);
      await expect(
        RouterEmit.swapTokensForExactTokens(
          await router02.getAddress(),
          outputAmount,
          ethers.MaxUint256,
          [await token0.getAddress(), await token1.getAddress()],
          wallet.address,
          ethers.MaxUint256,
        ),
      )
        .to.emit(RouterEmit, "Amounts")
        .withArgs([expectedSwapAmount, outputAmount]);
    });
  });

  describe("swapExactETHForTokens", () => {
    const WETHPartnerAmount = expandTo18Decimals(10);
    const ETHAmount = expandTo18Decimals(5);
    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = 1662497915624478906n;

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
      await WETHPartner.transfer(
        await WETHPair.getAddress(),
        WETHPartnerAmount,
      );
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(await WETHPair.getAddress(), ETHAmount);
      await WETHPair.mint(wallet.address);
      await token0.approve(await router02.getAddress(), ethers.MaxUint256);

      const WETHPairToken0 = await WETHPair.token0();
      await expect(
        router02.swapExactETHForTokens(
          0,
          [await WETH.getAddress(), await WETHPartner.getAddress()],
          wallet.address,
          ethers.MaxUint256,
          {
            value: swapAmount,
          },
        ),
      )
        .to.emit(WETH, "Transfer")
        .withArgs(
          await router02.getAddress(),
          await WETHPair.getAddress(),
          swapAmount,
        )
        .to.emit(WETHPartner, "Transfer")
        .withArgs(
          await WETHPair.getAddress(),
          wallet.address,
          expectedOutputAmount,
        )
        .to.emit(WETHPair, "Sync")
        .withArgs(
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? WETHPartnerAmount - expectedOutputAmount
            : ETHAmount + swapAmount,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? ETHAmount + swapAmount
            : WETHPartnerAmount - expectedOutputAmount,
        )
        .to.emit(WETHPair, "Swap")
        .withArgs(
          await router02.getAddress(),
          WETHPairToken0 === (await WETHPartner.getAddress()) ? 0 : swapAmount,
          WETHPairToken0 === (await WETHPartner.getAddress()) ? swapAmount : 0,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? expectedOutputAmount
            : 0,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? 0
            : expectedOutputAmount,
          wallet.address,
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
      await WETHPartner.transfer(
        await WETHPair.getAddress(),
        WETHPartnerAmount,
      );
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(await WETHPair.getAddress(), ETHAmount);
      await WETHPair.mint(wallet.address);
      await token0.approve(await router02.getAddress(), ethers.MaxUint256);

      await expect(
        RouterEmit.swapExactETHForTokens(
          await router02.getAddress(),
          0,
          [await WETH.getAddress(), await WETHPartner.getAddress()],
          wallet.address,
          ethers.MaxUint256,
          {
            value: swapAmount,
          },
        ),
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
      } = await loadFixture(v2Fixture);

      const WETHPartnerAmount = expandTo18Decimals(10);
      const ETHAmount = expandTo18Decimals(5);

      // before each
      await WETHPartner.transfer(
        await WETHPair.getAddress(),
        WETHPartnerAmount,
      );
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(await WETHPair.getAddress(), ETHAmount);
      await WETHPair.mint(wallet.address);
      await token0.approve(await router02.getAddress(), ethers.MaxUint256);

      // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
      await time.setNextBlockTimestamp(
        (await wallet.provider.getBlock("latest"))!.timestamp + 1,
      );
      await pair.sync();

      const swapAmount = expandTo18Decimals(1);
      await time.setNextBlockTimestamp(
        (await wallet.provider.getBlock("latest"))!.timestamp + 1,
      );
      const tx = await router02.swapExactETHForTokens(
        0,
        [await WETH.getAddress(), await WETHPartner.getAddress()],
        wallet.address,
        ethers.MaxUint256,
        {
          value: swapAmount,
        },
      );
      const receipt = await tx.wait();
      expect(receipt!.gasUsed).to.eq(138689, "gas used");
    }).retries(3);
  });

  describe("swapTokensForExactETH", () => {
    const WETHPartnerAmount = expandTo18Decimals(5);
    const ETHAmount = expandTo18Decimals(10);
    const expectedSwapAmount = 557227237267357629n;
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
      await WETHPartner.transfer(
        await WETHPair.getAddress(),
        WETHPartnerAmount,
      );
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(await WETHPair.getAddress(), ETHAmount);
      await WETHPair.mint(wallet.address);

      await WETHPartner.approve(await router02.getAddress(), ethers.MaxUint256);
      const WETHPairToken0 = await WETHPair.token0();
      await expect(
        router02.swapTokensForExactETH(
          outputAmount,
          ethers.MaxUint256,
          [await WETHPartner.getAddress(), await WETH.getAddress()],
          wallet.address,
          ethers.MaxUint256,
        ),
      )
        .to.emit(WETHPartner, "Transfer")
        .withArgs(
          wallet.address,
          await WETHPair.getAddress(),
          expectedSwapAmount,
        )
        .to.emit(WETH, "Transfer")
        .withArgs(
          await WETHPair.getAddress(),
          await router02.getAddress(),
          outputAmount,
        )
        .to.emit(WETHPair, "Sync")
        .withArgs(
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? WETHPartnerAmount + expectedSwapAmount
            : ETHAmount - outputAmount,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? ETHAmount - outputAmount
            : WETHPartnerAmount + expectedSwapAmount,
        )
        .to.emit(WETHPair, "Swap")
        .withArgs(
          await router02.getAddress(),
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? expectedSwapAmount
            : 0,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? 0
            : expectedSwapAmount,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? 0
            : outputAmount,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? outputAmount
            : 0,
          await router02.getAddress(),
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
      await WETHPartner.transfer(
        await WETHPair.getAddress(),
        WETHPartnerAmount,
      );
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(await WETHPair.getAddress(), ETHAmount);
      await WETHPair.mint(wallet.address);

      await WETHPartner.approve(
        await RouterEmit.getAddress(),
        ethers.MaxUint256,
      );
      await expect(
        RouterEmit.swapTokensForExactETH(
          await router02.getAddress(),
          outputAmount,
          ethers.MaxUint256,
          [await WETHPartner.getAddress(), await WETH.getAddress()],
          wallet.address,
          ethers.MaxUint256,
        ),
      )
        .to.emit(RouterEmit, "Amounts")
        .withArgs([expectedSwapAmount, outputAmount]);
    });
  });

  describe("swapExactTokensForETH", () => {
    const WETHPartnerAmount = expandTo18Decimals(5);
    const ETHAmount = expandTo18Decimals(10);
    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = 1662497915624478906n;

    it("happy path", async () => {
      const {
        router02,
        wallet,
        WETHPartner,
        wethPair: WETHPair,
        WETH,
      } = await loadFixture(v2Fixture);

      //before each
      await WETHPartner.transfer(
        await WETHPair.getAddress(),
        WETHPartnerAmount,
      );
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(await WETHPair.getAddress(), ETHAmount);
      await WETHPair.mint(wallet.address);

      await WETHPartner.approve(await router02.getAddress(), ethers.MaxUint256);
      const WETHPairToken0 = await WETHPair.token0();
      await expect(
        router02.swapExactTokensForETH(
          swapAmount,
          0,
          [await WETHPartner.getAddress(), await WETH.getAddress()],
          wallet.address,
          ethers.MaxUint256,
        ),
      )
        .to.emit(WETHPartner, "Transfer")
        .withArgs(wallet.address, await WETHPair.getAddress(), swapAmount)
        .to.emit(WETH, "Transfer")
        .withArgs(
          await WETHPair.getAddress(),
          await router02.getAddress(),
          expectedOutputAmount,
        )
        .to.emit(WETHPair, "Sync")
        .withArgs(
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? WETHPartnerAmount + swapAmount
            : ETHAmount - expectedOutputAmount,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? ETHAmount - expectedOutputAmount
            : WETHPartnerAmount + swapAmount,
        )
        .to.emit(WETHPair, "Swap")
        .withArgs(
          await router02.getAddress(),
          WETHPairToken0 === (await WETHPartner.getAddress()) ? swapAmount : 0,
          WETHPairToken0 === (await WETHPartner.getAddress()) ? 0 : swapAmount,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? 0
            : expectedOutputAmount,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? expectedOutputAmount
            : 0,
          await router02.getAddress(),
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
      await WETHPartner.transfer(
        await WETHPair.getAddress(),
        WETHPartnerAmount,
      );
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(await WETHPair.getAddress(), ETHAmount);
      await WETHPair.mint(wallet.address);

      await WETHPartner.approve(
        await RouterEmit.getAddress(),
        ethers.MaxUint256,
      );
      await expect(
        RouterEmit.swapExactTokensForETH(
          await router02.getAddress(),
          swapAmount,
          0,
          [await WETHPartner.getAddress(), await WETH.getAddress()],
          wallet.address,
          ethers.MaxUint256,
        ),
      )
        .to.emit(RouterEmit, "Amounts")
        .withArgs([swapAmount, expectedOutputAmount]);
    });
  });

  describe("swapETHForExactTokens", () => {
    const WETHPartnerAmount = expandTo18Decimals(10);
    const ETHAmount = expandTo18Decimals(5);
    const expectedSwapAmount = 557227237267357629n;
    const outputAmount = expandTo18Decimals(1);

    it("happy path", async () => {
      const {
        router02,
        wallet,
        WETHPartner,
        wethPair: WETHPair,
        WETH,
      } = await loadFixture(v2Fixture);

      await WETHPartner.transfer(
        await WETHPair.getAddress(),
        WETHPartnerAmount,
      );
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(await WETHPair.getAddress(), ETHAmount);
      await WETHPair.mint(wallet.address);

      const WETHPairToken0 = await WETHPair.token0();
      await expect(
        router02.swapETHForExactTokens(
          outputAmount,
          [await WETH.getAddress(), await WETHPartner.getAddress()],
          wallet.address,
          ethers.MaxUint256,
          {
            value: expectedSwapAmount,
          },
        ),
      )
        .to.emit(WETH, "Transfer")
        .withArgs(
          await router02.getAddress(),
          await WETHPair.getAddress(),
          expectedSwapAmount,
        )
        .to.emit(WETHPartner, "Transfer")
        .withArgs(await WETHPair.getAddress(), wallet.address, outputAmount)
        .to.emit(WETHPair, "Sync")
        .withArgs(
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? WETHPartnerAmount - outputAmount
            : ETHAmount + expectedSwapAmount,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? ETHAmount + expectedSwapAmount
            : WETHPartnerAmount - outputAmount,
        )
        .to.emit(WETHPair, "Swap")
        .withArgs(
          await router02.getAddress(),
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? 0
            : expectedSwapAmount,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? expectedSwapAmount
            : 0,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? outputAmount
            : 0,
          WETHPairToken0 === (await WETHPartner.getAddress())
            ? 0
            : outputAmount,
          wallet.address,
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

      await WETHPartner.transfer(
        await WETHPair.getAddress(),
        WETHPartnerAmount,
      );
      await WETH.deposit({ value: ETHAmount });
      await WETH.transfer(await WETHPair.getAddress(), ETHAmount);
      await WETHPair.mint(wallet.address);

      await expect(
        RouterEmit.swapETHForExactTokens(
          await router02.getAddress(),
          outputAmount,
          [await WETH.getAddress(), await WETHPartner.getAddress()],
          wallet.address,
          ethers.MaxUint256,
          {
            value: expectedSwapAmount,
          },
        ),
      )
        .to.emit(RouterEmit, "Amounts")
        .withArgs([expectedSwapAmount, outputAmount]);
    });
  });
});
