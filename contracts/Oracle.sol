pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./uniswapv2/interfaces/IUniswapV2ERC20.sol";
import "./uniswapv2/interfaces/IUniswapV2Pair.sol";
import "./uniswapv2/interfaces/IUniswapV2Factory.sol";


contract Oracle is Ownable {
    using SafeMath for uint256;
    IUniswapV2Factory public factory;
    address public usdt;
    uint private unlocked = 1;
    struct PairInfo {
        address base;   // the base token address, usdt, usdc, weth, dai
        IUniswapV2Pair oracle;   // pair exchange contract hash
        uint256 price; // 1 weth = 200 usdt, prices[weth_address] = 200 * 1,000,000
        uint256 decimals; // decimals means the other token decimals, should be 1e18, not 18
        uint256 index;
    }
    mapping(address => bool) public registerred;
    mapping(address => PairInfo) public pairs; // must be the pair of some token to usdt
    event Add(address indexed base, address indexed pair, uint256 price, uint256 decimal);
    modifier lock() {
        require(unlocked == 1, 'FunsDistributor: LOCKED');
        unlocked = 0;
        _;
        unlocked = 1;
    }
        
    constructor(IUniswapV2Factory _factory, address _usdt) public {
        factory = _factory;
        usdt = _usdt;
    }
    
    function add(address base, address pair) public onlyOwner {
        require(!registerred[base], "Oracle::add: token has been registerred");
        registerred[base] = true;
        IUniswapV2Pair oracle = IUniswapV2Pair(pair);
        address t0 = oracle.token0();
        address t1 = oracle.token1();
        require(t0 == usdt || t1 == usdt, "Oracle::add: pair does not contain usdt token");
        (uint o0, uint o1, ) = oracle.getReserves();
        uint decimals = t0 == base ? 10 ** uint(IUniswapV2ERC20(t0).decimals()) : 10 ** uint(IUniswapV2ERC20(t1).decimals());
        uint price = t0 == usdt ? o0.mul(decimals).div(o1) : o1.mul(decimals).div(o0);
        uint256 index = t0 == base ? 1 : 2;
        pairs[base] = PairInfo({
            base: base,
            oracle: oracle,
            price: price,
            decimals: decimals,
            index: index
        });
        emit Add(base, pair, price, decimals);
    }
    function fetchLPValue(address _lpToken, uint256 amount) public view returns (uint256 value) {
        IUniswapV2Pair pair = IUniswapV2Pair(_lpToken);
        address token0 = pair.token0();
        address token1 = pair.token1();
        (uint r0, uint r1, ) = pair.getReserves();
        if (token0 == usdt && !registerred[token1]) {
            value = r0.mul(2).mul(amount).div(pair.totalSupply());
        } else if (token1 == usdt && !registerred[token0]) {
            value = r1.mul(2).mul(amount).div(pair.totalSupply());
        } else {
            require(registerred[token0] || registerred[token1], "Oracle::fetchLPValue: either pairs of lpToken is registerred");
            address token = registerred[token0] ? token0 : token1;
            (r0, r1) = registerred[token0] ? (r0, r1) : (r1, r0);
            value = r0.mul(pairs[token].price).mul(2).mul(amount);
            value = value.div(pair.totalSupply()).div(pairs[token].decimals);
        }        
    }
    function fetchUpdateLPValue(address _lpToken, uint256 amount) public returns (uint256 value) {
        IUniswapV2Pair pair = IUniswapV2Pair(_lpToken);
        address token0 = pair.token0();
        address token1 = pair.token1();
        (uint r0, uint r1, ) = pair.getReserves();
        if (token0 == usdt && !registerred[token1]) {
            value = r0.mul(2).mul(amount).div(pair.totalSupply());
        } else if (token1 == usdt && !registerred[token0]) {
            value = r1.mul(2).mul(amount).div(pair.totalSupply());
        } else {
            require(registerred[token0] || registerred[token1], "Oracle::fetchLPValue: either pairs of lpToken is registerred");
            // the following is same as 'if'-'else' part
            address token = registerred[token0] ? token0 : token1;
            (uint o0, uint o1, ) = pairs[token].oracle.getReserves();
            // try to refresh price if fluctuation is greater than 0.1%, save gas if fluctuation is less than 0.1%
            uint price0 = pairs[token].price;
            uint price = pairs[token].index == 2 ? o0.mul(pairs[token].decimals).div(o1) : o1.mul(pairs[token].decimals).div(o0);
            uint fluctuation = price > price0 ? price.sub(price0) : price0.sub(price);
            if (fluctuation.mul(1000).div(price0) > 1) {
                pairs[token].price = price;
            }
            (r0, r1) = registerred[token0] ? (r0, r1) : (r1, r0);
            value = r0.mul(pairs[token].price).mul(2).mul(amount);
            value = value.div(pair.totalSupply()).div(pairs[token].decimals);
        }        
    }
}