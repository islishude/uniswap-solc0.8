// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

import {IAqueductV1Factory} from "./interfaces/IAqueductV1Factory.sol";
import {AqueductV1Pair} from "./AqueductV1Pair.sol";
import {IAqueductV1Pair} from "./interfaces/IAqueductV1Pair.sol";
import {ISuperfluid, ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

contract AqueductV1Factory is IAqueductV1Factory {
    bytes32 public constant PAIR_HASH = keccak256(type(AqueductV1Pair).creationCode);

    address public override feeTo;
    address public override feeToSetter;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    // superfluid
    ISuperfluid internal _host;

    constructor(address _feeToSetter, ISuperfluid host) {
        assert(address(host) != address(0));
        feeToSetter = _feeToSetter;
        _host = host;
    }

    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        if (tokenA == tokenB) revert FACTORY_IDENTICAL_ADDRESSES();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert FACTORY_ZERO_ADDRESS();
        if (getPair[token0][token1] != address(0)) revert FACTORY_PAIR_EXISTS(); // single check is sufficient

        pair = address(new AqueductV1Pair{salt: keccak256(abi.encodePacked(token0, token1))}(_host));
        IAqueductV1Pair(pair).initialize(ISuperToken(token0), ISuperToken(token1));
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external override {
        if (msg.sender != feeToSetter) revert FACTORY_FORBIDDEN();
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external override {
        if (msg.sender != feeToSetter) revert FACTORY_FORBIDDEN();
        feeToSetter = _feeToSetter;
    }
}
