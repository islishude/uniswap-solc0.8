// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity =0.8.12;

import {ISuperfluid, ISuperToken, ISuperfluidToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";

import "./interfaces/IUniswapV2Pair.sol";
import "./UniswapV2ERC20.sol";
import "./libraries/Math.sol";
import "./libraries/UQ112x112.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./interfaces/IUniswapV2Callee.sol";

//solhint-disable func-name-mixedcase
//solhint-disable avoid-low-level-calls
//solhint-disable reason-string
//solhint-disable not-rely-on-time

contract UniswapV2Pair is IUniswapV2Pair, UniswapV2ERC20, SuperAppBase {
    using UQ112x112 for uint224;

    uint256 public constant override MINIMUM_LIQUIDITY = 10 ** 3;

    address public override factory;
    ISuperToken public override token0;
    ISuperToken public override token1;

    uint112 private reserve0; // uses single storage slot, accessible via getReserves
    uint112 private reserve1; // uses single storage slot, accessible via getReserves
    uint32 private blockTimestampLast; // uses single storage slot, accessible via getReserves

    uint256 public override price0CumulativeLast;
    uint256 public override price1CumulativeLast;
    uint256 public override kLast; // reserve0 * reserve1, as of immediately after the most recent liquidity event

    // for TWAP balance tracking (use blockTimestampLast)
    uint public twap0CumulativeLast;
    uint public twap1CumulativeLast;
    mapping (address => uint) userStartingCumulatives0;
    mapping (address => uint) userStartingCumulatives1;
    uint112 private totalSwappedFunds0;
    uint112 private totalSwappedFunds1;

    // superfluid
    using CFAv1Library for CFAv1Library.InitData;
    CFAv1Library.InitData public cfaV1;
    bytes32 public constant CFA_ID =
        keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");
    IConstantFlowAgreementV1 cfa;
    ISuperfluid _host;

    uint256 private unlocked = 1;
    modifier lock() {
        require(unlocked == 1, "UniswapV2: LOCKED");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    function getRealTimeIncomingFlowRates() public view returns (uint112 totalFlow0, uint112 totalFlow1, uint32 time) {
        totalFlow0 = uint112(uint96(cfa.getNetFlow(token0, address(this))));
        totalFlow1 = uint112(uint96(cfa.getNetFlow(token1, address(this))));
        time = uint32(block.timestamp % 2**32);
    }

    function getReserves()
        public
        view
        override
        returns (
            uint112 _reserve0,
            uint112 _reserve1,
            uint32 _blockTimestampLast
        )
    {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    function _getReservesAtTime(uint32 time, uint112 totalFlow0, uint112 totalFlow1) public view returns (uint112 _reserve0, uint112 _reserve1) {
        uint32 timeElapsed = time - blockTimestampLast;
        uint _kLast = kLast;

        if (totalFlow0 > 0 && totalFlow1 > 0 && timeElapsed > 0) {
            // use approximation:
            uint112 totalAmount0 = totalFlow0 * timeElapsed;
            uint112 totalAmount1 = totalFlow1 * timeElapsed;
            // not sure if these uint256->uint112 downcasts are safe:
            _reserve0 = uint112(Math.sqrt((_kLast * (reserve0 + totalAmount0)) / (reserve1 + totalAmount1)));
            _reserve1 = uint112(_kLast / _reserve0);

            // paradigm's formula for TWAMM has precision issues + high gas consumption:
            /*int resChange0 = int256(Math.sqrt(reserve0 * totalAmount1));
            int resChange1 = int256(Math.sqrt(reserve1 * totalAmount0));
            int c = (resChange0 - resChange1) * 1e36 / (resChange0 + resChange1);
            int ePower = int(3 ** (2 * Math.sqrt(totalFlow0 * totalFlow1 / _kLast))) * 1e36;
            _reserve0 = uint256(int(Math.sqrt((_kLast * totalAmount0) / totalAmount1)) * (ePower + c) / (ePower - c));
            _reserve1 = _kLast / _reserve0;*/
        } else if (totalFlow0 > 0 && timeElapsed > 0) {
            // use x * y = k
            uint112 totalAmount0 = totalFlow0 * timeElapsed;
            _reserve0 = reserve0 + totalAmount0;
            _reserve1 = uint112(_kLast / _reserve0); // should be a safe downcast
        } else if (totalFlow1 > 0 && timeElapsed > 0) {
            // use x * y = k
            uint112 totalAmount1 = totalFlow1 * timeElapsed;
            _reserve1 = reserve1 + totalAmount1;
            _reserve0 = uint112(_kLast / _reserve1); // should be a safe downcast
        } else {
            // get static reserves
            (_reserve0, _reserve1, ) = getReserves();
        }
    }

    function getReservesAtTime(uint32 time) public view returns (uint112 _reserve0, uint112 _reserve1) {
        uint112 totalFlow0 = uint112(uint96(cfa.getNetFlow(token0, address(this))));
        uint112 totalFlow1 = uint112(uint96(cfa.getNetFlow(token1, address(this))));
        (_reserve0, _reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);
    }

    function getRealTimeReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint time) {
        uint112 totalFlow0 = uint112(uint96(cfa.getNetFlow(token0, address(this))));
        uint112 totalFlow1 = uint112(uint96(cfa.getNetFlow(token1, address(this))));
        (_reserve0, _reserve1) = _getReservesAtTime(uint32(block.timestamp % 2**32), totalFlow0, totalFlow1);
        time = block.timestamp;
    }

    function _getUserBalancesAtTime(address user, uint32 time, uint112 _reserve0, uint112 _reserve1, uint112 totalFlow0, uint112 totalFlow1, int96 flow0, int96 flow1) public view returns (uint balance0, uint balance1) {
        uint32 timeElapsed = time - blockTimestampLast;
        uint _twap0CumulativeLast = twap0CumulativeLast;
        uint _twap1CumulativeLast = twap1CumulativeLast;
        if (totalFlow1 > 0) {
            _twap0CumulativeLast += uint256(UQ112x112.encode((totalFlow0 * timeElapsed) + reserve0 - _reserve0).uqdiv(totalFlow1));
        }
        if (totalFlow0 > 0) {
            _twap1CumulativeLast += uint256(UQ112x112.encode((totalFlow1 * timeElapsed) + reserve1 - _reserve1).uqdiv(totalFlow0));
        }

        balance0 = UQ112x112.decode(uint256(uint96(flow1)) * (_twap0CumulativeLast - userStartingCumulatives0[user])); // flow in is always positive
        balance1 = UQ112x112.decode(uint256(uint96(flow0)) * (_twap1CumulativeLast - userStartingCumulatives1[user]));
    }

    function getUserBalancesAtTime(address user, uint32 time) public view returns (uint balance0, uint balance1) {
        uint112 totalFlow0 = uint112(uint96(cfa.getNetFlow(token0, address(this))));
        uint112 totalFlow1 = uint112(uint96(cfa.getNetFlow(token1, address(this))));
        (, int96 flow0, , ) = cfa.getFlow(token0, user, address(this));
        (, int96 flow1, , ) = cfa.getFlow(token1, user, address(this));
        (uint112 _reserve0, uint112 _reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);
        (balance0, balance1) = _getUserBalancesAtTime(user, time, _reserve0, _reserve1, totalFlow0, totalFlow1, flow0, flow1);
    }

    function getRealTimeUserBalances(address user) public view returns (uint balance0, uint balance1, uint time) {
        (balance0, balance1) = getUserBalancesAtTime(user, uint32(block.timestamp % 2**32));
        time = block.timestamp;
    }

    /*
        Need way to get total amount of locked funds that aren't part of the reserves
        - primarily used in the swap function, but also a good method to have for measuring accurate TVL
        - couldn't find a good way to use the twap cumulatives for this
    */
    function _getTotalSwappedFundsAtTime(uint32 time, uint112 totalFlow0, uint112 totalFlow1) public view returns (uint112 _totalSwappedFunds0, uint112 _totalSwappedFunds1) {
        uint32 timeElapsed = time - blockTimestampLast;
        (uint112 _reserve0, uint112 _reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);
        _totalSwappedFunds0 = totalSwappedFunds0;
        _totalSwappedFunds1 = totalSwappedFunds1;

        _totalSwappedFunds0 += (totalFlow0 * timeElapsed) + reserve0 - _reserve0;
        _totalSwappedFunds1 += (totalFlow1 * timeElapsed) + reserve1 - _reserve1;
    }

    function getRealTimeTotalSwappedFunds() public view returns (uint112 _totalSwappedFunds0, uint112 _totalSwappedFunds1, uint time) {
        uint112 totalFlow0 = uint112(uint96(cfa.getNetFlow(token0, address(this))));
        uint112 totalFlow1 = uint112(uint96(cfa.getNetFlow(token1, address(this))));
        (_totalSwappedFunds0, _totalSwappedFunds1) = _getTotalSwappedFundsAtTime(uint32(block.timestamp % 2**32), totalFlow0, totalFlow1);
        time = block.timestamp;
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "UniswapV2: TRANSFER_FAILED"
        );
    }

    constructor(ISuperfluid host) public {
        assert(address(host) != address(0));
        factory = msg.sender;
        _host = host;

        cfa = IConstantFlowAgreementV1(address(host.getAgreementClass(CFA_ID)));
        cfaV1 = CFAv1Library.InitData(host, cfa);

        uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL;

        host.registerApp(configWord);
    }

    // called once by the factory at time of deployment
    function initialize(ISuperToken _token0, ISuperToken _token1) external override {
        require(msg.sender == factory, "UniswapV2: FORBIDDEN"); // sufficient check
        token0 = _token0;
        token1 = _token1;
    }

    // update reserves and, on the first call per block, price accumulators
    function _update(
        uint256 balance0,
        uint256 balance1,
        uint112 _reserve0,
        uint112 _reserve1
    ) private {
        require(
            balance0 <= type(uint112).max && balance1 <= type(uint112).max,
            "UniswapV2: OVERFLOW"
        );
        // TODO: optimize for gas (timeElapsed already calculated in swap() )
        // TODO: are these cumulatives necessary? could you calculate TWAP with the twap cumulatives?
        uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);
        unchecked {
            uint32 timeElapsed = blockTimestamp - blockTimestampLast; // overflow is desired
            if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
                // * never overflows, and + overflow is desired
                price0CumulativeLast +=
                    uint256(UQ112x112.encode(_reserve1).uqdiv(_reserve0)) *
                    timeElapsed;
                price1CumulativeLast +=
                    uint256(UQ112x112.encode(_reserve0).uqdiv(_reserve1)) *
                    timeElapsed;
            }
        }

        // TODO: optimize
        (uint112 totalFlow0, uint112 totalFlow1, uint32 time) = getRealTimeIncomingFlowRates();
        uint32 timeElapsed = time - blockTimestampLast;

        // update cumulatives
        // assuming _reserve{0,1} are real time
        if (totalFlow1 > 0) {
            twap0CumulativeLast += uint256(UQ112x112.encode((totalFlow0 * timeElapsed) + reserve0 - _reserve0).uqdiv(totalFlow1));
        }
        if (totalFlow0 > 0) {
            twap1CumulativeLast += uint256(UQ112x112.encode((totalFlow1 * timeElapsed) + reserve1 - _reserve1).uqdiv(totalFlow0));
        }

        // totalSwappedFunds{0,1} need to be settled because reserves are also settled
        totalSwappedFunds0 += (totalFlow0 * timeElapsed) + reserve0 - _reserve0;
        totalSwappedFunds1 += (totalFlow1 * timeElapsed) + reserve1 - _reserve1;

        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = blockTimestamp;

        emit Sync(reserve0, reserve1);
    }

    // if fee is on, mint liquidity equivalent to 1/6th of the growth in sqrt(k)
    function _mintFee(
        uint112 _reserve0,
        uint112 _reserve1
    ) private returns (bool feeOn) {
        address feeTo = IUniswapV2Factory(factory).feeTo();
        feeOn = feeTo != address(0);
        uint256 _kLast = kLast; // gas savings
        if (feeOn) {
            if (_kLast != 0) {
                uint256 rootK = Math.sqrt(uint256(_reserve0) * _reserve1);
                uint256 rootKLast = Math.sqrt(_kLast);
                if (rootK > rootKLast) {
                    uint256 numerator = totalSupply * (rootK - rootKLast);
                    uint256 denominator = rootK * 5 + rootKLast;
                    uint256 liquidity = numerator / denominator;
                    if (liquidity > 0) _mint(feeTo, liquidity);
                }
            }
        } else if (_kLast != 0) {
            kLast = 0;
        }
    }

    // this low-level function should be called from a contract which performs important safety checks
    function mint(
        address to
    ) external override lock returns (uint256 liquidity) {
        (uint112 _reserve0, uint112 _reserve1, ) = getReserves(); // gas savings
        uint256 balance0 = token0.balanceOf(address(this));
        uint256 balance1 = token1.balanceOf(address(this));
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint256 _totalSupply = totalSupply; // gas savings, must be defined here since totalSupply can update in _mintFee
        if (_totalSupply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0), MINIMUM_LIQUIDITY); // permanently lock the first MINIMUM_LIQUIDITY tokens
        } else {
            liquidity = Math.min(
                (amount0 * _totalSupply) / _reserve0,
                (amount1 * _totalSupply) / _reserve1
            );
        }
        require(liquidity > 0, "UniswapV2: INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);

        _update(balance0, balance1, _reserve0, _reserve1);
        //if (feeOn)
        kLast = uint256(reserve0) * reserve1; // reserve0 and reserve1 are up-to-date
        emit Mint(msg.sender, amount0, amount1);
    }

    // this low-level function should be called from a contract which performs important safety checks
    function burn(
        address to
    ) external override lock returns (uint256 amount0, uint256 amount1) {
        (uint112 _reserve0, uint112 _reserve1, ) = getReserves(); // gas savings
        address _token0 = address(token0); // gas savings
        address _token1 = address(token1); // gas savings
        uint256 balance0 = IERC20(_token0).balanceOf(address(this));
        uint256 balance1 = IERC20(_token1).balanceOf(address(this));
        uint256 liquidity = balanceOf[address(this)];

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint256 _totalSupply = totalSupply; // gas savings, must be defined here since totalSupply can update in _mintFee
        amount0 = (liquidity * balance0) / _totalSupply; // using balances ensures pro-rata distribution
        amount1 = (liquidity * balance1) / _totalSupply; // using balances ensures pro-rata distribution
        require(
            amount0 > 0 && amount1 > 0,
            "UniswapV2: INSUFFICIENT_LIQUIDITY_BURNED"
        );
        _burn(address(this), liquidity);
        _safeTransfer(_token0, to, amount0);
        _safeTransfer(_token1, to, amount1);
        balance0 = IERC20(_token0).balanceOf(address(this));
        balance1 = IERC20(_token1).balanceOf(address(this));

        _update(balance0, balance1, _reserve0, _reserve1);
        if (feeOn) kLast = uint256(reserve0) * reserve1; // reserve0 and reserve1 are up-to-date
        emit Burn(msg.sender, amount0, amount1, to);
    }

    // this low-level function should be called from a contract which performs important safety checks
    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external override lock {
        require(
            amount0Out > 0 || amount1Out > 0,
            "UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        
        uint256 amount0In;
        uint256 amount1In;
        {
            uint256 balance0;
            uint256 balance1;
            uint112 _reserve0;
            uint112 _reserve1;
            {
                // scope for _token{0,1}, avoids stack too deep errors
                address _token0 = address(token0);
                address _token1 = address(token1);
                require(to != _token0 && to != _token1, "UniswapV2: INVALID_TO");
                if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out); // optimistically transfer tokens
                if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out); // optimistically transfer tokens
                if (data.length > 0)
                    IUniswapV2Callee(to).uniswapV2Call(
                        msg.sender,
                        amount0Out,
                        amount1Out,
                        data
                    );

                // group real-time read operations for gas savings
                (uint112 totalFlow0, uint112 totalFlow1, uint32 time) = getRealTimeIncomingFlowRates();
                (_reserve0, _reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);
                (uint112 _totalSwappedFunds0, uint112 _totalSwappedFunds1) = _getTotalSwappedFundsAtTime(time, totalFlow0, totalFlow1);

                // calculate balances without locked swaps
                balance0 = IERC20(_token0).balanceOf(address(this)) - _totalSwappedFunds0; // subtract locked funds that are not part of the reserves
                balance1 = IERC20(_token1).balanceOf(address(this)) - _totalSwappedFunds1;
            }

            require(
                amount0Out < _reserve0 && amount1Out < _reserve1,
                "UniswapV2: INSUFFICIENT_LIQUIDITY"
            );

            // calculate input amounts (input agnostic)
            amount0In = balance0 > _reserve0 - amount0Out
                ? balance0 - (_reserve0 - amount0Out)
                : 0;
            amount1In = balance1 > _reserve1 - amount1Out
                ? balance1 - (_reserve1 - amount1Out)
                : 0;
            require(
                amount0In > 0 || amount1In > 0,
                "UniswapV2: INSUFFICIENT_INPUT_AMOUNT"
            ); 

            // check K
            uint256 balance0Adjusted = balance0 * 1000 - amount0In * 3;
            uint256 balance1Adjusted = balance1 * 1000 - amount1In * 3;
            require(
                balance0Adjusted * balance1Adjusted >=
                    uint256(_reserve0) * _reserve1 * 1e6,
                "UniswapV2: K"
            );

            _update(balance0, balance1, _reserve0, _reserve1);
        }

        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    // force balances to match reserves
    function skim(address to) external override lock {
        address _token0 = address(token0); // gas savings
        address _token1 = address(token1); // gas savings
        _safeTransfer(
            _token0,
            to,
            IERC20(_token0).balanceOf(address(this)) - reserve0
        );
        _safeTransfer(
            _token1,
            to,
            IERC20(_token1).balanceOf(address(this)) - reserve1
        );
    }

    // force reserves to match balances
    function sync() external override lock {
        _update(
            token0.balanceOf(address(this)),
            token1.balanceOf(address(this)),
            reserve0,
            reserve1
        );
    }

    function _handleCallback(
        ISuperToken _superToken,
        bytes calldata _agreementData,
        bytes calldata _cbdata
    ) internal {
        require(
            address(_superToken) == address(token0) || address(_superToken) == address(token1),
            "RedirectAll: token not in pool"
        );

        // decode previous net flowrates
        (uint112 totalFlow0, uint112 totalFlow1, int96 flow0, int96 flow1) = abi.decode(_cbdata, (uint112, uint112, int96, int96));

        uint112 _reserve0;
        uint112 _reserve1;
        uint32 timeElapsed;
        {
            // get time
            uint32 time = uint32(block.timestamp % 2 ** 32);

            // get realtime reserves based on old flowrates
            (_reserve0, _reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);

            timeElapsed = time - blockTimestampLast;

            // update blockTimestampLast
            blockTimestampLast = time;

            // update cumulatives
            if (totalFlow1 > 0) {
                twap0CumulativeLast += uint256(UQ112x112.encode((totalFlow0 * timeElapsed) + reserve0 - _reserve0).uqdiv(totalFlow1));
            }
            if (totalFlow0 > 0) {
                twap1CumulativeLast += uint256(UQ112x112.encode((totalFlow1 * timeElapsed) + reserve1 - _reserve1).uqdiv(totalFlow0));
            }
        }

        // set user starting cumulative
        (address user, ) = abi.decode(_agreementData, (address, address));
        address _token0 = address(token0);
        address _token1 = address(token1);
        if (address(_superToken) == _token0) {
            uint256 balance1 = UQ112x112.decode(uint256(uint96(flow0)) * (twap1CumulativeLast - userStartingCumulatives1[user]));
            if (balance1 > 0) _safeTransfer(_token1, user, balance1);
            userStartingCumulatives1[user] = twap1CumulativeLast;
            // NOTICE: mismatched precision between balance calculation and totalSwappedFunds{0,1} (dust amounts)
            totalSwappedFunds1 += (totalFlow1 * timeElapsed) + reserve1 - _reserve1 - uint112(balance1); // TODO: check downcast
        }
        if (address(_superToken) == _token1) {
            uint256 balance0 = UQ112x112.decode(uint256(uint96(flow1)) * (twap0CumulativeLast - userStartingCumulatives0[user]));
            if (balance0 > 0) _safeTransfer(_token0, user, balance0);
            userStartingCumulatives0[user] = twap0CumulativeLast;
            totalSwappedFunds0 += (totalFlow0 * timeElapsed) + reserve0 - _reserve0 - uint112(balance0);
        }

        // settle reserves
        reserve0 = _reserve0;
        reserve1 = _reserve1;
    }

    function beforeAgreementCreated(
        ISuperToken, // _superToken,
        address, // agreementClass
        bytes32, // agreementId
        bytes calldata agreementData,
        bytes calldata // _ctx
    ) external view virtual override returns (bytes memory) {
        uint112 totalFlow0 = uint112(uint96(cfa.getNetFlow(token0, address(this))));
        uint112 totalFlow1 = uint112(uint96(cfa.getNetFlow(token1, address(this))));
        (address user, ) = abi.decode(agreementData, (address, address));
        (, int96 flow0, , ) = cfa.getFlow(token0, user, address(this));
        (, int96 flow1, , ) = cfa.getFlow(token1, user, address(this));

        return abi.encode(totalFlow0, totalFlow1, flow0, flow1);
    }

    function afterAgreementCreated(
        ISuperToken _superToken,
        address, //_agreementClass,
        bytes32, //_agreementId
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override onlyHost returns (bytes memory newCtx) {
        _handleCallback(_superToken, _agreementData, _cbdata);
        newCtx = _ctx;
    }

    function beforeAgreementUpdated(
        ISuperToken, // _superToken,
        address, // agreementClass
        bytes32, // agreementId
        bytes calldata agreementData,
        bytes calldata // _ctx
    ) external view virtual override returns (bytes memory) {
        uint112 totalFlow0 = uint112(uint96(cfa.getNetFlow(token0, address(this))));
        uint112 totalFlow1 = uint112(uint96(cfa.getNetFlow(token1, address(this))));
        (address user, ) = abi.decode(agreementData, (address, address));
        (, int96 flow0, , ) = cfa.getFlow(token0, user, address(this));
        (, int96 flow1, , ) = cfa.getFlow(token1, user, address(this));

        return abi.encode(totalFlow0, totalFlow1, flow0, flow1);
    }

    function afterAgreementUpdated(
        ISuperToken _superToken,
        address, //_agreementClass,
        bytes32, // _agreementId,
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override onlyHost returns (bytes memory newCtx) {
        _handleCallback(_superToken, _agreementData, _cbdata);
        newCtx = _ctx;
    }

    function beforeAgreementTerminated(
        ISuperToken, //_superToken,
        address, // agreementClass
        bytes32, // agreementId
        bytes calldata agreementData,
        bytes calldata // _ctx
    ) external view virtual override returns (bytes memory) {
        uint112 totalFlow0 = uint112(uint96(cfa.getNetFlow(token0, address(this))));
        uint112 totalFlow1 = uint112(uint96(cfa.getNetFlow(token1, address(this))));
        (address user, ) = abi.decode(agreementData, (address, address));
        (, int96 flow0, , ) = cfa.getFlow(token0, user, address(this));
        (, int96 flow1, , ) = cfa.getFlow(token1, user, address(this));

        return abi.encode(totalFlow0, totalFlow1, flow0, flow1);
    }

    function afterAgreementTerminated(
        ISuperToken _superToken,
        address, //_agreementClass,
        bytes32, // _agreementId,
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override onlyHost returns (bytes memory newCtx) {
        _handleCallback(_superToken, _agreementData, _cbdata);
        newCtx = _ctx;
    }

    modifier onlyHost() {
        require(
            msg.sender == address(cfaV1.host),
            "RedirectAll: support only one host"
        );
        _;
    }
}
