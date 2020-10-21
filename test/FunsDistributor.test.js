const FunSwapToken = artifacts.require('FunSwapToken');
const FunsDistributor = artifacts.require('FunsDistributor');
const MockERC20 = artifacts.require('MockERC20');
const UniswapV2Factory = artifacts.require('UniswapV2Factory');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');

contract('FunsDistributor', ([alice,bob, minter]) => {
    beforeEach(async () => {
        this.factory = await UniswapV2Factory.new(alice, { from: alice });
        this.funs = await FunSwapToken.new({ from: alice });
        await this.funs.mint(minter, '100000000', { from: alice });
        this.weth = await MockERC20.new('WETH', 'WETH', '100000000', { from: minter });
        this.token1 = await MockERC20.new('TOKEN1', 'TOKEN', '100000000', { from: minter });
        this.token2 = await MockERC20.new('TOKEN2', 'TOKEN2', '100000000', { from: minter });
        this.distor = await FunsDistributor.new(this.factory.address, this.funs.address, this.weth.address);
        this.funsWETH = await UniswapV2Pair.at((await this.factory.createPair(this.weth.address, this.funs.address)).logs[0].args.pair);
        this.wethToken1 = await UniswapV2Pair.at((await this.factory.createPair(this.weth.address, this.token1.address)).logs[0].args.pair);
        this.wethToken2 = await UniswapV2Pair.at((await this.factory.createPair(this.weth.address, this.token2.address)).logs[0].args.pair);
        this.token1Token2 = await UniswapV2Pair.at((await this.factory.createPair(this.token1.address, this.token2.address)).logs[0].args.pair);
    });

    it('should make Funs successfully', async () => {
        await this.factory.setFeeTo(bob, { from: alice });
        await this.weth.transfer(this.funsWETH.address, '10000000', { from: minter });
        await this.funs.transfer(this.funsWETH.address, '10000000', { from: minter });
        await this.funsWETH.mint(minter);
        await this.weth.transfer(this.wethToken1.address, '10000000', { from: minter });
        await this.token1.transfer(this.wethToken1.address, '10000000', { from: minter });
        await this.wethToken1.mint(minter);
        await this.weth.transfer(this.wethToken2.address, '10000000', { from: minter });
        await this.token2.transfer(this.wethToken2.address, '10000000', { from: minter });
        await this.wethToken2.mint(minter);
        await this.token1.transfer(this.token1Token2.address, '10000000', { from: minter });
        await this.token2.transfer(this.token1Token2.address, '10000000', { from: minter });
        await this.token1Token2.mint(minter);
        // Fake some revenue
        await this.token1.transfer(this.token1Token2.address, '100000', { from: minter });
        await this.token2.transfer(this.token1Token2.address, '100000', { from: minter });
        await this.token1Token2.sync();
        await this.token1.transfer(this.token1Token2.address, '10000000', { from: minter });
        await this.token2.transfer(this.token1Token2.address, '10000000', { from: minter });
        await this.token1Token2.mint(minter);
        // bob should have the LP now
        assert.equal((await this.token1Token2.balanceOf(bob)).valueOf(), '16528');
        // After calling convert, bob should have FUNS value at ~1/6 of revenue
        await this.token1Token2.transfer(this.token1Token2.address, (await this.token1Token2.balanceOf(bob)).valueOf(), {from: bob});
        await this.distor.convertLP2Funs(this.token1Token2.address, bob);
        assert.equal((await this.funs.balanceOf(bob)).valueOf(), '32965');
        assert.equal((await this.token1Token2.balanceOf(bob)).valueOf(), '0');
        assert.equal((await this.token1Token2.balanceOf(this.distor.address)).valueOf(), '0');
        // Should also work for FUNS-ETH pair
        await this.funs.transfer(this.funsWETH.address, '100000', { from: minter });
        await this.weth.transfer(this.funsWETH.address, '100000', { from: minter });
        await this.funsWETH.sync();
        await this.funs.transfer(this.funsWETH.address, '10000000', { from: minter });
        await this.weth.transfer(this.funsWETH.address, '10000000', { from: minter });
        await this.funsWETH.mint(minter);
        assert.equal((await this.funsWETH.balanceOf(bob)).valueOf(), '16537');
        await this.funsWETH.transfer(this.funsWETH.address, (await this.funsWETH.balanceOf(bob)).valueOf(), {from: bob});
        await this.distor.convertLP2Funs(this.funsWETH.address, bob);
        assert.equal((await this.funs.balanceOf(bob)).valueOf(), '66249');
        assert.equal((await this.funsWETH.balanceOf(bob)).valueOf(), '0');
        assert.equal((await this.funsWETH.balanceOf(this.distor.address)).valueOf(), '0');
    });
});