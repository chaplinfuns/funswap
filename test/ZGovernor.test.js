const { expectRevert, time } = require('@openzeppelin/test-helpers');
const ethers = require('ethers');
const FunSwapToken = artifacts.require('FunSwapToken');
const MasterChaplin = artifacts.require('MasterChaplin');
const Timelock = artifacts.require('Timelock');
const GovernorAlpha = artifacts.require('GovernorAlpha');
const MockERC20 = artifacts.require('MockERC20');


function encodeParameters(types, values) {
    const abi = new ethers.utils.AbiCoder();
    return abi.encode(types, values);
}

contract('Governor', ([alice, bob, minter, dev, maker, distor, gov]) => {
    it('should work', async () => {
        this.funs = await FunSwapToken.new({ from: alice });
        await this.funs.delegate(bob, { from: bob });
        await this.funs.mint(bob, '100000', {from: alice})

        // fill in the correct param for MasterChaplin constructor
        this.chaplin = await MasterChaplin.new(this.funs.address, maker, distor, dev, gov, { from: alice });
        await this.funs.transferOwnership(this.chaplin.address, { from: alice });
        this.lp1 = await MockERC20.new('LPToken1', 'LP1', '10000000000', { from: minter });
        this.lp2 = await MockERC20.new('LPToken2', 'LP2', '10000000000', { from: minter });
        await this.chaplin.add(this.lp1.address, '10000', { from: alice });
        
        // Transfer ownership to timelock contract
        this.timelock = await Timelock.new(alice, time.duration.days(2), { from: alice });
        this.gov = await GovernorAlpha.new(this.timelock.address, this.funs.address, alice, { from: alice });
        await this.timelock.setPendingAdmin(this.gov.address, { from: alice });
        await this.gov.__acceptAdmin({ from: alice });
        await this.chaplin.transferOwnership(this.timelock.address, { from: alice });
        await expectRevert(
            this.chaplin.add(this.lp2.address, '10000', { from: alice }),
            'Ownable: caller is not the owner',
        );
        await expectRevert(
            this.gov.propose(
                [this.chaplin.address], ['0'], ['add(address,uint256)'],
                [encodeParameters(['address', 'uint256'], [this.lp2.address, '10000'])],
                'Add LP2',
                { from: alice },
            ),
            'GovernorAlpha::propose: proposer votes below proposal threshold',
        );
        await this.gov.propose(
            [this.chaplin.address], ['0'], ['add(address,uint256)'],
            [encodeParameters(['address', 'uint256'], [this.lp2.address, '10000'])],
            'Add LP2',
            { from: bob },
        );
        await time.advanceBlock();
        await this.gov.castVote('1', true, { from: bob });
        await expectRevert(this.gov.queue('1'), "GovernorAlpha::queue: proposal can only be queued if it is succeeded");
        console.log("Advancing 17280 blocks. Will take a while...");
        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        }
        await this.gov.queue('1');
        await expectRevert(this.gov.execute('1'), "Timelock::executeTransaction: Transaction hasn't surpassed time lock.");
        await time.increase(time.duration.days(3));
        await this.gov.execute('1');
        assert.equal((await this.chaplin.fomoPoolLength_()).valueOf(), '2');
    });
});
