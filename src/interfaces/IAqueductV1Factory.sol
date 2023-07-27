// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

interface IAqueductV1Factory {
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);

    error FACTORY_IDENTICAL_ADDRESSES();
    error FACTORY_ZERO_ADDRESS();
    error FACTORY_PAIR_EXISTS();
    error FACTORY_FORBIDDEN();
    error AUCTION_ALREADY_EXECUTED();
    error AUCTION_PAIR_DOESNT_EXIST();
    error AUCTION_EXPIRED();
    error AUCTION_INSUFFICIENT_BID();
    error AUCTION_TRANSFER_FAILED();

    function feeTo() external view returns (address);

    function feeToSetter() external view returns (address);

    function getPair(address tokenA, address tokenB) external view returns (address pair);

    function allPairs(uint256) external view returns (address pair);

    function allPairsLength() external view returns (uint256);

    function createPair(address tokenA, address tokenB) external returns (address pair);

    function setFeeTo(address) external;

    function setFeeToSetter(address) external;
}
