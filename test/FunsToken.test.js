const { expectRevert } = require('@openzeppelin/test-helpers');
const FunSwapToken = artifacts.require('FunSwapToken');

contract('FunSwapToken', ([alice, bob, carol]) => {
    beforeEach(async () => {
        this.funs = await FunSwapToken.new({ from: alice });
    });

    it('should have correct name and symbol and decimal', async () => {
        const name = await this.funs.name();
        const symbol = await this.funs.symbol();
        const decimals = await this.funs.decimals();
        assert.equal(name.valueOf(), 'FunSwapToken');
        assert.equal(symbol.valueOf(), 'FUNS');
        assert.equal(decimals.valueOf(), '18');
    });

    it('should only allow owner to mint token', async () => {
        await this.funs.mint(alice, '100', { from: alice });
        await this.funs.mint(bob, '1000', { from: alice });
        await expectRevert(
            this.funs.mint(carol, '1000', { from: bob }),
            'Ownable: caller is not the owner',
        );
        const totalSupply = await this.funs.totalSupply();
        const aliceBal = await this.funs.balanceOf(alice);
        const bobBal = await this.funs.balanceOf(bob);
        const carolBal = await this.funs.balanceOf(carol);
        assert.equal(totalSupply.valueOf(), '1100');
        assert.equal(aliceBal.valueOf(), '100');
        assert.equal(bobBal.valueOf(), '1000');
        assert.equal(carolBal.valueOf(), '0');
    });

    it('should supply token transfers properly', async () => {
        await this.funs.mint(alice, '100', { from: alice });
        await this.funs.mint(bob, '1000', { from: alice });
        await this.funs.transfer(carol, '10', { from: alice });
        await this.funs.transfer(carol, '100', { from: bob });
        const totalSupply = await this.funs.totalSupply();
        const aliceBal = await this.funs.balanceOf(alice);
        const bobBal = await this.funs.balanceOf(bob);
        const carolBal = await this.funs.balanceOf(carol);
        assert.equal(totalSupply.valueOf(), '1100');
        assert.equal(aliceBal.valueOf(), '90');
        assert.equal(bobBal.valueOf(), '900');
        assert.equal(carolBal.valueOf(), '110');
    });

    it('should fail if you try to do bad transfers', async () => {
        await this.funs.mint(alice, '100', { from: alice });
        await expectRevert(
            this.funs.transfer(carol, '110', { from: alice }),
            'Funs::_transferTokens amount exceeds balance',
        );
        await expectRevert(
            this.funs.transfer(carol, '1', { from: bob }),
            'Funs::_transferTokens amount exceeds balance',
        );
    });
  });
