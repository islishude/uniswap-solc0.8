// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

import "forge-std/Test.sol";
import {AqueductV1Pair} from "../../src/AqueductV1Pair.sol";
import {AqueductV1Factory} from "../../src/AqueductV1Factory.sol";

import {ISuperfluid} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {SuperfluidFrameworkDeployer, Superfluid, CFAv1Library, IDAv1Library, SuperTokenFactory} from "@superfluid-finance/ethereum-contracts/contracts/utils/SuperfluidFrameworkDeployer.sol";
import {ConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/agreements/ConstantFlowAgreementV1.sol";
import {InstantDistributionAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/agreements/InstantDistributionAgreementV1.sol";
import {ERC1820RegistryCompiled} from "@superfluid-finance/ethereum-contracts/contracts/libs/ERC1820RegistryCompiled.sol";

import {TestGovernance} from "@superfluid-finance/ethereum-contracts/contracts/utils/TestGovernance.sol";
import {TestToken} from "@superfluid-finance/ethereum-contracts/contracts/utils/TestToken.sol";
import {SuperToken} from "@superfluid-finance/ethereum-contracts/contracts/superfluid/SuperToken.sol";

contract AqueductV1PairTest is Test {
    AqueductV1Pair public aqueductV1Pair;
    AqueductV1Factory public aqueductV1Factory;
    SuperfluidFrameworkDeployer.Framework internal sf;
    SuperfluidFrameworkDeployer internal deployer;

    TestToken underlyingTokenA;
    TestToken underlyingTokenB;
    SuperToken superTokenA;
    SuperToken superTokenB;

    address internal constant admin = address(0x1);
    address internal constant alice = address(0x2);
    address internal constant bob = address(0x3);
    address internal constant carol = address(0x4);
    address internal constant dan = address(0x5);
    address internal constant eve = address(0x6);
    address internal constant frank = address(0x7);
    address internal constant grace = address(0x8);
    address internal constant heidi = address(0x9);
    address internal constant ivan = address(0x10);
    address[] internal TEST_ACCOUNTS = [admin, alice, bob, carol, dan, eve, frank, grace, heidi, ivan];

    uint256 internal constant INIT_TOKEN_BALANCE = 10000000;
    uint256 internal constant INIT_SUPER_TOKEN_BALANCE = 1000000;

    function setUpTokens() public {
        (underlyingTokenA, superTokenA) = deployer.deployWrapperSuperToken(
            "Test Token 0",
            "TT0",
            18,
            INIT_TOKEN_BALANCE
        );
        (underlyingTokenB, superTokenB) = deployer.deployWrapperSuperToken(
            "Test Token 0",
            "TT1",
            18,
            INIT_TOKEN_BALANCE
        );

        for (uint256 i = 0; i < TEST_ACCOUNTS.length; ++i) {
            underlyingTokenA.mint(TEST_ACCOUNTS[i], INIT_TOKEN_BALANCE);

            vm.startPrank(TEST_ACCOUNTS[i]);
            underlyingTokenA.approve(address(superTokenA), INIT_TOKEN_BALANCE);
            superTokenA.upgrade(INIT_SUPER_TOKEN_BALANCE);
            vm.stopPrank();
        }

        for (uint256 i = 0; i < TEST_ACCOUNTS.length; ++i) {
            underlyingTokenB.mint(TEST_ACCOUNTS[i], INIT_TOKEN_BALANCE);

            vm.startPrank(TEST_ACCOUNTS[i]);
            underlyingTokenB.approve(address(superTokenB), INIT_TOKEN_BALANCE);
            superTokenB.upgrade(INIT_SUPER_TOKEN_BALANCE);
            vm.stopPrank();
        }
    }

    function setUp() public {
        vm.etch(ERC1820RegistryCompiled.at, ERC1820RegistryCompiled.bin);
        deployer = new SuperfluidFrameworkDeployer();
        deployer.deployTestFramework();
        sf = deployer.getFramework();

        setUpTokens();

        aqueductV1Factory = new AqueductV1Factory(admin, sf.host);
        aqueductV1Pair = AqueductV1Pair(aqueductV1Factory.createPair(address(superTokenA), address(superTokenB)));
    }

    function test_integration_provideLiquidity() public {
        // Arrange
        uint256 expectedLiquidity = INIT_SUPER_TOKEN_BALANCE;

        vm.startPrank(admin);
        superTokenA.transfer(address(aqueductV1Pair), INIT_SUPER_TOKEN_BALANCE);
        superTokenB.transfer(address(aqueductV1Pair), INIT_SUPER_TOKEN_BALANCE);
        vm.stopPrank();

        // Act
        aqueductV1Pair.mint(admin);

        // Assert
        uint256 totalSupply = aqueductV1Pair.totalSupply();
        assertEq(totalSupply, expectedLiquidity);
    }

    function test_getReserves_ReturnsReserves() public {
        // Arrange & Act
        (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) = aqueductV1Pair.getReserves();

        // Assert
        assertEq(_reserve0, 0);
        assertEq(_reserve1, 0);
        assertEq(_blockTimestampLast, 0);
    }
}
