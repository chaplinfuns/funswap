const { expectRevert, time } = require('@openzeppelin/test-helpers');
const ethers = require('ethers');
const FunSwapToken = artifacts.require('FunSwapToken');
const MasterChaplin = artifacts.require('MasterChaplin');
const MockERC20 = artifacts.require('MockERC20');
const Timelock = artifacts.require('Timelock');

function encodeParameters(types, values) {
    const abi = new ethers.utils.AbiCoder();
    return abi.encode(types, values);
}

contract('Timelock', ([alice, bob, carol, dev, minter, maker, distor, gov]) => {
    beforeEach(async () => {
        this.funs = await FunSwapToken.new({ from: alice });
        this.timelock = await Timelock.new(bob, '259200', { from: alice });
    });

    it('should not allow non-owner to do operation', async () => {
        await this.funs.transferOwnership(this.timelock.address, { from: alice });
        await expectRevert(
            this.funs.transferOwnership(carol, { from: alice }),
            'Ownable: caller is not the owner',
        );
        await expectRevert(
            this.funs.transferOwnership(carol, { from: bob }),
            'Ownable: caller is not the owner',
        );
        await expectRevert(
            this.timelock.queueTransaction(
                this.funs.address, '0', 'transferOwnership(address)',
                encodeParameters(['address'], [carol]),
                (await time.latest()).add(time.duration.days(4)),
                { from: alice },
            ),
            'Timelock::queueTransaction: Call must come from admin.',
        );
    });

    it('should do the timelock thing', async () => {
        await this.funs.transferOwnership(this.timelock.address, { from: alice });
        const eta = (await time.latest()).add(time.duration.days(4));
        await this.timelock.queueTransaction(
            this.funs.address, '0', 'transferOwnership(address)',
            encodeParameters(['address'], [carol]), eta, { from: bob },
        );
        await time.increase(time.duration.days(1));
        await expectRevert(
            this.timelock.executeTransaction(
                this.funs.address, '0', 'transferOwnership(address)',
                encodeParameters(['address'], [carol]), eta, { from: bob },
            ),
            "Timelock::executeTransaction: Transaction hasn't surpassed time lock.",
        );
        await time.increase(time.duration.days(4));
        await this.timelock.executeTransaction(
            this.funs.address, '0', 'transferOwnership(address)',
            encodeParameters(['address'], [carol]), eta, { from: bob },
        );
        assert.equal((await this.funs.owner()).valueOf(), carol);
    });

    it('should also work with MasterChaplin', async () => {
        this.lp1 = await MockERC20.new('LPToken', 'LP', '10000000000', { from: minter });
        this.lp2 = await MockERC20.new('LPToken', 'LP', '10000000000', { from: minter });
        this.chaplin = await MasterChaplin.new(this.funs.address, maker, distor, dev, gov, { from: alice });
        await this.funs.transferOwnership(this.chaplin.address, { from: alice });
        await this.chaplin.transferOwnership(this.timelock.address, { from: alice });
        const eta = (await time.latest()).add(time.duration.days(4));
        await this.timelock.queueTransaction(
            this.chaplin.address, '0', 'setOracle(address)',
            encodeParameters(['address'], [this.lp1.address]), eta, { from: bob },
        );
        await this.timelock.queueTransaction(
            this.chaplin.address, '0', 'add(address,uint256)',
            encodeParameters(['address', 'uint256'], [this.lp2.address, '10000']), eta, { from: bob },
        );
        
        await time.increase(time.duration.days(4));
        await this.timelock.executeTransaction(
            this.chaplin.address, '0', 'setOracle(address)',
            encodeParameters(['address'], [this.lp1.address]), eta, { from: bob },
        );
        await expectRevert(
            this.timelock.executeTransaction(
                this.chaplin.address, '0', 'add(address,uint256)',
                encodeParameters(['address', 'uint256'], [this.lp2.address, '10000']), eta, { from: carol },
            ),
            "Timelock::executeTransaction: Call must come from admin."
        );
        await this.timelock.executeTransaction(
            this.chaplin.address, '0', 'add(address,uint256)',
            encodeParameters(['address', 'uint256'], [this.lp2.address, '10000']), eta, { from: bob },
        );
        assert.equal((await this.chaplin.oracle_()), this.lp1.address);
        assert.equal((await this.chaplin.fomoPoolInfo('0')).lpToken, this.lp2.address);
    });
});
