import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { expandTo18Decimals, UniswapVersion } from "./shared/utilities";

const TOTAL_SUPPLY = expandTo18Decimals(10000);
const TEST_AMOUNT = expandTo18Decimals(10);

describe("UniswapV2ERC20", () => {
  async function fixture() {
    const factory = await ethers.getContractFactory("ERC20");
    const token = await factory.deploy(TOTAL_SUPPLY);
    const [wallet, other] = await ethers.getSigners();
    return { token, wallet, other };
  }

  it("name, symbol, decimals, totalSupply, balanceOf, DOMAIN_SEPARATOR, PERMIT_TYPEHASH", async () => {
    const { token, wallet } = await loadFixture(fixture);
    const name = await token.name();
    expect(name).to.eq("Uniswap V2");
    expect(await token.symbol()).to.eq("UNI-V2");
    expect(await token.decimals()).to.eq(18);
    expect(await token.totalSupply()).to.eq(TOTAL_SUPPLY);
    expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY);
    const { chainId } = await wallet.provider.getNetwork();

    expect(await token.DOMAIN_SEPARATOR()).to.eq(
      ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "address"],
          [
            ethers.keccak256(
              ethers.toUtf8Bytes(
                "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
              ),
            ),
            ethers.keccak256(ethers.toUtf8Bytes(name)),
            ethers.keccak256(ethers.toUtf8Bytes(UniswapVersion)),
            chainId,
            await token.getAddress(),
          ],
        ),
      ),
    );
    expect(await token.PERMIT_TYPEHASH()).to.eq(
      ethers.keccak256(
        ethers.toUtf8Bytes(
          "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)",
        ),
      ),
    );
  });

  it("approve", async () => {
    const { token, wallet, other } = await loadFixture(fixture);
    await expect(token.approve(other.address, TEST_AMOUNT))
      .to.emit(token, "Approval")
      .withArgs(wallet.address, other.address, TEST_AMOUNT);
    expect(await token.allowance(wallet.address, other.address)).to.eq(
      TEST_AMOUNT,
    );
  });

  it("transfer", async () => {
    const { token, wallet, other } = await loadFixture(fixture);
    await expect(token.transfer(other.address, TEST_AMOUNT))
      .to.emit(token, "Transfer")
      .withArgs(wallet.address, other.address, TEST_AMOUNT);
    expect(await token.balanceOf(wallet.address)).to.eq(
      TOTAL_SUPPLY - TEST_AMOUNT,
    );
    expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT);
  });

  it("transfer:fail", async () => {
    const { token, wallet, other } = await loadFixture(fixture);
    await expect(token.transfer(other.address, TOTAL_SUPPLY + 1n)).to.be
      .reverted; // ds-math-sub-underflow
    await expect(token.connect(other).transfer(wallet.address, 1n)).to.be
      .reverted; // ds-math-sub-underflow
  });

  it("transferFrom", async () => {
    const { token, wallet, other } = await loadFixture(fixture);
    await token.approve(other.address, TEST_AMOUNT);
    await expect(
      token
        .connect(other)
        .transferFrom(wallet.address, other.address, TEST_AMOUNT),
    )
      .to.emit(token, "Transfer")
      .withArgs(wallet.address, other.address, TEST_AMOUNT);
    expect(await token.allowance(wallet.address, other.address)).to.eq(0n);
    expect(await token.balanceOf(wallet.address)).to.eq(
      TOTAL_SUPPLY - TEST_AMOUNT,
    );
    expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT);
  });

  it("transferFrom:max", async () => {
    const { token, wallet, other } = await loadFixture(fixture);

    await token.approve(other.address, ethers.MaxUint256);
    await expect(
      token
        .connect(other)
        .transferFrom(wallet.address, other.address, TEST_AMOUNT),
    )
      .to.emit(token, "Transfer")
      .withArgs(wallet.address, other.address, TEST_AMOUNT);
    expect(await token.allowance(wallet.address, other.address)).to.eq(
      ethers.MaxUint256,
    );
    expect(await token.balanceOf(wallet.address)).to.eq(
      TOTAL_SUPPLY - TEST_AMOUNT,
    );
    expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT);
  });

  it("permit", async () => {
    const { token, wallet, other } = await loadFixture(fixture);
    const nonce = await token.nonces(wallet.address);
    const deadline = ethers.MaxUint256;
    const { chainId } = await wallet.provider.getNetwork();
    const tokenName = await token.name();

    const sig = await wallet.signTypedData(
      // "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
      {
        name: tokenName,
        version: UniswapVersion,
        chainId: chainId,
        verifyingContract: await token.getAddress(),
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
        spender: other.address,
        value: TEST_AMOUNT,
        nonce: nonce,
        deadline: deadline,
      },
    );

    const { r, s, v } = ethers.Signature.from(sig);

    await expect(
      token.permit(
        wallet.address,
        other.address,
        TEST_AMOUNT,
        deadline,
        v,
        r,
        s,
      ),
    )
      .to.emit(token, "Approval")
      .withArgs(wallet.address, other.address, TEST_AMOUNT);
    expect(await token.allowance(wallet.address, other.address)).to.eq(
      TEST_AMOUNT,
    );
    expect(await token.nonces(wallet.address)).to.eq(1n);
  });
});
