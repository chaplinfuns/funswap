const { expectRevert, time, BN, expectEvent } = require('@openzeppelin/test-helpers');
const FunSwapToken = artifacts.require('FunSwapToken');
const MasterChaplin = artifacts.require('MasterChaplin');
const MockERC20 = artifacts.require('MockERC20');
const UniswapV2Factory = artifacts.require('UniswapV2Factory');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');
const FunsMaker = artifacts.require('FunsMaker');
const FunsDistributor = artifacts.require('FunsDistributor');
const FunsBar = artifacts.require('FunsBar');
const Oracle = artifacts.require('Oracle');

contract('MasterChaplin', ([alice, bob, carol, dog, dev, minter, gov, owner, cat]) => {
    beforeEach(async () => {
        this.funs = await FunSwapToken.new({ from: alice });
    });

    it('should set correct state variables', async () => {
        this.chaplin = await MasterChaplin.new(this.funs.address, alice, alice, dev, alice, { from: alice });
        await this.funs.transferOwnership(this.chaplin.address, { from: alice });
        const funs_ = await this.chaplin.funs_();
        const dev_ = await this.chaplin.dev_();
        const owner = await this.funs.owner();
        assert.equal(funs_.valueOf(), this.funs.address);
        assert.equal(dev_.valueOf(), dev);
        assert.equal(owner.valueOf(), this.chaplin.address);
    });

    // it('should allow dev and only dev to update dev', async () => {
    //     this.chaplin = await MasterChaplin.new(this.funs.address, alice, alice, dev, alice, { from: alice });
    //     assert.equal((await this.chaplin.dev_()).valueOf(), dev);
    //     await expectRevert(this.chaplin.setDev(bob, { from: bob }), 'setDev: wut?');
    //     await this.chaplin.setDev(bob, { from: dev });
    //     assert.equal((await this.chaplin.dev_()).valueOf(), bob);
    //     await this.chaplin.setDev(alice, { from: bob });
    //     assert.equal((await this.chaplin.dev_()).valueOf(), alice);
    // })

    it('should allow owner and only owner to update wethusdt, get price correctly', async () => {
        this.chaplin = await MasterChaplin.new(this.funs.address, alice, alice, alice, alice, { from: alice });
        // minter create wethusdt and add some liquidity
        this.weth = await MockERC20.new('WETH', 'WETH', '1000000000', { from: minter });
        this.usdt = await MockERC20.new('USDT', 'USDT', '1000000000', { from: minter });
        this.factory = await UniswapV2Factory.new(alice, { from: alice });
        this.wethusdt = await UniswapV2Pair.at((await this.factory.createPair(this.weth.address, this.usdt.address)).logs[0].args.pair);
        await this.weth.transfer(this.wethusdt.address, '1000000', {from: minter});
        await this.usdt.transfer(this.wethusdt.address, '100000000', {from: minter});
        await this.wethusdt.mint(minter);
        const ores = await this.wethusdt.getReserves();
        console.log('ores0 = ', ores[0].toString())
        console.log('ores1 = ', ores[1].toString())
        console.log('ores2 = ', ores[2].toString())
        
        this.oracle = await Oracle.new(this.factory.address, this.usdt.address, { from: owner });
        await this.oracle.add(this.weth.address, this.wethusdt.address, {from: owner});
        await this.chaplin.setOracle(this.oracle.address, {from: alice})
        assert.equal((await this.wethusdt.balanceOf(minter)).valueOf(), '9999000');
        // transfer 100 weth to wethusdt
        let token0 = await this.wethusdt.token0();
        await this.weth.transfer(this.wethusdt.address, '100', {from: minter});
        let dueUsdt = 3 * 100 * 100000000 / (1000 * 1000000 + 3 * 100);
        let usdtInt = parseInt(dueUsdt);
        if (token0 == this.weth.address) {
            await this.wethusdt.swap('0', usdtInt, alice, '0x', { from: minter })
            console.log('token0 is weth')
        } else {
            console.log('token0 is usdt')
            await this.wethusdt.swap(usdtInt, '0', alice, '0x', {from: minter})
        }
        assert.equal((await this.usdt.balanceOf(alice)).valueOf(), usdtInt);
        let reserves = await this.wethusdt.getReserves.call();
        let r0 = reserves[0];
        let r1 = reserves[1];
        let usdtValue;
        let wethAmt;
        if (token0 == this.usdt.address) {
            usdtValue = r0;
            wethAmt = r1;
        } else {
            usdtValue = r1;
            wethAmt = r0;
        }
        console.log('usdt value is ', usdtValue.toString());

        let res = await this.oracle.pairs(this.weth.address);
        let wethPrice = res.price;
        let wethValue = wethPrice.mul(wethAmt).div(new BN('1000000000000000000'))
        console.log('wethValue = ', wethValue.toString())
    })
    it('should allow owner and only owner to set bonus', async () => {
        this.chaplin = await MasterChaplin.new(this.funs.address, alice, alice, dev, gov, { from: alice });
        this.weth = await MockERC20.new('WETH', 'WETH', '1000000000', { from: minter });
        this.usdt = await MockERC20.new('USDT', 'USDT', '1000000000', { from: minter });
        this.factory = await UniswapV2Factory.new(alice, { from: alice });
        this.lp = await UniswapV2Pair.at((await this.factory.createPair(this.weth.address, this.usdt.address)).logs[0].args.pair);
        await this.chaplin.add(this.lp.address, '10000');
        assert.equal((await this.chaplin.fomoPoolInfo(0)).point.toString(), '10000');
    })
    it('should allow owner to transferFunsOwnership', async () => {
        this.chaplin = await MasterChaplin.new(this.funs.address, alice, alice, dev, gov, { from: alice });
        this.funs.transferOwnership(this.chaplin.address, {from: alice})
        assert.equal(await this.chaplin.owner(), alice)
        let newChap = await MasterChaplin.new(this.funs.address, alice, alice, dev, gov, { from: alice });
        await this.chaplin.__transferFunsOwnership(newChap.address, '1000000000', '3600', {from: alice})
        assert.equal(await this.funs.owner(), newChap.address)
    })
    context('With ERC/LP token added to the field', () => {
        beforeEach(async () => {

            this.factory = await UniswapV2Factory.new(alice, { from: alice });
            this.weth = await MockERC20.new('WETH', 'WETH', '100000000000000000000000000', { from: minter }); // 10,000,000 wether
            this.usdt = await MockERC20.new('USDT', 'USDT', '10000000000000', { from: minter });// 10,000,000,000 usdt
            this.wethusdt = await UniswapV2Pair.at((await this.factory.createPair(this.weth.address, this.usdt.address)).logs[0].args.pair);
           
            this.token1 = await MockERC20.new('Token1', 'T1', '10000000000000000000000', {from: minter}); // 10000 token1 with 18 decimals
            this.token2 = await MockERC20.new('Token2', 'T2', '100000000000000', {from: minter}); // // 100000 token2 with 8 decimals
            this.token3 = await MockERC20.new('Token3', 'T3', '100000000000', {from: minter});
            this.lp1usdt = await UniswapV2Pair.at((await this.factory.createPair(this.token1.address, this.usdt.address)).logs[0].args.pair);
            this.lp2weth = await UniswapV2Pair.at((await this.factory.createPair(this.token2.address, this.weth.address)).logs[0].args.pair);
            
            await this.weth.transfer(this.wethusdt.address, '1000000000000000000', {from: minter}) // 1 weth
            await this.usdt.transfer(this.wethusdt.address, '100000000', {from: minter})    // 100 usdt
            await this.wethusdt.mint(minter);  
            let wethusdtS = await this.wethusdt.totalSupply();
            console.log('wethusdt supply is ', wethusdtS.toString())

            await this.token1.transfer(this.lp1usdt.address, '10000000000000000000000', {from: minter}) // 100 token1 with 18 decimals
            await this.usdt.transfer(this.lp1usdt.address,   '10000000000', {from: minter}) // 10000 usdt with 6 decimals 
            await this.lp1usdt.mint(minter);
            let lp1usdtS = await this.lp1usdt.totalSupply();
            console.log('lp1usdt supply is ', lp1usdtS.toString())
            
            await this.token2.transfer(this.lp2weth.address, '100000000000000', {from: minter}) // 1,000,000 token2 with 8 decimals 
            await this.weth.transfer(this.lp2weth.address, '1000000000000000000000000', {from: minter}) // 1,000,000 wether with 18 decimals
            await this.lp2weth.mint(minter);
            let lp2wethS = await this.lp2weth.totalSupply();
            console.log('lp2weth supply is ', lp2wethS.toString()) // 10 lp2weth worth 2,000,000 or 200,000,000 usdt
            
            this.funs = await FunSwapToken.new({ from: alice });
            
            this.bar = await FunsBar.new(this.funs.address);
            
            this.uni = await MockERC20.new('Uni', 'Uni', '100000000000000000000000000', { from: minter })  // 10,000,000 Uni

            this.maker = await FunsMaker.new(this.factory.address, this.funs.address, this.bar.address, this.weth.address, this.uni.address);
            
            this.distor = await FunsDistributor.new(this.factory.address, this.funs.address, this.weth.address);
            console.log("factory = ", this.factory.address)
            console.log("weth    = ", this.weth.address)
            console.log("usdt    = ", this.usdt.address)
            console.log("wethusdt= ", this.wethusdt.address)
            console.log("token1  = ", this.token1.address)
            console.log("token2  = ", this.token2.address)
            console.log("token3  = ", this.token3.address)
            console.log("lp1usdt = ", this.lp1usdt.address)
            console.log("lp2weth = ", this.lp2weth.address)
            console.log("funs    = ", this.funs.address)
            console.log("bar     = ", this.bar.address)
            console.log("uni     = ", this.uni.address)
            console.log("maker   = ", this.maker.address)
            console.log("distor  = ", this.distor.address)
        });

        it('should allow withdraw and emergency withdraw', async () => {
            let funsupply = await this.funs.totalSupply().valueOf();
            console.log('funsupply = ', funsupply.toString())
            this.chaplin = await MasterChaplin.new(this.funs.address, this.maker.address, this.distor.address, dev, gov, { from: owner });
            console.log("chaplin  = ", this.chaplin.address)
            await this.funs.transferOwnership(this.chaplin.address, {from: alice});
            await this.chaplin.add(this.wethusdt.address, '10000', { from: owner })
            // await this.chaplin.setOracle(this.wethusdt.address, this.usdt.address, this.weth.address, {from: owner})
            
            this.oracle = await Oracle.new(this.factory.address, this.usdt.address, { from: owner });
            await this.oracle.add(this.weth.address, this.wethusdt.address, {from: owner});
            await this.chaplin.setOracle(this.oracle.address, {from: owner})
            

            let minterLpBal = await this.wethusdt.balanceOf(minter)
            console.log("minter wethusdt lp blance = ", minterLpBal.toString())
            await this.wethusdt.approve(this.chaplin.address, '1000000000000', {from: minter})
           
            {
                // start with 20 usdt worth of wethusdt token
                const {receipt} = await this.chaplin.startNewPhase('0', '1000000000000', {from: minter})
                console.log(minter, " startNewPhase gas:", receipt.gasUsed);
                let funsSupply = (await this.funs.totalSupply());
                console.log("total supply = ", funsSupply.toString());

                let expectedFunsSupply = new BN('8000000000000000000'); // 8000000000000000000
                assert.equal(funsSupply.toString(), expectedFunsSupply.toString());
                // check phaseInfo
                let phaseInfo = await this.chaplin.phaseInfo(0);
                assert.equal(phaseInfo.inflation.toString(), '400000000000000000000000')
                assert.equal(phaseInfo.phaseQuota.toString(), '1000000000000')
                assert.equal(phaseInfo.usdSize.toString(), '20000000')
                assert.equal(phaseInfo.airdrop.toString(), '250000000000000000000000')
                assert.equal(phaseInfo.whalePrize.toString(), '800000000000000000')

                // check phasePoolInfo
                const phasePool = await this.chaplin.phasePoolInfo.call(0, 0);
                assert.equal(phasePool.lpSize.toString(), '990000000000')
                assert.equal(phasePool.rVirtualPrize.toString(), '500000000')
                assert.equal(phasePool.airdropPerShare.toString(), '0')
                assert.equal(phasePool.lpWhale, minter)
                // check fomoPoolInfo
                let fomoPool = await this.chaplin.fomoPoolInfo(0);
                assert.equal(fomoPool.lpToken, this.wethusdt.address)
                assert.equal(fomoPool.point, '10000')
                assert.equal(fomoPool.funPerShare, '0')
                assert.equal(fomoPool.lpSize, '990000000000')
                assert.equal((await this.chaplin.fomoPoolLength_()).toString(), '1')
                // check userAddr2Id
                assert.equal((await this.chaplin.userAddr2Id('0', minter)).toString(), '1')
                // check lpPhaseInfo
                let lpAmt = await this.chaplin.lpPhaseInfo('0', '0', minter)
                assert.equal(lpAmt.toString(), '990000000000')
                // check lpInfo
                let lpInfo = await this.chaplin.lpInfo('0', minter)
                assert.equal(lpInfo.amount, '990000000000')
                assert.equal(lpInfo.lastFunPerShare, '0')
                assert.equal(lpInfo.reward, '0')
                assert.equal(lpInfo.lastPhaseClaimAirdrop, '0')
                assert.equal(lpInfo.lastPhaseWithdraw, '0')
                // check weth price
                assert.equal((await this.oracle.pairs(this.weth.address)).price.toString(), '100000000')
                // check devLp_
                assert.equal((await this.chaplin.devLp_(0)).toString(), '2500000000')
                // check govFuns_
                assert.equal((await this.chaplin.govFuns_()).toString(), '1100000000000000000')
                // check depositer funs balance
                assert.equal((await this.funs.balanceOf(minter)).toString(), '4000000000000000000')
                // check devFuns_ funsSupply * (0.2 + 0.05 + 0.0125)
                assert.equal((await this.chaplin.devFuns_()).toString(), '2100000000000000000')
            }
            await this.chaplin.add(this.lp1usdt.address, '20000', {from: owner});
            {
                await this.lp1usdt.transfer(alice, '1000000000000000', {from: minter}) // 1/10 of lp1usdt supply, worth 2000 usdt with 6 decimals
                await this.lp1usdt.approve(this.chaplin.address, '100000000000000000', { from: alice }); 
                const {receipt} = await this.chaplin.deposit('1', '1000000000000000', minter, { from: alice });
                console.log("alice ", alice, " deposit lp1 gas:", receipt.gasUsed);
                
                let funsSupply = (await this.funs.totalSupply());
                console.log("total supply = ", funsSupply.toString());
                let expectedFunsSupply = new BN('1608000000000000000000');
                assert.equal(funsSupply.toString(), expectedFunsSupply.toString());
                // check phaseInfo
                let phaseInfo = await this.chaplin.phaseInfo(0);
                assert.equal(phaseInfo.inflation.toString(), '400000000000000000000000')
                assert.equal(phaseInfo.usdSize.toString(), '2020000000')
                assert.equal(phaseInfo.airdrop.toString(), '250000000000000000000000')
                assert.equal(phaseInfo.id.toString(), '2')
                assert.equal(phaseInfo.whalePrize.toString(), '160800000000000000000')
                // check phasePoolInfo
                const phasePool = await this.chaplin.phasePoolInfo.call(0, 1);
                assert.equal(phasePool.lpSize.toString(), '990000000000000')
                assert.equal(phasePool.rVirtualPrize.toString(), '500000000000')
                assert.equal(phasePool.lpWhale, alice)
                assert.equal(phasePool.airdropPerShare.toString(), '0')
                // check fomoPoolInfo
                let fomoPool = await this.chaplin.fomoPoolInfo(1);
                assert.equal(fomoPool.lpToken, this.lp1usdt.address)
                assert.equal(fomoPool.point, '20000')
                assert.equal(fomoPool.funPerShare, '0')
                assert.equal(fomoPool.lpSize, '990000000000000')
                assert.equal((await this.chaplin.fomoPoolLength_()).toString(), '2')
                // check lpPhaseInfo
                assert.equal((await this.chaplin.userAddr2Id('0', alice)).toString(), '2')
                let lpPhase = await this.chaplin.lpPhaseInfo('0', '1', alice)
                assert.equal(lpPhase.toString(), '990000000000000')
                // check lpInfo
                let alicelpInfo = await this.chaplin.lpInfo('1', alice)
                assert.equal(alicelpInfo.amount.toString(), '990000000000000')
                assert.equal(alicelpInfo.lastFunPerShare.toString(), '0')
                assert.equal(alicelpInfo.reward.toString(), '0')
                assert.equal(alicelpInfo.lastPhaseClaimAirdrop.toString(), '0')
                assert.equal(alicelpInfo.lastPhaseWithdraw.toString(), '0')
                // check weth price
                assert.equal((await this.oracle.pairs(this.weth.address)).price.toString(), '100000000')
                // check devLp_ 
                assert.equal((await this.chaplin.devLp_(1)).toString(), '2500000000000')
                // check govFuns_ increased by 1600000000000000000000 * 0.1375
                assert.equal((await this.chaplin.govFuns_()).toString(), '221100000000000000000')
                // check depositer funs balance
                assert.equal((await this.funs.balanceOf(alice)).toString(), '800000000000000000000')
                // check devFuns_ increased by  1600000000000000000000 * (0.2 + 0.05 + 0.0125) (fomo, dev, refer1 + refer2)
                assert.equal((await this.chaplin.devFuns_()).toString(), '422100000000000000000')
            }
            {
                await this.lp1usdt.transfer(bob, '1000000000000000', {from: minter}) // 1/10 of lp1usdt supply, worth 2000 usdt with 6 decimals
                await this.lp1usdt.approve(this.chaplin.address, '1000000000000000', { from: bob }); 
                const {receipt} = await this.chaplin.deposit('1', '1000000000000000', minter, { from: bob });
                console.log("bob ", bob, " deposit lp1 gas:", receipt.gasUsed);
                assert.equal((await this.chaplin.fomoPoolLength_()).toString(), '2')
                let funsSupply = (await this.funs.totalSupply());
                console.log("total supply = ", funsSupply.toString());
                let expectedFunsSupply = new BN('3208000000000000000000');
                assert.equal(funsSupply.toString(), expectedFunsSupply.toString());
                // check phaseInfo
                let phaseInfo = await this.chaplin.phaseInfo(0);
                assert.equal(phaseInfo.inflation.toString(), '400000000000000000000000')
                assert.equal(phaseInfo.usdSize.toString(), '4020000000')
                assert.equal(phaseInfo.airdrop.toString(), '250000000000000000000000')
                assert.equal(phaseInfo.id.toString(), '3')
                assert.equal(phaseInfo.whalePrize.toString(), '320800000000000000000')
                // check phasePoolInfo
                const phasePool = await this.chaplin.phasePoolInfo.call(0, 1);
                assert.equal(phasePool.lpSize.toString(), '1980000000000000')
                assert.equal(phasePool.rVirtualPrize.toString(), '1000000000000')
                assert.equal(phasePool.lpWhale, alice)
                assert.equal(phasePool.airdropPerShare.toString(), '0')
                // check fomoPoolInfo
                let fomoPool = await this.chaplin.fomoPoolInfo(1);
                assert.equal(fomoPool.lpToken, this.lp1usdt.address)
                assert.equal(fomoPool.point, '20000')
                assert.equal(fomoPool.funPerShare.toString(), '323232323232323232323232')
                assert.equal(fomoPool.lpSize.toString(), '1980000000000000')
                assert.equal((await this.chaplin.fomoPoolLength_()).toString(), '2')
                // check lpPhaseInfo
                assert.equal((await this.chaplin.userAddr2Id('0', bob)).toString(), '3')
                let lpPhase = await this.chaplin.lpPhaseInfo('0', '1', bob)
                assert.equal(lpPhase.toString(), '990000000000000')
                // check rewards for alice
                let aliceFomoReward = await this.chaplin.getFomoReward(alice, '1')
                assert.equal(aliceFomoReward.toString(), '319999999999999999999') // appr = 320000000000000000000
                
                // check lpInfo for bob
                let boblpInfo = await this.chaplin.lpInfo('1', bob)
                assert.equal(boblpInfo.amount.toString(), '990000000000000')
                assert.equal(boblpInfo.lastFunPerShare.toString(), '323232323232323232323232')
                assert.equal(boblpInfo.reward.toString(), '0')
                assert.equal(boblpInfo.lastPhaseClaimAirdrop.toString(), '0')
                assert.equal(boblpInfo.lastPhaseWithdraw.toString(), '0')
                // check weth price
                assert.equal((await this.oracle.pairs(this.weth.address)).price.toString(), '100000000')
                // check devLp_ increased by 1000000000000000 * 0.01 * 0.25
                assert.equal((await this.chaplin.devLp_(1)).toString(), '5000000000000')
                // check govFuns_ increased by 1600000000000000000000 * 0.1375
                assert.equal((await this.chaplin.govFuns_()).toString(), '441100000000000000000')
                // check depositer funs balance
                assert.equal((await this.funs.balanceOf(bob)).toString(), '800000000000000000000')
                // check devFuns_ increased by  1600000000000000000000 * (0.0025 + 0.05 + 0.01)
                assert.equal((await this.chaplin.devFuns_()).toString(), '522100000000000000000')
                
            }
            await this.chaplin.add(this.lp2weth.address, '10000', {from: owner});
            {
                // 10000000000000000000 : 50000000000000000 = 200 : 1 => 2,000,000 ether * 100 usdt / 200 = 1,000,000 usdt
                await this.lp2weth.transfer(carol, '50000000000000000', {from: minter}) //  worth 10,000 ether or 1000,000 usdt
                await this.lp2weth.approve(this.chaplin.address, '50000000000000000', { from: carol }); 
                let lp1Value = await this.oracle.fetchLPValue(this.lp1usdt.address, '1000000000000000')
                console.log("lp1Value is ", lp1Value.toString())
                let lp2Value = await this.oracle.fetchLPValue(this.lp2weth.address, '50000000000000000')
                console.log("lp2Value is ", lp2Value.toString())
                const {receipt} = await this.chaplin.deposit('2', '50000000000000000', bob, { from: carol });
                console.log("carol ", carol, " deposit lp2 gas:", receipt.gasUsed);
                // check funsSupply
                let funsSupply = (await this.funs.totalSupply());
                console.log("total supply = ", funsSupply.toString());
                // increased by ((1000000 - 4020) / 2.5 + 4020 / 2.5 * 0.96) * 1000000000000000000 + 250000000000000000000000 (airdrop) 
                // 399935680000000000000000 + 250000000000000000000000
                // = 259995980000000000000000
                let expectedFunsSupply = new BN('653143680000000000000000');
                assert.equal(funsSupply.toString(), expectedFunsSupply.toString());
                // check phaseInfo(0)
                let phaseInfo0 = await this.chaplin.phaseInfo('0');
                assert.equal(phaseInfo0.inflation.toString(), '400000000000000000000000')
                assert.equal(phaseInfo0.phaseQuota.toString(), '1000000000000')
                assert.equal(phaseInfo0.airdrop.toString(), '250000000000000000000000')
                assert.equal(phaseInfo0.usdSize.toString(), '1000000000000')
                assert.equal(phaseInfo0.id.toString(), '4')
                assert.equal(phaseInfo0.whalePrize.toString(), '40160000000000000000000')
                // check phaseInfo(1)
                let phaseInfo1 = await this.chaplin.phaseInfo('1');
                assert.equal(phaseInfo1.inflation.toString(), '384000000000000000000000')
                assert.equal(phaseInfo1.phaseQuota.toString(), '1000000000000')
                assert.equal(phaseInfo1.airdrop.toString(), '250000000000000000000000')
                assert.equal(phaseInfo1.usdSize.toString(), '4020000000')
                assert.equal(phaseInfo1.id.toString(), '1')
                assert.equal(phaseInfo1.whalePrize.toString(), '154368000000000000000')
                // check phasePoolInfo
                const phasePool = await this.chaplin.phasePoolInfo.call(0, 2);
                assert.equal(phasePool.rVirtualPrize.toString(), '24899500000000') // (1000000 - 4020) / 1000000 * 50000000000000000 * 0.01 * 0.05
                assert.equal(phasePool.lpWhale, carol)
                assert.equal(phasePool.lpSize.toString(), '49301010000000000')  // (1000000 - 4020) /1000000 * 50000000000000000 * 0.99
                // (1000000 - 4020) / 1000000 * 250000000000000000000000 * 0.8 / 49301010000000000 * 1e18 (here, le18 means largeNumber)
                assert.equal(phasePool.airdropPerShare.toString(), '4040404040404040404040404') 
                // check fomoPoolInfo
                let fomoPool = await this.chaplin.fomoPoolInfo(2);
                assert.equal(fomoPool.lpToken, this.lp2weth.address)
                assert.equal(fomoPool.point, '10000')
                // excel gives us: 6262265215256240000000 = 4020 / 2.5 * 0.96 * 1e18 * 0.2 * 1e18 (largeNumber) / 49301010000000000
                assert.equal(fomoPool.funPerShare.toString(), '6262265215256239172382') 
                assert.equal(fomoPool.lpSize.toString(), '49500000000000000')
                assert.equal((await this.chaplin.fomoPoolLength_()).toString(), '3')
                // check lpPhaseInfo
                let lpPhase0 = await this.chaplin.lpPhaseInfo('0', '2', carol)
                // (1000000 - 4020) / 1000000 * 50000000000000000 * 0.99
                assert.equal(lpPhase0.toString(), '49301010000000000')
                assert.equal((await this.chaplin.userAddr2Id('0', carol)).toString(), '4')
                let lpPhase1 = await this.chaplin.lpPhaseInfo('1', '2', carol)
                assert.equal(lpPhase1.toString(), '198990000000000')
                assert.equal((await this.chaplin.userAddr2Id('1', carol)).toString(), '1')
                // check funs balance for carol ((1000000 - 4020) / 2.5 + 4020/2.5*0.96 ) * 1000000000000000000 * 0.5
                assert.equal((await this.funs.balanceOf(carol)).toString(), '199967840000000000000000') // 999995980000000000000000 * 0.5
                // check rewards for carol
                let carolFomoReward = await this.chaplin.getFomoReward(carol, '0') // 
                assert.equal(carolFomoReward.toString(), '0')
                
                // check devLp_ increased by 50000000000000000 * 0.01 * 0.25 
                assert.equal((await this.chaplin.devLp_('2')).toString(), '125000000000000')
                // check govFuns_ increased by 399935680000000000000000 * 0.5 * 0.275 + 250000000000000000000000 * 0.1
                assert.equal((await this.chaplin.govFuns_()).toString(), '80432256000000000000000')
                // check depositer funs balance 399935680000000000000000 * 0.5
                assert.equal((await this.funs.balanceOf(carol)).toString(), '199967840000000000000000')
                // check devFuns_ increased by  (((1000000 - 4020) / 2.5  * 0.2525 + 4020 / 2.5 * 0.96 * 0.0525) + 250000*0.1) * 1000000000000000000 = 124675184000000000000000
                assert.equal((await this.chaplin.devFuns_()).toString(), '126197123200000000000000')
                // check fomoPhase_
                assert.equal((await this.chaplin.fomoPhase_()).toString(), '1')
            }
            {
                // check whales of phase 0
                let phase0Whales = await this.chaplin.getPhaseWhales('0');
                console.log("phase0 whales = ", phase0Whales);
                assert.equal(phase0Whales[0][0], carol);
                assert.equal(phase0Whales[0][1], alice);
                assert.equal(phase0Whales[0][2], minter); // here is minter, not bob because, alice is 1st lp1usdt and minter is 1st in wethusdt 

                // check fomoReward and fomoRewards of carol
                // should be 4020 / 2.5 * 0.96 * 1000000000000000000 * 0.5 * 0.4 = 308736000000000000000, when next phase starts,
                //  value are accumulated in her reward, 
                let carolFomoReward = await this.chaplin.getFomoReward(carol, '2') 
                assert.equal(carolFomoReward.toString(), '308735999999999999999')
                let carolFomoRewards = await this.chaplin.getFomoRewards(carol) 
                assert.equal(carolFomoRewards.toString(), '308735999999999999999')
                // check airdropReward and airdropRewards of carol
                let carolAirdrop0 = await this.chaplin.getAirdrop(carol, '0', '0')
                assert.equal(carolAirdrop0.toString(), '0')
                // (1000000 - 4020) / 1000000 * 0.8 * 250000000000000000000000 = 199196000000000000000000, around 199195999999999999999999
                let carolAirdrop1 = await this.chaplin.getAirdrop(carol, '0', '2')
                assert.equal(carolAirdrop1.toString(), '199195999999999999999999') 
                
                let carolLpInfo = await this.chaplin.lpInfo('2', carol)
                // the accumulated reward including fomoReward = 308736000000000000000, around 308735999999999999999
                assert.equal(carolLpInfo.reward.toString(), '308735999999999999999') 
                assert.equal(carolLpInfo.lastFunPerShare.toString(), '6262265215256239172382')
                assert.equal(carolLpInfo.amount.toString(), '49500000000000000')
                assert.equal(carolLpInfo.lastPhaseClaimAirdrop.toString(), '0')
                assert.equal(carolLpInfo.lastPhaseWithdraw.toString(), '0')
                // 308735999999999999999 +  199196000000000000000000 = 199504736000000000000000, around 199504735999999999999998
                let carolRewards = await this.chaplin.getRewards(carol)
                assert.equal(carolRewards.toString(), '199504735999999999999998')
                // check getReferral
                let aliceReferInfo = await this.chaplin.getReferral(alice)
                assert.equal(aliceReferInfo[0], minter)
                assert.equal(aliceReferInfo[1].toString(), '0')
                let minterReferInfo = await this.chaplin.getReferral(minter)
                assert.equal(minterReferInfo[0], '0x0000000000000000000000000000000000000000')
                // if minter has funs balance > 10e18, he will get 1600000000000000000000 * 0.01 (alice contributes) + 1600000000000000000000 * 0.01 (bob contributes) + 399935680000000000000000 * 0.0025 (carol contribute)
                assert.equal(minterReferInfo[1].toString(), '0')
                // check withdraw of carol, phid = 0, pid = 2, no withdraw fee, make sure funs transfer is done
                {
                    // expect carol funs balances = 399935680000000000000000 * 0.5
                    let carolBal1 = await this.funs.balanceOf(carol)
                    assert.equal(carolBal1.toString(), '199967840000000000000000')
                    // (1000000 - 4020) / 1000000 * 50000000000000000 * 0.99
                    const carolCan = await this.chaplin.canFreeExit(carol, '0', '2')
                    assert.equal(carolCan[0], true)
                    assert.equal(carolCan[1].toString(), '49301010000000000')
                    const {receipt, logs } = await this.chaplin.withdraw('0', '2', '100', {from: carol})
                    expectEvent.inLogs(logs, 'Withdraw', {
                        user: carol,
                        phid: '0',
                        pid: '2',
                        amount: '100',
                    });
                    console.log("carol ", carol, " withdraw lp2 without withdrawFee gas:", receipt.gasUsed);
                    // expect carol funs balances = 399472576000000000000000
                    // = 199967840000000000000000 + 308735999999999999999 (fomoReward) + (1000000 - 4020) / 1000000 * 0.8 * 250000000000000000000000 (airdrop for 100 lp2weth in phase 0)
                    // around 399472575999999999999998
                    let carolBal2 = await this.funs.balanceOf(carol)
                    assert.equal(carolBal2.toString(), '399472575999999999999998') 
                }
                
                // check withdraw of carol, phid = 1, pid = 2, has withdraw fee
                {   
                    const carolCan = await this.chaplin.canFreeExit(carol, '1', '2')
                    assert.equal(carolCan[0], false)
                    // 4020 / 1000000 * 50000000000000000 * 0.99 = 201000000000000
                    assert.equal(carolCan[1].toString(), '198990000000000')
                    const {logs, receipt} = await this.chaplin.withdraw('1', '2', '100', {from: carol})
                    // lp token withdraw
                    expectEvent.inLogs(logs, 'Withdraw', {
                        user: carol,
                        phid: '1',
                        pid: '2',
                        amount: '99',
                    });
                    console.log("carol ", carol, " withdraw lp2 with withdrawFee gas:", receipt.gasUsed);
                }

                // check emergency withdraw of carol
                {
                    let carolBal1 = await this.funs.balanceOf(carol)
                    console.log('carolBal1 = ', carolBal1.toString())
                    const carolCan = await this.chaplin.canFreeExit(carol, '1', '2')
                    assert.equal(carolCan[0], false)
                    // 4020 / 1000000 * 50000000000000000 * 0.99 -100
                    assert.equal(carolCan[1].toString(), '198989999999900')
                    const {logs, receipt} = await this.chaplin.withdraw('1', '2', carolCan[1].toString(), {from: carol})
                    // (4020 / 1000000 * 50000000000000000 * 0.99 -100) * 0.99
                    expectEvent.inLogs(logs, 'Withdraw', {
                        user: carol,
                        phid: '1',
                        pid: '2',
                        amount: '197000099999901',
                    });
                    console.log("carol ", carol, " withdraw lp2 with withdrawFee gas:", receipt.gasUsed);
                    const carolCan1 = await this.chaplin.canFreeExit(carol, '1', '2')
                    assert.equal(carolCan1[0], false)
                    assert.equal(carolCan1[1].toString(), '0')
                }
                // check claimRewards of bob
                {
                    let bobBal1 = await this.funs.balanceOf(bob)
                    console.log("bob balance = ", bobBal1.toString()) 
                    //  1600000000000000000000 * 0.5
                    assert.equal(bobBal1.toString(), '800000000000000000000')
                    let bobCan = await this.chaplin.canFreeExit(bob, '0', '1')
                    assert.equal(bobCan[0], true)
                    assert.equal(bobCan[1].toString(), '990000000000000')
                    // only have airdrop 2000 / 1000000 * 250000000000000000000000 * 0.8 = 400000000000000000000, around 399999999999999999999
                    let bobRewards = await this.chaplin.getRewards(bob) 
                    assert.equal(bobRewards.toString(), '399999999999999999999')
                    const {logs, receipt} = await this.chaplin.claimRewards('0', '1', {from: bob})
                    expectEvent.inLogs(logs, "ClaimRewards", {
                        user: bob,
                        phid: '0',
                        pid: '1',
                        amount: '399999999999999999999',
                    })
                    console.log("bob ", bob, " claimRewards lp2 with withdrawFee gas:", receipt.gasUsed);
                }
                // check fomoPhase_ status along with next operations
                {
                    assert.equal((await this.chaplin.fomoPhase_()).toString(), '1')
                    assert.equal(await this.chaplin.phaseEnded('0'), true)
                    assert.equal(await this.chaplin.phaseEnded('1'), false)
                    let phaseStatus = await this.chaplin.phaseStatusInfo('0')
                    assert.equal(phaseStatus.id.toString(), '0')
                    assert.equal(phaseStatus.whalesDisted, false)
                }
                // test funsDistributor convertLP2Funs
                {
                    // carol will create the funs-usdt pair exchange
                    this.funsweth = await UniswapV2Pair.at((await this.factory.createPair(this.funs.address, this.weth.address)).logs[0].args.pair);
                    await this.funs.transfer(this.funsweth.address, '100000000000000000000000', {from: carol}) // 100,000 funs
                    await this.weth.transfer(this.funsweth.address,  '1000000000000000000000', {from: minter}) // 1,000 weth or 100,000 usdt 
                    await this.funsweth.mint(minter)

                    // convert wethusdt lp to funs
                    let minterWethusdtBal = await this.wethusdt.balanceOf(minter)
                    console.log('minter wethusdt balance = ', minterWethusdtBal.toString())
                    await this.wethusdt.transfer(this.distor.address, '1000000000000', {from: minter})                   
                    await this.distor.convertLP2Funs(this.wethusdt.address, dog, {from: minter})
                    let dogFunsBal = await this.funs.balanceOf(dog)
                    console.log("dog funs balance = ", dogFunsBal.toString())
                }
                // check convert4LuckyGuy
                {
                    let phasePool = await this.chaplin.phasePoolInfo('0', '1')
                    // (1000000000000000 + 1000000000000000) * 0.01 * 0.05
                    assert.equal(phasePool.rVirtualPrize.toString(), '1000000000000')
                    let r1Value = await this.oracle.fetchLPValue(this.lp1usdt.address, '1000000000000')
                    // 4000 usdt * 0.01 * 0.05 = 2 usdt = 2000000
                    assert(r1Value.toString(), '2000000')
                    console.log('phasePool.rVirtulPrize = ', phasePool.rVirtualPrize.toString())
                    console.log('phaseStatusInfo(0).rFunPrize = ', (await this.chaplin.phaseStatusInfo('0')).rFunPrize.toString())
                    
                    let rlp0Amt = (await this.chaplin.phasePoolInfo('0', '0')).rVirtualPrize.toString()
                    // 1000000000000 * 0.01 * 0.05
                    assert.equal(rlp0Amt, '500000000')
                    // 20 usdt * 0.01 * 0.05 = 0.01 usdt = 10000, theoretical value, but convertLP2Funs has changed the price
                    assert.equal((await this.oracle.fetchLPValue(this.wethusdt.address, '500000000')).toString(), '9002')
                    // 1000000000000000 * 2 * 0.01 * 0.05
                    let rlp1Amt = (await this.chaplin.phasePoolInfo('0', '1')).rVirtualPrize.toString()
                    assert.equal(rlp1Amt, '1000000000000')
                    // (1000000 - 4020) / 1000000 * 50000000000000000 * 0.01 * 0.05 = 24899500000000
                    let rlp2Amt = (await this.chaplin.phasePoolInfo('0', '2')).rVirtualPrize.toString()
                    assert.equal(rlp2Amt, '24899500000000')
                    // (1000000 - 4020) * 0.01 * 0.05 = 497.99 usdt = 497990000
                    assert.equal((await this.oracle.fetchLPValue(this.lp2weth.address, '24899500000000')).toString(), '497990000')
                    await expectRevert(this.chaplin.turnPlate('0', {from: minter}), "tp: not owner or dev_");
                    const {receipt, logs} = await this.chaplin.turnPlate('0', {from: owner})
                    let id = (await this.chaplin.phaseStatusInfo('0')).id.toString()
                    console.log("owner ", owner, " turnPlate phase = 0, gas:", receipt.gasUsed);
                    
                    expectEvent.inLogs (
                        logs,
                        "TurnPlate",
                        {
                            phid: '0',
                            luckyId: id,
                            amount: '493916744193900824971',
                        }
                    )
                    let phasePool1 = await this.chaplin.phasePoolInfo('0', '1');
                    console.log("phasePool1.rVirtualPrize = ", phasePool1.rVirtualPrize.toString());
                    assert.equal((await this.chaplin.phaseStatusInfo('0')).rFunPrize.toString(), '493916744193900824971')
                }
                // check turnPlate, withdrawLottery, and distributeWhales
                {   
                    assert.equal((await this.chaplin.phaseStatusInfo('0')).whalesDisted, false)
                    // distributeWhales
                    {
                        const {receipt, logs} = await this.chaplin.distributeWhales('0', {from: owner})
                        console.log("owner ", owner, " distributeWhales to funs whales, gas:", receipt.gasUsed);
                        console.log("receipt are ", receipt);
                        console.log("logs are ", logs);
                        logs.forEach(log => console.log("args = ", log.args))
                        console.log("JSON.stringify(logs) are ", JSON.stringify(logs))
                    }
                    assert.equal((await this.chaplin.phaseStatusInfo('0')).whalesDisted, true)
                }
            }
            
            {
                // check govTransfer
                let govBal = await this.chaplin.govFuns_()
                await expectRevert(this.chaplin.govTransfer({from: minter}), "govTransfer: not gov_")
                const {receipt} = await this.chaplin.govTransfer({from: gov})
                console.log("gov ", gov, " govTransfer, gas:", receipt.gasUsed);
                assert.equal((await this.funs.balanceOf(gov)).toString(), govBal.toString())

                // check setGov
                await expectRevert(this.chaplin.setGov(alice, {from: minter}), "Ownable: caller is not the owner")
                await this.chaplin.setGov(alice, {from: owner})
                assert.equal((await this.chaplin.gov_()), alice)
                
                // check devClaimRewards
                let devLp1Bal = await this.chaplin.devLp_('1')
                console.log("devLp1Bal = ", devLp1Bal.toString())
                let devFuns = await this.chaplin.devFuns_();
                console.log("devFuns = ", devFuns.toString())
                await expectRevert(this.chaplin.devClaimRewards('1', cat, devLp1Bal.toString(), devFuns.toString(), {from: alice}), "dcr: not owner or dev_")
                await this.chaplin.devClaimRewards('1', cat, devLp1Bal.toString(), devFuns.toString(), {from: dev})
                let catBal = await this.funs.balanceOf(cat)
                assert.equal(devFuns.toString(), catBal.toString())   
            }
            {
                 // check claimAllRewards
                 let {receipt} = await this.chaplin.claimAllRewards('1', {from: bob})
                 console.log("bob ", bob, " claimAllRewards, gas:", receipt.gasUsed);
            }
            {
                // check claimAllRewards
                let {receipt} = await this.chaplin.claimAllRewards('1', {from: alice})
                console.log("alice ", alice, " claimAllRewards, gas:", receipt.gasUsed);
            }
            {
               
                // check withdrawAll   
                let carolBalAll = await this.chaplin.lpInfo('2', carol)
                console.log("carol all lp2 balance = ", carolBalAll.amount.toString())
                let carolBal02 = await this.chaplin.lpPhaseInfo('0', '2', carol);
                console.log("carol balance phase:0, pid:2 amount = ", carolBal02.toString())
                console.log("phase:0 carol id = ", (await this.chaplin.userAddr2Id('0', carol)).toString())
                let lp2BalOfChaplin = await this.lp2weth.balanceOf(this.chaplin.address)
                console.log("lp2 token amount within chaplin contract = ", lp2BalOfChaplin.toString())
                
                const carolCan = await this.chaplin.canFreeExit(carol, '0', '2')
                assert.equal(carolCan[0], true)
                console.log("carol canFreeExit(0, 2, carol) = ", carolCan[1].toString())
                assert.equal(carolCan[1].toString(), carolBalAll.amount.toString())
                assert.equal(carolCan[1].toString(), carolBal02.toString())
                let carollpInfo1 = await this.chaplin.lpInfo('2', carol)
                console.log("carol lpInfo.reward = ", carollpInfo1.reward.toString())
                let carolFomoRewards1 = await this.chaplin.getFomoRewards(carol)
                console.log("carol fomo rewards = ", carolFomoRewards1.toString())
                let carolAirdropRewards1 = await this.chaplin.getAirdropRewards(carol)
                console.log("carol airdrop rewards = ", carolAirdropRewards1.toString())
                let carolRewards1 = await this.chaplin.getRewards(carol)
                console.log("carol overall rewards = ", carolRewards1.toString())
                // let {logs } = await this.chaplin.withdraw('0', '2', carolBal02.amount, {from: carol})
                // expectEvent.inLogs(logs, 'Withdraw', {
                //     user: carol,
                //     phid: '0',
                //     pid: '2',
                //     amount: carolBalAll.amount.toString(),
                //     reward: carolRewards1.toString(),
                // });
                // (1000000 - 4020) / 1000000 * 50000000000000000 * 0.99 = 49301010000000000, around 49301009999999900
                assert.equal((await this.chaplin.lpPhaseInfo('0', '2', carol)).toString(), '49301009999999900')
                let carolLpInfo = await this.chaplin.lpInfo('2', carol)
                console.log("lpInfo['0'][carol].lastFunPerShare       = ", carolLpInfo.lastFunPerShare.toString())
                console.log("lpInfo['0'][carol].reward                = ", carolLpInfo.reward.toString())
                console.log("lpInfo['0'][carol].lastPhaseClaimAirdrop = ", carolLpInfo.lastPhaseClaimAirdrop.toString())
                console.log("lpInfo['0'][carol].lastPhaseWithdraw     = ", carolLpInfo.lastPhaseWithdraw.toString())

                let {receipt} = await this.chaplin.withdrawAll('2', {from: carol})
                console.log("carol ", carol, " withdrawAll, gas:", receipt.gasUsed);
                let carollpInfo2 = await this.chaplin.lpInfo('2', carol)
                console.log("carol lpInfo.reward = ", carollpInfo2.reward.toString())
                let carolFomoRewards2 = await this.chaplin.getFomoRewards(carol)
                console.log("carol fomo rewards = ", carolFomoRewards2.toString())
                let carolAirdropRewards2 = await this.chaplin.getAirdropRewards(carol)
                console.log("carol airdrop rewards = ", carolAirdropRewards2.toString())
                let carolRewards2 = await this.chaplin.getRewards(carol)
                console.log("carol overall rewards = ", carolRewards2.toString())   
            }
            {
                // check reStakeSingle
                let aliceBal1 = await this.chaplin.lpInfo('1', alice)
                console.log('aliceBal1 = ', aliceBal1.amount.toString());
                await this.chaplin.reStakeSingle('1', {from: alice})
                let aliceBal2 = await this.chaplin.lpInfo('1', alice)
                console.log('aliceBal2 = ', aliceBal2.amount.toString());
                await this.chaplin.reStakeAll({from: alice})
                let aliceBal3 = await this.chaplin.lpInfo('1', alice)
                console.log('aliceBal3 = ', aliceBal3.amount.toString());
                await this.chaplin.reStakeAll({from: alice})
                let aliceBal4 = await this.chaplin.lpInfo('1', alice)
                console.log('aliceBal4 = ', aliceBal4.amount.toString());

                await this.lp1usdt.transfer(dog, '1000000000000000', {from: minter}) // 1/10 of lp1usdt supply, worth 2000 usdt with 6 decimals
                await this.lp1usdt.approve(this.chaplin.address, '1000000000000000000000000', { from: dog }); 
                const {receipt} = await this.chaplin.deposit('1', '1000000000000000', minter, { from: dog });
                let dogBal1 = await this.chaplin.lpInfo('1', dog);
                console.log('dogBal1 = ', dogBal1.amount.toString());
                
                await this.chaplin.reStakeSingle('1', {from: dog})
                let dogBal2 = await this.chaplin.lpInfo('1', dog)
                console.log('dogBal2 = ', dogBal2.amount.toString());
                
                await this.chaplin.reStakeSingle('1', {from: alice})
                let aliceBal5 = await this.chaplin.lpInfo('1', alice)
                console.log('aliceBal5 = ', aliceBal5.amount.toString());
                
                await this.lp1usdt.approve(this.chaplin.address, '100000000000000000000000000', { from: bob }); 
                await this.chaplin.reStakeSingle('1', {from: bob})
                let bobBal3 = await this.chaplin.lpInfo('1', bob)
                console.log('bobBal3 = ', bobBal3.amount.toString());
                
            }
        });
    });
});
