// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

//solhint-disable avoid-low-level-calls
//solhint-disable reason-string

// helper methods for interacting with ERC20 tokens and sending ETH that do not consistently return true/false
library TransferHelper {
    error TRANSFERHELPER_APPROVE_FAILED();
    error TRANSFERHELPER_TRANSFER_FAILED();
    error TRANSFERHELPER_TRANSFER_FROM_FAILED();
    error TRANSFERHELPER_ETH_TRANSFER_FAILED();

    function safeApprove(address token, address to, uint256 value) internal {
        // bytes4(keccak256(bytes('approve(address,uint256)')));
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x095ea7b3, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TRANSFERHELPER_APPROVE_FAILED();
    }

    function safeTransfer(address token, address to, uint256 value) internal {
        // bytes4(keccak256(bytes('transfer(address,uint256)')));
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TRANSFERHELPER_TRANSFER_FAILED();
    }

    function safeTransferFrom(address token, address from, address to, uint256 value) internal {
        // bytes4(keccak256(bytes('transferFrom(address,address,uint256)')));
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TRANSFERHELPER_TRANSFER_FROM_FAILED();
    }

    function safeTransferETH(address to, uint256 value) internal {
        (bool success, ) = to.call{value: value}(new bytes(0));
        if (!success) revert TRANSFERHELPER_ETH_TRANSFER_FAILED();
    }
}
