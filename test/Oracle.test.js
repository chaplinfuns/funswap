const { expectRevert, time, BN, expectEvent } = require('@openzeppelin/test-helpers');
const MockERC20Token = artifacts.require('MockERC20Token');
const UniswapV2Factory = artifacts.require('UniswapV2Factory');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');
const Oracle = artifacts.require('Oracle')

contract('Oracle', ([alice, bob, carol, dog, minter, owner]) => {
    beforeEach(async () => {
        this.factory = await UniswapV2Factory.new(alice, { from: alice });
            this.weth = await MockERC20Token.new('WETH', 'WETH', '100000000000000000000000000', 18, { from: minter }); // 10,000,000 wether
            
            this.usdt = await MockERC20Token.new('USDT', 'USDT', '10000000000000', 6, { from: minter });// 10,000,000 usdt
            this.wethusdt = await UniswapV2Pair.at((await this.factory.createPair(this.weth.address, this.usdt.address)).logs[0].args.pair);
            await this.weth.transfer(this.wethusdt.address, '1000000000000000000', {from: minter}) // 1 weth
            await this.usdt.transfer(this.wethusdt.address, '100000000', {from: minter})    // 100 usdt
            await this.wethusdt.mint(minter);  
            
            this.dai = await MockERC20Token.new('DAI', 'DAI', '100000000000000000000000', 18, {from: minter}); // 100000 DAI with 18 decimals
            this.daiusdt = await UniswapV2Pair.at((await this.factory.createPair(this.dai.address, this.usdt.address)).logs[0].args.pair);
            await this.dai.transfer(this.daiusdt.address, '1000000000000000000', {from: minter}) // 1 dai
            await this.usdt.transfer(this.daiusdt.address, '1100000', {from: minter})    // 1.1 usdt
            await this.daiusdt.mint(minter);  
            

            this.token2 = await MockERC20Token.new('Token2', 'T2', '1000000000000000000000', 18, {from: minter}); // // 1000 token2 with 18 decimals
            this.wetht2 = await UniswapV2Pair.at((await this.factory.createPair(this.token2.address, this.weth.address)).logs[0].args.pair);
            await this.weth.transfer(this.wetht2.address, '10000000000000000000', {from: minter}) // 10 weth with 18 decimals
            await this.token2.transfer(this.wetht2.address,   '1000000000000000000000', {from: minter}) // 1000 token2 with 18 decimals 
            await this.wetht2.mint(minter);
            let wetht2S = await this.wetht2.totalSupply();
            console.log('wetht2 supply is ', wetht2S.toString())
            
            this.token3 = await MockERC20Token.new('Token3', 'T3', '1000000000000', 8, {from: minter}); // 10000 token3 with 8 decimals
            this.dait3 = await UniswapV2Pair.at((await this.factory.createPair(this.dai.address, this.token3.address)).logs[0].args.pair);
            await this.dai.transfer(this.dait3.address,  '1000000000000000000000', {from: minter}) // 1000 dai with 18 decimals 
            await this.token3.transfer(this.dait3.address, '10000000000', {from: minter}) // 100 token3 with 8 decimals
            await this.dait3.mint(minter);
            let dait3S = await this.dait3.totalSupply();
            console.log('dait3 supply is ', dait3S.toString()) // 10 dait3 worth 2,000,000 or 200,000,000 usdt
            
            this.oracle = await Oracle.new(this.factory.address, this.usdt.address, { from: owner });
            
            console.log("factory   = ", this.factory.address)
            console.log("weth      = ", this.weth.address)
            console.log("usdt      = ", this.usdt.address)
            console.log("wethusdt  = ", this.wethusdt.address)
            console.log("dai       = ", this.dai.address)
            console.log("daiusdt   = ", this.daiusdt.address)
            console.log("token2    = ", this.wetht2.address)
            console.log("token3    = ", this.token3.address)
            console.log("dait3     = ", this.dait3.address)
            console.log("oracle    = ", this.oracle.address)
            console.log('decimals for all coins = ', (await this.weth.decimals()).toString())
    });

    it('should add lpTokens and calculate lpTokens value correctly', async () => {
        {
            await this.oracle.add(this.weth.address, this.wethusdt.address, {from: owner});
            let usdtAddr = await this.oracle.usdt();
            assert.equal(usdtAddr, this.usdt.address);
            let pairInfo = await this.oracle.pairs(this.weth.address);
            assert.equal(pairInfo.decimals.toString(), '1000000000000000000')
            assert.equal(pairInfo.base, this.weth.address)
            assert.equal(pairInfo.oracle, this.wethusdt.address)
            assert.equal(pairInfo.price, '100000000')
            
            let token0 = await this.wethusdt.token0();
            if (token0 == this.weth.address) {
                console.log('token0 == weth = ', this.weth.address)
                console.log('token1 == usdt = ', this.usdt.address)
                assert.equal(pairInfo.index, '1')
            } else if (token0 == this.usdt.address) {
                console.log('token0 == usdt = ', this.usdt.address)
                console.log('token1 == weth = ', this.weth.address)
                assert.equal(pairInfo.index, '2')
            }
            {
                let wethusdtS = await this.wethusdt.totalSupply();
                console.log('wethusdt supply is ', wethusdtS.toString())
                await this.oracle.fetchUpdateLPValue(this.wethusdt.address, wethusdtS.toString())
                let value = await this.oracle.fetchLPValue(this.wethusdt.address, wethusdtS.toString());
                assert.equal(value.toString(), '200000000')
            }

            {
                let wetht2S = await this.wetht2.totalSupply();
                console.log('wetht2 supply is ', wetht2S.toString())
                if (token0 == this.weth.address) {
                    console.log('token0 == weth = ', this.weth.address)
                    console.log('token1 == t2   = ', this.token2.address)
                    assert.equal(pairInfo.index, '1')
                } else if (token0 == this.token2.address) {
                    console.log('token0 == t2   = ', this.token2.address)
                    console.log('token1 == weth = ', this.weth.address)
                    assert.equal(pairInfo.index, '2')
                }
                await this.oracle.fetchUpdateLPValue(this.wetht2.address, wetht2S.toString())
                let value = await this.oracle.fetchLPValue(this.wetht2.address, wetht2S.toString())
                assert.equal(value.toString(), '2000000000')
            }
        }
        
        {
            await this.oracle.add(this.dai.address, this.daiusdt.address, {from: owner})
            
            {
                let daiusdtS = await this.daiusdt.totalSupply();
                console.log('daiusdt supply is ', daiusdtS.toString());
                await this.oracle.fetchUpdateLPValue(this.daiusdt.address, daiusdtS.toString())
                let value = await this.oracle.fetchLPValue(this.daiusdt.address, daiusdtS.toString())
                assert.equal(value.toString(), '2200000')
            }
            {
                let dait3S = await this.dait3.totalSupply();
                console.log('dait3 supply is ', dait3S.toString())
                await this.oracle.fetchUpdateLPValue(this.dait3.address, dait3S.toString())
                let value = await this.oracle.fetchLPValue(this.dait3.address, dait3S.toString())
                assert.equal(value.toString(), '2200000000')
            }
            
        }
    });
});
