// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.12;

import "./interfaces/IAqueductV1Factory.sol";
import "./AqueductV1Pair.sol";

contract AqueductV1Factory is IAqueductV1Factory {
    bytes32 public constant PAIR_HASH = keccak256(type(AqueductV1Pair).creationCode);

    address public override feeTo;
    address public override feeToSetter;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    // superfluid
    ISuperfluid _host;

    constructor(address _feeToSetter, ISuperfluid host) {
        assert(address(host) != address(0));
        feeToSetter = _feeToSetter;
        _host = host;
    }

    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        require(tokenA != tokenB, "AqueductV1: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "AqueductV1: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "AqueductV1: PAIR_EXISTS"); // single check is sufficient

        pair = address(new AqueductV1Pair{salt: keccak256(abi.encodePacked(token0, token1))}(_host));
        IAqueductV1Pair(pair).initialize(ISuperToken(token0), ISuperToken(token1));
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external override {
        require(msg.sender == feeToSetter, "AqueductV1: FORBIDDEN");
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external override {
        require(msg.sender == feeToSetter, "AqueductV1: FORBIDDEN");
        feeToSetter = _feeToSetter;
    }
}
