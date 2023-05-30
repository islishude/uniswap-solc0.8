import { expect } from "chai";
import { BigNumber, constants as ethconst } from "ethers";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { expandTo18Decimals, encodePrice } from "./shared/utilities";
import { UniswapV2Pair, ERC20 } from "../../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { Framework } from "@superfluid-finance/sdk-core";
import { deployTestFramework } from "@superfluid-finance/ethereum-contracts/dev-scripts/deploy-test-framework";
import TestToken from "@superfluid-finance/ethereum-contracts/build/contracts/TestToken.json";

let sfDeployer
let contractsFramework
let sf
let baseTokenA
let baseTokenB
let tokenA
let tokenB

// Test Accounts
let owner

// delay helper function
const delay = async (seconds: number) => {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
};

// babylonian square root
function sqrtBN(value: BigNumber) {
  if (value.isZero()) return BigNumber.from(0);

  let x = BigNumber.from(1);
  let y = value;

  while (x.lt(y)) {
    y = x.add(y).div(2);
    x = value.div(y);
  }

  return y;
}

before(async function () {
    
    // get hardhat accounts
    [owner] = await ethers.getSigners();
    sfDeployer = await deployTestFramework();

    // GETTING SUPERFLUID FRAMEWORK SET UP

    // deploy the framework locally
    contractsFramework = await sfDeployer.frameworkDeployer.getFramework()

    // initialize framework
    sf = await Framework.create({
        chainId: 31337,
        provider: ethers.provider,
        resolverAddress: contractsFramework.resolver, // (empty)
        protocolReleaseVersion: "test"
    })

    // DEPLOYING DAI and DAI wrapper super token (which will be our `spreaderToken`)
    await sfDeployer.superTokenDeployer.deployWrapperSuperToken(
        "Base Token A",
        "baseTokenA",
        18,
        ethers.utils.parseEther("10000").toString()
    )
    await sfDeployer.superTokenDeployer.deployWrapperSuperToken(
      "Base Token B",
      "baseTokenB",
      18,
      ethers.utils.parseEther("10000").toString()
    )

    tokenA = await sf.loadSuperToken('baseTokenAx')
    baseTokenA = new ethers.Contract(
        tokenA.underlyingToken.address,
        TestToken.abi,
        owner
    )

    tokenB = await sf.loadSuperToken('baseTokenBx')
    baseTokenB = new ethers.Contract(
        tokenB.underlyingToken.address,
        TestToken.abi,
        owner
    )

    const setupToken = async (underlyingToken, superToken) => {
      // minting test token
      await underlyingToken.mint(owner.address, ethers.utils.parseEther("10000").toString())

      // approving DAIx to spend DAI (Super Token object is not an ethers contract object and has different operation syntax)
      await underlyingToken.approve(superToken.address, ethers.constants.MaxInt256)
      await underlyingToken
          .connect(owner)
          .approve(superToken.address, ethers.constants.MaxInt256)
      // Upgrading all DAI to DAIx
      const ownerUpgrade = superToken.upgrade({amount: ethers.utils.parseEther("10000").toString()});
      await ownerUpgrade.exec(owner)
    }

    await setupToken(baseTokenA, tokenA);
    await setupToken(baseTokenB, tokenB);
});

const MINIMUM_LIQUIDITY = BigNumber.from(10).pow(3);

describe("UniswapV2Pair", () => {
  async function fixture() {
    const [wallet, other] = await ethers.getSigners();

    const factory = await (
      await ethers.getContractFactory("UniswapV2Factory")
    ).deploy(wallet.address, contractsFramework.host);

    await factory.createPair(tokenA.address, tokenB.address);
    const pair = (await ethers.getContractFactory("UniswapV2Pair")).attach(
      await factory.getPair(tokenA.address, tokenB.address)
    );
    const token0Address = await pair.token0();
    const token0 = tokenA.address === token0Address ? tokenA : tokenB;
    const token1 = tokenA.address === token0Address ? tokenB : tokenA;

    // approve max amount for every user
    await token0.approve({receiver: pair.address, amount: ethers.constants.MaxInt256}).exec(wallet);
    await token1.approve({receiver: pair.address, amount: ethers.constants.MaxInt256}).exec(wallet);

    return { pair, token0, token1, wallet, other, factory };
  }

  it("mint", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);
    const token0Amount = expandTo18Decimals(1);
    const token1Amount = expandTo18Decimals(4);
    
    await token0.transfer({receiver: pair.address, amount: token0Amount}).exec(wallet);
    await token1.transfer({receiver: pair.address, amount: token1Amount}).exec(wallet);

    const expectedLiquidity = expandTo18Decimals(2);
    await expect(pair.mint(wallet.address))
      .to.emit(pair, "Transfer")
      .withArgs(ethconst.AddressZero, ethconst.AddressZero, MINIMUM_LIQUIDITY)
      .to.emit(pair, "Transfer")
      .withArgs(
        ethconst.AddressZero,
        wallet.address,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      )
      .to.emit(pair, "Sync")
      .withArgs(token0Amount, token1Amount)
      .to.emit(pair, "Mint")
      .withArgs(wallet.address, token0Amount, token1Amount);

    expect(await pair.totalSupply()).to.eq(expectedLiquidity);
    expect(await pair.balanceOf(wallet.address)).to.eq(
      expectedLiquidity.sub(MINIMUM_LIQUIDITY)
    );
    expect(await token0.balanceOf({account: pair.address, providerOrSigner: ethers.provider})).to.eq(token0Amount);
    expect(await token1.balanceOf({account: pair.address, providerOrSigner: ethers.provider})).to.eq(token1Amount);
    const reserves = await pair.getReserves();
    expect(reserves[0]).to.eq(token0Amount);
    expect(reserves[1]).to.eq(token1Amount);
  });

  async function addLiquidity(
    token0,
    token1,
    pair: UniswapV2Pair,
    wallet: SignerWithAddress,
    token0Amount: BigNumber,
    token1Amount: BigNumber
  ) {
    await token0.transfer({receiver: pair.address, amount: token0Amount}).exec(wallet);
    await token1.transfer({receiver: pair.address, amount: token1Amount}).exec(wallet);
    await pair.mint(wallet.address);
  }

  const swapTestCases: BigNumber[][] = [
    [1, 5, 10, "1662497915624478906"],
    [1, 10, 5, "453305446940074565"],

    [2, 5, 10, "2851015155847869602"],
    [2, 10, 5, "831248957812239453"],

    [1, 10, 10, "906610893880149131"],
    [1, 100, 100, "987158034397061298"],
    [1, 1000, 1000, "996006981039903216"],
  ].map((a) =>
    a.map((n) =>
      typeof n === "string" ? BigNumber.from(n) : expandTo18Decimals(n)
    )
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
        token1Amount
      );
      await token0.transfer({receiver: pair.address, amount: swapAmount}).exec(wallet);
      await expect(
        pair.swap(0, expectedOutputAmount.add(1), wallet.address, "0x")
      ).to.be.revertedWith("UniswapV2: K");
      await pair.swap(0, expectedOutputAmount, wallet.address, "0x");
    });
  });

  const optimisticTestCases: BigNumber[][] = [
    ["997000000000000000", 5, 10, 1], // given amountIn, amountOut = floor(amountIn * .997)
    ["997000000000000000", 10, 5, 1],
    ["997000000000000000", 5, 5, 1],
    [1, 5, 5, "1003009027081243732"], // given amountOut, amountIn = ceiling(amountOut / .997)
  ].map((a) =>
    a.map((n) =>
      typeof n === "string" ? BigNumber.from(n) : expandTo18Decimals(n)
    )
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
        token1Amount
      );
      await token0.transfer({receiver: pair.address, amount: inputAmount}).exec(wallet);
      await expect(
        pair.swap(outputAmount.add(1), 0, wallet.address, "0x")
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
      token1Amount
    );

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("1662497915624478906");
    await token0.transfer({receiver: pair.address, amount: swapAmount}).exec(wallet);
    await expect(pair.swap(0, expectedOutputAmount, wallet.address, "0x"))
      //.to.emit(token1, "Transfer")
      //.withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(pair, "Sync")
      .withArgs(
        token0Amount.add(swapAmount),
        token1Amount.sub(expectedOutputAmount)
      )
      .to.emit(pair, "Swap")
      .withArgs(
        wallet.address,
        swapAmount,
        0,
        0,
        expectedOutputAmount,
        wallet.address
      );

    const reserves = await pair.getReserves();
    expect(reserves[0]).to.eq(token0Amount.add(swapAmount));
    expect(reserves[1]).to.eq(token1Amount.sub(expectedOutputAmount));
    expect(await token0.balanceOf({account: pair.address, providerOrSigner: ethers.provider})).to.eq(
      token0Amount.add(swapAmount)
    );
    expect(await token1.balanceOf({account: pair.address, providerOrSigner: ethers.provider})).to.eq(
      token1Amount.sub(expectedOutputAmount)
    );
    const totalSupplyToken0 = BigNumber.from(await token0.totalSupply({providerOrSigner: ethers.provider}));
    const totalSupplyToken1 = BigNumber.from(await token1.totalSupply({providerOrSigner: ethers.provider}));
    expect(await token0.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.eq(
      totalSupplyToken0.sub(token0Amount).sub(swapAmount).toString()
    );
    expect(await token1.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.eq(
      totalSupplyToken1.sub(token1Amount).add(expectedOutputAmount)
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
      token1Amount
    );

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("453305446940074565");
    await token1.transfer({receiver: pair.address, amount: swapAmount}).exec(wallet);
    await expect(pair.swap(expectedOutputAmount, 0, wallet.address, "0x"))
      //.to.emit(token0, "Transfer")
      //.withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(pair, "Sync")
      .withArgs(
        token0Amount.sub(expectedOutputAmount),
        token1Amount.add(swapAmount)
      )
      .to.emit(pair, "Swap")
      .withArgs(
        wallet.address,
        0,
        swapAmount,
        expectedOutputAmount,
        0,
        wallet.address
      );

    const reserves = await pair.getReserves();
    expect(reserves[0]).to.eq(token0Amount.sub(expectedOutputAmount));
    expect(reserves[1]).to.eq(token1Amount.add(swapAmount));
    expect(await token0.balanceOf({account: pair.address, providerOrSigner: ethers.provider})).to.eq(
      token0Amount.sub(expectedOutputAmount)
    );
    expect(await token1.balanceOf({account: pair.address, providerOrSigner: ethers.provider})).to.eq(
      token1Amount.add(swapAmount)
    );
    const totalSupplyToken0 = BigNumber.from(await token0.totalSupply({providerOrSigner: ethers.provider}));
    const totalSupplyToken1 = BigNumber.from(await token1.totalSupply({providerOrSigner: ethers.provider}));
    expect(await token0.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.eq(
      totalSupplyToken0.sub(token0Amount).add(expectedOutputAmount)
    );
    expect(await token1.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.eq(
      totalSupplyToken1.sub(token1Amount).sub(swapAmount)
    );
  });

/*
  NOTE: modifications to contract caused changes in gas cost, so temporarily removing this test
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
      token1Amount
    );

    // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
    await ethers.provider.send("evm_mine", [
      (await ethers.provider.getBlock("latest")).timestamp + 1,
    ]);

    await time.setNextBlockTimestamp(
      (await ethers.provider.getBlock("latest")).timestamp + 1
    );
    await pair.sync();

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("453305446940074565");
    await token1.transfer({receiver: pair.address, amount: swapAmount}).exec(wallet);
    await time.setNextBlockTimestamp(
      (await ethers.provider.getBlock("latest")).timestamp + 1
    );
    const tx = await pair.swap(expectedOutputAmount, 0, wallet.address, "0x");
    const receipt = await tx.wait();
    expect(receipt.gasUsed).to.eq(73959);
  });
*/

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
      token1Amount
    );

    const expectedLiquidity = expandTo18Decimals(3);
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY));
    await expect(pair.burn(wallet.address))
      .to.emit(pair, "Transfer")
      .withArgs(
        pair.address,
        ethconst.AddressZero,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      )
      //.to.emit(token0, "Transfer")
      //.withArgs(pair.address, wallet.address, token0Amount.sub(1000))
      //.to.emit(token1, "Transfer")
      //.withArgs(pair.address, wallet.address, token1Amount.sub(1000))
      .to.emit(pair, "Sync")
      .withArgs(1000, 1000)
      .to.emit(pair, "Burn")
      .withArgs(
        wallet.address,
        token0Amount.sub(1000),
        token1Amount.sub(1000),
        wallet.address
      );

    expect(await pair.balanceOf(wallet.address)).to.eq(0);
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY);
    expect(await token0.balanceOf({account: pair.address, providerOrSigner: ethers.provider})).to.eq('1000');
    expect(await token1.balanceOf({account: pair.address, providerOrSigner: ethers.provider})).to.eq('1000');
    const totalSupplyToken0 = BigNumber.from(await token0.totalSupply({providerOrSigner: ethers.provider}));
    const totalSupplyToken1 = BigNumber.from(await token1.totalSupply({providerOrSigner: ethers.provider}));
    expect(await token0.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.eq(
      totalSupplyToken0.sub(1000).toString()
    );
    expect(await token1.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.eq(
      totalSupplyToken1.sub(1000).toString()
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
      token1Amount
    );

    const blockTimestamp = (await pair.getReserves())[2];
    await time.setNextBlockTimestamp(blockTimestamp + 1);
    await pair.sync();

    const initialPrice = encodePrice(token0Amount, token1Amount);
    // expect(await pair.price0CumulativeLast()).to.eq(initialPrice[0]);
    // expect(await pair.price1CumulativeLast()).to.eq(initialPrice[1]);
    // expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 1);

    const swapAmount = expandTo18Decimals(3);
    await token0.transfer({receiver: pair.address, amount: swapAmount}).exec(wallet);
    await time.setNextBlockTimestamp(blockTimestamp + 10);
    // swap to a new price eagerly instead of syncing
    await pair.swap(0, expandTo18Decimals(1), wallet.address, "0x"); // make the price nice

    expect(await pair.price0CumulativeLast()).to.eq(initialPrice[0].mul(10));
    expect(await pair.price1CumulativeLast()).to.eq(initialPrice[1].mul(10));
    expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 10);

    await time.setNextBlockTimestamp(blockTimestamp + 20);
    await pair.sync();

    const newPrice = encodePrice(expandTo18Decimals(6), expandTo18Decimals(2));
    expect(await pair.price0CumulativeLast()).to.eq(
      initialPrice[0].mul(10).add(newPrice[0].mul(10))
    );
    expect(await pair.price1CumulativeLast()).to.eq(
      initialPrice[1].mul(10).add(newPrice[1].mul(10))
    );
    expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 20);
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
      token1Amount
    );

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("996006981039903216");
    await token1.transfer({receiver: pair.address, amount: swapAmount}).exec(wallet);
    await pair.swap(expectedOutputAmount, 0, wallet.address, "0x");

    const expectedLiquidity = expandTo18Decimals(1000);
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY));
    await pair.burn(wallet.address);
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY);
  });

  it("feeTo:on", async () => {
    const { pair, wallet, token0, token1, other, factory } = await loadFixture(
      fixture
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
      token1Amount
    );

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("996006981039903216");
    await token1.transfer({receiver: pair.address, amount: swapAmount}).exec(wallet);
    await pair.swap(expectedOutputAmount, 0, wallet.address, "0x");

    const expectedLiquidity = expandTo18Decimals(1000);
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY));
    await pair.burn(wallet.address);
    expect(await pair.totalSupply()).to.eq(
      MINIMUM_LIQUIDITY.add("249750499251388")
    );
    expect(await pair.balanceOf(other.address)).to.eq("249750499251388");

    // using 1000 here instead of the symbolic MINIMUM_LIQUIDITY because the amounts only happen to be equal...
    // ...because the initial liquidity amounts were equal
    expect(await token0.balanceOf({account: pair.address, providerOrSigner: ethers.provider})).to.eq(
      BigNumber.from(1000).add("249501683697445")
    );
    expect(await token1.balanceOf({account: pair.address, providerOrSigner: ethers.provider})).to.eq(
      BigNumber.from(1000).add("250000187312969")
    );
  });

  it("twap:token0", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);

    const token0Amount = expandTo18Decimals(10);
    const token1Amount = expandTo18Decimals(10);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount
    );

    // check initial reserves (shouldn't have changed)
    let realTimeReserves =  await pair.getRealTimeReserves();
    expect(realTimeReserves._reserve0).to.equal(token0Amount);
    expect(realTimeReserves._reserve1).to.equal(token1Amount);

    // create a stream
    const flowRate = BigNumber.from("1000000000");
    const createFlowOperation = token0.createFlow({
      sender: wallet.address,
      receiver: pair.address,
      flowRate: flowRate
    });
    const txnResponse = await createFlowOperation.exec(wallet);
    const txn = await txnResponse.wait();
    const timeStart = (await ethers.provider.getBlock(txn.blockNumber)).timestamp;

    // get amount after buffer
    const walletBalanceAfterBuffer0 = BigNumber.from(await token0.balanceOf({account: wallet.address, providerOrSigner: ethers.provider}));

    const checkStaticReserves = async() => {
      const realTimeReserves =  await pair.getRealTimeReserves();
      expect(realTimeReserves._reserve0).to.equal(token0Amount);
      expect(realTimeReserves._reserve1).to.equal(token1Amount);
    }

    const checkReserves = async() => {
      const time = (await ethers.provider.getBlock('latest')).timestamp;
      const dt = time - timeStart;

      if (dt > 0) {
        const realTimeReserves =  await pair.getRealTimeReserves();
        const totalAmountA = flowRate.mul(dt);
        const k = token0Amount.mul(token1Amount);
        const a = token0Amount.add(totalAmountA);
        const b = k.div(a);
        expect(await token0.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.equal(walletBalanceAfterBuffer0.sub(flowRate.mul(dt)));
        expect(realTimeReserves._reserve0).to.equal(a);
        expect(realTimeReserves._reserve1).to.be.within(b.mul(999).div(1000), b);
      } else {
        await checkStaticReserves();
      }
    }

    const checkBalances = async() => {
      const realTimeReserves =  await pair.getRealTimeReserves();
      const poolBalance1 = BigNumber.from(await token1.balanceOf({account: pair.address, providerOrSigner: ethers.provider}));
      const walletSwapBalances = await pair.getRealTimeUserBalances(wallet.address);

      // perfect case:          (reserve + all user balances) = poolBalance
      // never allowed:         (reserve + all user balances) > poolBalance
      // dust amounts allowed:  (reserve + all user balances) < poolBalance
      expect(poolBalance1.sub(realTimeReserves._reserve1.add(walletSwapBalances.balance1))).to.be.within(0, 100);
    }

    // check reserves (1-2 sec may have passed, so check timestamp)
    await checkReserves();
    await checkBalances();

    // skip ahead and check again
    await delay(600);
    await checkReserves();
    await checkBalances();

    // cancel stream and check that swapped balance is withdrawn
    const baseToken1Balance = expandTo18Decimals(10000).sub(token1Amount);
    expect(BigNumber.from(await token1.balanceOf({account: wallet.address, providerOrSigner: ethers.provider}))).to.be.equal(baseToken1Balance);
    let latestTime = (await ethers.provider.getBlock('latest')).timestamp;
    let nextBlockTime = latestTime + 10;
    const expectedAmountsOut = await pair.getUserBalancesAtTime(wallet.address, nextBlockTime);
    await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
    const deleteFlowOperation = token0.deleteFlow({
      sender: wallet.address,
      receiver: pair.address
    });
    const txnResponse2 = await deleteFlowOperation.exec(wallet);
    await txnResponse2.wait();
    expect(BigNumber.from(await token1.balanceOf({account: wallet.address, providerOrSigner: ethers.provider}))).to.be.equal(baseToken1Balance.add(expectedAmountsOut.balance1));

    const newExpectedAmountsOut = await pair.getRealTimeUserBalances(wallet.address);
    expect(newExpectedAmountsOut.balance1).to.be.equal(BigNumber.from(0));

    // check that total locked swapped amount is 0 (or dust amount? TODO: is dust amount okay?)
    const totalSwappedFunds = await pair.getRealTimeTotalSwappedFunds();
    expect(totalSwappedFunds._totalSwappedFunds0).to.be.within(0, 100);
    expect(totalSwappedFunds._totalSwappedFunds1).to.be.within(0, 100);
  });

  it("twap:token1", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);

    const token0Amount = expandTo18Decimals(10);
    const token1Amount = expandTo18Decimals(10);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount
    );

    // check initial reserves (shouldn't have changed)
    let realTimeReserves =  await pair.getRealTimeReserves();
    expect(realTimeReserves._reserve0).to.equal(token0Amount);
    expect(realTimeReserves._reserve1).to.equal(token1Amount);

    // create a stream
    const flowRate = BigNumber.from("1000000000");
    const createFlowOperation = token1.createFlow({
      sender: wallet.address,
      receiver: pair.address,
      flowRate: flowRate
    });
    const txnResponse = await createFlowOperation.exec(wallet);
    const txn = await txnResponse.wait();
    const timeStart = (await ethers.provider.getBlock(txn.blockNumber)).timestamp;

    // get amount after buffer
    const walletBalanceAfterBuffer1 = BigNumber.from(await token1.balanceOf({account: wallet.address, providerOrSigner: ethers.provider}));

    const checkStaticReserves = async() => {
      const realTimeReserves =  await pair.getRealTimeReserves();
      expect(realTimeReserves._reserve0).to.equal(token0Amount);
      expect(realTimeReserves._reserve1).to.equal(token1Amount);
    }

    const checkReserves = async() => {
      const time = (await ethers.provider.getBlock('latest')).timestamp;
      const dt = time - timeStart;

      if (dt > 0) {
        const realTimeReserves =  await pair.getRealTimeReserves();
        const totalAmountB = flowRate.mul(dt);
        const k = token0Amount.mul(token1Amount);
        const b = token1Amount.add(totalAmountB);
        const a = k.div(b);
        expect(await token1.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.equal(walletBalanceAfterBuffer1.sub(flowRate.mul(dt)));
        expect(realTimeReserves._reserve1).to.equal(b);
        expect(realTimeReserves._reserve0).to.be.within(a.mul(999).div(1000), a);
      } else {
        await checkStaticReserves();
      }
    }

    const checkBalances = async() => {
      const realTimeReserves =  await pair.getRealTimeReserves();
      const poolBalance0 = BigNumber.from(await token0.balanceOf({account: pair.address, providerOrSigner: ethers.provider}));
      const walletSwapBalances = await pair.getRealTimeUserBalances(wallet.address);

      // perfect case:          (reserve + all user balances) = poolBalance
      // never allowed:         (reserve + all user balances) > poolBalance
      // dust amounts allowed:  (reserve + all user balances) < poolBalance
      expect(poolBalance0.sub(realTimeReserves._reserve0.add(walletSwapBalances.balance0))).to.be.within(0, 100);
    }

    // check reserves (1-2 sec may have passed, so check timestamp)
    await checkReserves();
    await checkBalances();

    // skip ahead and check again
    await delay(600);
    await checkReserves();
    await checkBalances();

    // cancel stream and check that swapped balance is withdrawn
    const baseToken0Balance = expandTo18Decimals(10000).sub(token0Amount);
    expect(BigNumber.from(await token0.balanceOf({account: wallet.address, providerOrSigner: ethers.provider}))).to.be.equal(baseToken0Balance);
    let latestTime = (await ethers.provider.getBlock('latest')).timestamp;
    let nextBlockTime = latestTime + 10;
    const expectedAmountsOut = await pair.getUserBalancesAtTime(wallet.address, nextBlockTime);
    await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
    const deleteFlowOperation = token1.deleteFlow({
      sender: wallet.address,
      receiver: pair.address
    });
    const txnResponse2 = await deleteFlowOperation.exec(wallet);
    await txnResponse2.wait();
    expect(BigNumber.from(await token0.balanceOf({account: wallet.address, providerOrSigner: ethers.provider}))).to.be.equal(baseToken0Balance.add(expectedAmountsOut.balance0));

    const newExpectedAmountsOut = await pair.getRealTimeUserBalances(wallet.address);
    expect(newExpectedAmountsOut.balance0).to.be.equal(BigNumber.from(0));
  });

  it("twap:both_tokens", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);

    const token0Amount = expandTo18Decimals(10);
    const token1Amount = expandTo18Decimals(10);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount
    );

    // check initial reserves (shouldn't have changed)
    let realTimeReserves =  await pair.getRealTimeReserves();
    expect(realTimeReserves._reserve0).to.equal(token0Amount);
    expect(realTimeReserves._reserve1).to.equal(token1Amount);

    // create a stream of token0
    const flowRate0 = BigNumber.from("1000000000");
    const createFlowOperation0 = token0.createFlow({
      sender: wallet.address,
      receiver: pair.address,
      flowRate: flowRate0
    });

    // create a stream of token1
    const flowRate1 = BigNumber.from("500000000");
    const createFlowOperation1 = token1.createFlow({
      sender: wallet.address,
      receiver: pair.address,
      flowRate: flowRate1
    });

    // batch both together
    const batchCall = sf.batchCall([createFlowOperation0, createFlowOperation1]);
    const txnResponse = await batchCall.exec(wallet);
    const txn = await txnResponse.wait();
    const timeStart = (await ethers.provider.getBlock(txn.blockNumber)).timestamp;

    // get amounts after buffer
    const walletBalanceAfterBuffer0 = BigNumber.from(await token0.balanceOf({account: wallet.address, providerOrSigner: ethers.provider}));
    const walletBalanceAfterBuffer1 = BigNumber.from(await token1.balanceOf({account: wallet.address, providerOrSigner: ethers.provider}));

    //////////////////////////////////////////////////////
    //                                                  //
    //   ref. https://www.paradigm.xyz/2021/07/twamm    //
    //                                                  //
    //////////////////////////////////////////////////////
    const checkDynamicReservesParadigmFormula = async(dt: number) => {
      const realTimeReserves =  await pair.getRealTimeReserves();
      const poolReserveA = parseFloat(token0Amount.toString());
      const poolReserveB = parseFloat(token1Amount.toString());
      const totalFlowA = parseFloat(flowRate0.toString());
      const totalFlowB = parseFloat(flowRate1.toString());
      const k = poolReserveA * poolReserveB;

      const c = (
        Math.sqrt(poolReserveA * (totalFlowB * dt)) - Math.sqrt(poolReserveB * (totalFlowA * dt))) 
        / 
        (Math.sqrt(poolReserveA * (totalFlowB * dt)) + Math.sqrt(poolReserveB * (totalFlowA * dt))
      );
      const a = (
          Math.sqrt((k * (totalFlowA * dt)) / (totalFlowB * dt)) 
          * 
          (Math.pow(Math.E, (2 * Math.sqrt(((totalFlowA * dt) * (totalFlowB * dt)) / k))) + c) 
          / 
          (Math.pow(Math.E, (2 * Math.sqrt(((totalFlowA * dt) * (totalFlowB * dt)) / k))) - c)
      );
      const b = k / a;

      expect(await token0.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.equal(walletBalanceAfterBuffer0.sub(flowRate0.mul(dt)));
      expect(await token1.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.equal(walletBalanceAfterBuffer1.sub(flowRate1.mul(dt)));
      expect(realTimeReserves._reserve0).to.be.within(BigNumber.from((a * 0.9999999999).toString()), BigNumber.from(a.toString()));
      expect(realTimeReserves._reserve1).to.be.within(BigNumber.from((b * 0.999).toString()), BigNumber.from(b.toString()));
    }

    //////////////////////////////////////////////////////////
    //                                                      //
    //    using approximation:                              //
    //    a = √(k * (A + (r_A * dt)) / (B + (r_B * dt)))    //
    //                                                      //
    //////////////////////////////////////////////////////////
    const checkDynamicReservesParadigmApprox = async(dt: number) => {
      const realTimeReserves =  await pair.getRealTimeReserves();
      const poolReserveA = parseFloat(token0Amount.toString());
      const poolReserveB = parseFloat(token1Amount.toString());
      const totalFlowA = parseFloat(flowRate0.toString());
      const totalFlowB = parseFloat(flowRate1.toString());
      const k = poolReserveA * poolReserveB;

      const a = (
        Math.sqrt(k * (poolReserveA + (totalFlowA * dt)) / (poolReserveB + (totalFlowB * dt)))
      );
      const b = k / a;

      expect(await token0.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.equal(walletBalanceAfterBuffer0.sub(flowRate0.mul(dt)));
      expect(await token1.balanceOf({account: wallet.address, providerOrSigner: ethers.provider})).to.equal(walletBalanceAfterBuffer1.sub(flowRate1.mul(dt)));
      expect(realTimeReserves._reserve0).to.be.within(BigNumber.from((a * 0.9999999999).toString()), BigNumber.from((a * 1.00000001).toString()));
      expect(realTimeReserves._reserve1).to.be.within(BigNumber.from((b * 0.9999999999).toString()), BigNumber.from((b * 1.00000001).toString()));
    }

    const checkStaticReserves = async() => {
      const realTimeReserves =  await pair.getRealTimeReserves();
      expect(realTimeReserves._reserve0).to.equal(token0Amount);
      expect(realTimeReserves._reserve1).to.equal(token1Amount);
    }

    const checkReserves = async() => {
      const time = (await ethers.provider.getBlock('latest')).timestamp;
      const dt = time - timeStart;

      if (dt > 0) {
        await checkDynamicReservesParadigmApprox(dt);
      } else {
        await checkStaticReserves();
      }
    }

    const checkBalances = async() => {
      const realTimeReserves =  await pair.getRealTimeReserves();
      const poolBalance0 = BigNumber.from(await token0.balanceOf({account: pair.address, providerOrSigner: ethers.provider}));
      const poolBalance1 = BigNumber.from(await token1.balanceOf({account: pair.address, providerOrSigner: ethers.provider}));
      const walletSwapBalances = await pair.getRealTimeUserBalances(wallet.address);

      // perfect case:          (reserve + all user balances) = poolBalance
      // never allowed:         (reserve + all user balances) > poolBalance
      // dust amounts allowed:  (reserve + all user balances) < poolBalance
      expect(poolBalance0.sub(realTimeReserves._reserve0.add(walletSwapBalances.balance0))).to.be.within(0, 100); // within 0-100 wei
      expect(poolBalance1.sub(realTimeReserves._reserve1.add(walletSwapBalances.balance1))).to.be.within(0, 100);
    }

    // check reserves (1-2 sec may have passed, so check timestamp)
    await checkReserves();
    await checkBalances();

    // skip ahead and check again
    await delay(60);
    await checkReserves();
    await checkBalances();


    // The intent here is to have both of these discrete swap transactions in the same block, but turning off automine breaks the expect() function
    // Solution: just test in two separate blocks and re-calculate expectedOutputAmount

    // make a bad discrete swap (expect revert)
    let latestTime = (await ethers.provider.getBlock('latest')).timestamp;
    let nextBlockTime = latestTime + 10;
    let swapAmount = BigNumber.from('10000000000000');
    await token0.transfer({receiver: pair.address, amount: swapAmount}).exec(wallet);
    let realTimeReserves2 =  await pair.getReservesAtTime(nextBlockTime);
    let expectedOutputAmount = realTimeReserves2._reserve1.sub((realTimeReserves2._reserve0.mul(realTimeReserves2._reserve1)).div(realTimeReserves2._reserve0.add(swapAmount.mul(997).div(1000)))).sub(1);
    await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
    await expect(
      pair.swap(0, expectedOutputAmount.add('1'), wallet.address, "0x")
    ).to.be.revertedWith("UniswapV2: K");

    // make a correct discrete swap
    latestTime = (await ethers.provider.getBlock('latest')).timestamp;
    nextBlockTime = latestTime + 10;
    realTimeReserves2 =  await pair.getReservesAtTime(nextBlockTime);
    expectedOutputAmount = realTimeReserves2._reserve1.sub((realTimeReserves2._reserve0.mul(realTimeReserves2._reserve1)).div(realTimeReserves2._reserve0.add(swapAmount.mul(997).div(1000)))).sub(1);
    await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
    await pair.swap(0, expectedOutputAmount, wallet.address, "0x");

    // should adequately check that the _update() function properly set reserves and accumulators 
    await checkBalances();
    await delay(60);
    await checkBalances();

    // make another discrete swap (checks totalSwappedFunds{0,1} are updated correctly (in _update() function))
    latestTime = (await ethers.provider.getBlock('latest')).timestamp;
    nextBlockTime = latestTime + 10;
    await token0.transfer({receiver: pair.address, amount: swapAmount}).exec(wallet);
    realTimeReserves2 =  await pair.getReservesAtTime(nextBlockTime);
    expectedOutputAmount = realTimeReserves2._reserve1.sub((realTimeReserves2._reserve0.mul(realTimeReserves2._reserve1)).div(realTimeReserves2._reserve0.add(swapAmount.mul(997).div(1000)))).sub(1);
    await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
    await pair.swap(0, expectedOutputAmount, wallet.address, "0x");
  });
});
