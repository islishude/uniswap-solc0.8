import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumber } from "ethers";
import { expandTo18Decimals, AqueductVersion } from "./shared/utilities";

const TOTAL_SUPPLY = expandTo18Decimals(10000);
const TEST_AMOUNT = expandTo18Decimals(10);

describe("AqueductV1ERC20", () => {
    async function fixture() {
        const factory = await ethers.getContractFactory("ERC20");
        const token = await factory.deploy(TOTAL_SUPPLY);
        const [wallet, other] = await ethers.getSigners();
        return { token: token, wallet, other };
    }

    it("name, symbol, decimals, totalSupply, balanceOf, DOMAIN_SEPARATOR, PERMIT_TYPEHASH", async () => {
        const { token, wallet } = await loadFixture(fixture);
        const name = await token.name();
        expect(name).to.eq("Aqueduct V1");
        expect(await token.symbol()).to.eq("AQUA-V1");
        expect(await token.decimals()).to.eq(18);
        expect(await token.totalSupply()).to.eq(TOTAL_SUPPLY);
        expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY);
        const chainId = await wallet.getChainId();
        expect(await token.DOMAIN_SEPARATOR()).to.eq(
            ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ["bytes32", "bytes32", "bytes32", "uint256", "address"],
                    [
                        ethers.utils.keccak256(
                            ethers.utils.toUtf8Bytes(
                                "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                            )
                        ),
                        ethers.utils.keccak256(ethers.utils.toUtf8Bytes(name)),
                        ethers.utils.keccak256(ethers.utils.toUtf8Bytes(AqueductVersion)),
                        chainId,
                        token.address,
                    ]
                )
            )
        );
        expect(await token.PERMIT_TYPEHASH()).to.eq(
            ethers.utils.keccak256(
                ethers.utils.toUtf8Bytes(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                )
            )
        );
    });

    it("approve", async () => {
        const { token, wallet, other } = await loadFixture(fixture);
        await expect(token.approve(other.address, TEST_AMOUNT))
            .to.emit(token, "Approval")
            .withArgs(wallet.address, other.address, TEST_AMOUNT);
        expect(await token.allowance(wallet.address, other.address)).to.eq(TEST_AMOUNT);
    });

    it("transfer", async () => {
        const { token, wallet, other } = await loadFixture(fixture);
        await expect(token.transfer(other.address, TEST_AMOUNT))
            .to.emit(token, "Transfer")
            .withArgs(wallet.address, other.address, TEST_AMOUNT);
        expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT));
        expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT);
    });

    it("transfer:fail", async () => {
        const { token, wallet, other } = await loadFixture(fixture);
        await expect(token.transfer(other.address, TOTAL_SUPPLY.add(1))).to.be.reverted; // ds-math-sub-underflow
        await expect(token.connect(other).transfer(wallet.address, 1)).to.be.reverted; // ds-math-sub-underflow
    });

    it("transferFrom", async () => {
        const { token, wallet, other } = await loadFixture(fixture);
        await token.approve(other.address, TEST_AMOUNT);
        await expect(token.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
            .to.emit(token, "Transfer")
            .withArgs(wallet.address, other.address, TEST_AMOUNT);
        expect(await token.allowance(wallet.address, other.address)).to.eq(0);
        expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT));
        expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT);
    });

    it("transferFrom:max", async () => {
        const { token, wallet, other } = await loadFixture(fixture);

        await token.approve(other.address, ethers.constants.MaxUint256);
        await expect(token.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
            .to.emit(token, "Transfer")
            .withArgs(wallet.address, other.address, TEST_AMOUNT);
        expect(await token.allowance(wallet.address, other.address)).to.eq(ethers.constants.MaxUint256);
        expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT));
        expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT);
    });

    it("permit", async () => {
        const { token, wallet, other } = await loadFixture(fixture);
        const nonce = await token.nonces(wallet.address);
        const deadline = ethers.constants.MaxUint256;
        const chainId = await wallet.getChainId();
        const tokenName = await token.name();

        const sig = await wallet._signTypedData(
            // "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
            {
                name: tokenName,
                version: AqueductVersion,
                chainId: chainId,
                verifyingContract: token.address,
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
            }
        );

        const { r, s, v } = ethers.utils.splitSignature(sig);

        await expect(token.permit(wallet.address, other.address, TEST_AMOUNT, deadline, v, r, s))
            .to.emit(token, "Approval")
            .withArgs(wallet.address, other.address, TEST_AMOUNT);
        expect(await token.allowance(wallet.address, other.address)).to.eq(TEST_AMOUNT);
        expect(await token.nonces(wallet.address)).to.eq(BigNumber.from(1));
    });
});
