pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./uniswapv2/interfaces/IUniswapV2ERC20.sol";
import "./uniswapv2/interfaces/IUniswapV2Pair.sol";
import "./uniswapv2/interfaces/IUniswapV2Factory.sol";


contract FunsDistributor {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    IUniswapV2Factory public factory;
    address public funs;
    address public weth;

    constructor(IUniswapV2Factory _factory, address _funs, address _weth) public {
        factory = _factory;
        funs = _funs;
        weth = _weth;
    }
    
    function convertLP2Funs(address _lpToken, address _receiver) public {
        // allow anybody (either user or contract) to buy funs using any type of existing lp token registerred in _factory
        IUniswapV2Pair pair = IUniswapV2Pair(_lpToken);
        pair.transfer(address(pair), pair.balanceOf(address(this)));
        pair.burn(address(this));
        uint256 wethAmount = _toWETH(pair.token0(), _receiver) + _toWETH(pair.token1(), _receiver);
        _toFUNS(wethAmount, _receiver);
    }

    function _toWETH(address token, address receiver) internal returns (uint256) {
        if (token == funs) {
            uint amount = IERC20(token).balanceOf(address(this));
            _safeTransfer(token, receiver, amount);
            return 0;
        }
        if (token == weth) {
            uint amount = IERC20(token).balanceOf(address(this));
            _safeTransfer(token, factory.getPair(weth, funs), amount);
            return amount;
        }
        IUniswapV2Pair pair = IUniswapV2Pair(factory.getPair(token, weth));
        if (address(pair) == address(0)) {
            return 0;
        }
        (uint reserve0, uint reserve1,) = pair.getReserves();
        address token0 = pair.token0();
        (uint reserveIn, uint reserveOut) = token0 == token ? (reserve0, reserve1) : (reserve1, reserve0);
        uint amountIn = IERC20(token).balanceOf(address(this));
        uint amountInWithFee = amountIn.mul(997);
        uint amountOut = amountInWithFee.mul(reserveOut).div(reserveIn.mul(1000).add(amountInWithFee));
        (uint amount0Out, uint amount1Out) = token0 == token ? (uint(0), amountOut) : (amountOut, uint(0));
        _safeTransfer(token, address(pair), amountIn);
        pair.swap(amount0Out, amount1Out, factory.getPair(weth, funs), new bytes(0));
        return amountOut;
    }

    
    function _toFUNS(uint256 amountIn, address receiver) public {
        IUniswapV2Pair pair = IUniswapV2Pair(factory.getPair(weth, funs));
        (uint reserve0, uint reserve1,) = pair.getReserves();
        address token0 = pair.token0();
        (uint reserveIn, uint reserveOut) = token0 == weth ? (reserve0, reserve1) : (reserve1, reserve0);
        uint amountInWithFee = amountIn.mul(997);
        uint denominator = reserveIn.mul(1000).add(amountInWithFee);
        uint amountOut = amountInWithFee.mul(reserveOut) / denominator;
        (uint amount0Out, uint amount1Out) = token0 == weth ? (uint(0), amountOut) : (amountOut, uint(0));
        pair.swap(amount0Out, amount1Out, receiver, new bytes(0));
    }
    // Wrapper for safeTransfer
    function _safeTransfer(address token, address to, uint256 amount) internal {
        IERC20(token).safeTransfer(to, amount);
    }
}