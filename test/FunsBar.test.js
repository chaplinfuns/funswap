const { expectRevert } = require('@openzeppelin/test-helpers');
const FunSwapToken = artifacts.require('FunSwapToken');
const FunsBar = artifacts.require('FunsBar');

contract('FunsBar', ([alice, bob, carol]) => {
    beforeEach(async () => {
        this.funs = await FunSwapToken.new({ from: alice });
        this.bar = await FunsBar.new(this.funs.address, { from: alice });
        this.funs.mint(alice, '100', { from: alice });
        this.funs.mint(bob, '100', { from: alice });
        this.funs.mint(carol, '100', { from: alice });
    });

    it('should not allow enter if not enough approve', async () => {
        await expectRevert(
            this.bar.enter('100', { from: alice }),
            'Funs::transferFrom: transfer amount exceeds spender allowance',
        );
        await this.funs.approve(this.bar.address, '50', { from: alice });
        await expectRevert(
            this.bar.enter('100', { from: alice }),
            'Funs::transferFrom: transfer amount exceeds spender allowance',
        );
        await this.funs.approve(this.bar.address, '100', { from: alice });
        await this.bar.enter('100', { from: alice });
        assert.equal((await this.bar.balanceOf(alice)).valueOf(), '100');
    });

    it('should not allow withraw more than what you have', async () => {
        await this.funs.approve(this.bar.address, '100', { from: alice });
        await this.bar.enter('100', { from: alice });
        await expectRevert(
            this.bar.leave('200', { from: alice }),
            'iFuns: burn amount exceeds balance',
        );
    });

    it('should work with more than one participant', async () => {
        await this.funs.approve(this.bar.address, '100', { from: alice });
        await this.funs.approve(this.bar.address, '100', { from: bob });
        // Alice enters and gets 20 shares. Bob enters and gets 10 shares.
        await this.bar.enter('20', { from: alice });
        await this.bar.enter('10', { from: bob });
        assert.equal((await this.bar.balanceOf(alice)).valueOf(), '20');
        assert.equal((await this.bar.balanceOf(bob)).valueOf(), '10');
        assert.equal((await this.funs.balanceOf(this.bar.address)).valueOf(), '30');
        // FunsBar get 20 more FUNS from an external source.
        await this.funs.transfer(this.bar.address, '20', { from: carol });
        // Alice deposits 10 more FUNS. She should receive 10*30/50 = 6 shares.
        await this.bar.enter('10', { from: alice });
        assert.equal((await this.bar.balanceOf(alice)).valueOf(), '26');
        assert.equal((await this.bar.balanceOf(bob)).valueOf(), '10');
        // Bob withdraws 5 shares. He should receive 5*60/36 = 8 shares
        await this.bar.leave('5', { from: bob });
        assert.equal((await this.bar.balanceOf(alice)).valueOf(), '26');
        assert.equal((await this.bar.balanceOf(bob)).valueOf(), '5');
        assert.equal((await this.funs.balanceOf(this.bar.address)).valueOf(), '52');
        assert.equal((await this.funs.balanceOf(alice)).valueOf(), '70');
        assert.equal((await this.funs.balanceOf(bob)).valueOf(), '98');
    });
});
