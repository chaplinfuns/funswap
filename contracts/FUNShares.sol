pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FunShares is ERC20("Testnet FUNShares", "TFUNS") {
    constructor() public {
        _mint(msg.sender, 2e23);
    }
}
