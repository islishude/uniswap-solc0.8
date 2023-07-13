// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

import {AqueductV1ERC20} from "../AqueductV1ERC20.sol";

contract ERC20 is AqueductV1ERC20 {
    constructor(uint256 _totalSupply) {
        _mint(msg.sender, _totalSupply);
    }
}
