pragma solidity >=0.6.12;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./uniswapv2/interfaces/IUniswapV2Factory.sol";




interface IFuns is IERC20 {
    function mint(address _to, uint256 _amount) external;
    function transferOwnership(address newOwner) external;
}

interface IMigratorChaplin {
    // Perform LP token migration from legacy UniswapV2 to FunSwap.
    // Take the current LP token address and return the new LP token address.
    // Migrator should have full access to the caller's LP token.
    // Return the new LP token address.
    //
    // XXX Migrator must have allowance access to UniswapV2 LP tokens.
    // FunSwap must mint EXACTLY the same amount of FunSwap LP tokens or
    // else something bad will happen. Traditional UniswapV2 does not
    // do that so be careful!
    function migrate(IERC20 token) external returns (IERC20);
}

interface IFunsDistributor {
    function convertLP2Funs(address _lpToken, address _receiver) external;
}

interface IStakingRewards {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function getReward() external;
    function balanceOf(address account) external view returns (uint256);

}

interface IOracle {
    function fetchLPValue(address _lpToken, uint256 amount) external view returns (uint256 value);
    function fetchUpdateLPValue(address _lpToken, uint256 amount) external returns (uint256 value);
}


contract MasterChaplin is Ownable {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    IOracle public oracle_;

    address public gov_;
    address public dev_;
    address public banker_;
    IFuns public funs_;
    IERC20 public ifuns_;
    IERC20 public uni_;
    address public maker_;  // receiver lp and convert to fun so as to distribute fun to fun staker
    IFunsDistributor public distor_;
    IMigratorChaplin public migrator;
    
    uint256 public denominator_ = 10000;

    uint256 public mineShare_ = 5000;
    uint256 public fomoShare_ = 2000;       // base number denominator_
    uint256 public govShare_ = 1375;        // base number denominator_
    uint256 public whaleShare_ = 1000;      // base number denominator_
    uint256 public referrer1Bonus_ = 100; // 100 / 10000 = 1%
    uint256 public referrer2Bonus_ = 25;  // 25 / 10000 = .25%
    
    uint256 public enterFee_ = 100;        // TODO: change to 100 by default base number denominator_    
    uint256 public forceExitFee_ = 100;    // TODO: change to 200 by default base number denominator_
    uint public phaseDuration_ = 7 days;
    uint256 public lpFee2FunStakerShare_ = 7000;
    uint256 lpFee2FunRandomShare_ = 500;
    
    uint256 public inflationRatio_ = 9600;   // 9000 by default base number denominator_
    uint256 public phaseQuota_ = 1e12; // 1 million usdt determinted by the oralce contract: SwapPair of WETH-USDT 
    uint256 public largeNumber_ = 1e18;
    uint256 public initialPhaseInflation_ = 4e23; // 0.4 million with 18 decimals

    uint256 public phaseAirdrop_ = 25e22;

    struct PhaseParam {
        uint256 phaseQuota;
        uint256 inflation;
        uint256 end; // timestamp
        uint256 airdrop;

        uint256 usdSize; // note: only increase, will not decrease
        uint256 id; // will increase by 1 from 1 in each phase
        uint256 whalePrize; // prize in the form of fun for fun whales
    }
    // PhaseParam[] public phaseInfo; 
    // phaseInfo[phid] => PhaseParam
    mapping(uint256 => PhaseParam) public phaseInfo;

    struct PhasePool {
        uint256 rVirtualPrize; // r: random prize in the form of lp
        uint256 lpSize; // used for airdrop, when user enters, lpSize increases, when leaves, decreases
        uint256 airdropPerShare; // in the form of fun for lp provider per lp (minimum unit of lp)
        address lpWhale;
    }
    // phaseInfo[phaseId][pid] => PhasePool
    mapping (uint256 => mapping(uint256 => PhasePool)) public phasePoolInfo;

    struct PhaseStatus {        
        bool whalesDisted;
        uint256 rFunPrize; // r: random prize in the form of funs
        uint256 id;
    }
    // phaseStatusInfo[phaseId] => PhaseStatus
    mapping (uint256 => PhaseStatus) public phaseStatusInfo;

    struct FomoPool {
        address lpToken;
        uint256 point;       // How many bonus points assigned to this pool, denominator is denominator_ by default.
        uint256 funPerShare;  // accumulative Fun token profit per lp share
        uint256 lpSize;   // To help distribute profit of funs token between users who deposit same LP token during all phases
    }
    // lp id => FomoPool
    // FomoPool[] public fomoPoolInfo;
    mapping(uint256 => FomoPool) public fomoPoolInfo;
    uint256 public fomoPoolLength_;

    uint256 public fomoPhase_;

    // userAddr2Id[phaseId][user] => id for usage of distributing random prize
    mapping(uint256 => mapping(address => uint256)) public userAddr2Id;
    mapping(uint256 => mapping(uint256 => address)) public userId2Addr;
    // lpPhaseInfo[user][phaseId][lpId] => taxed lpAmount
    // mapping (address => mapping(uint256 => mapping(uint256 => uint256))) lpPhaseInfo;
    // lpPhaseInfo[phaseId][lpId][user] => taxed lpAmout
    mapping (uint256 => mapping(uint256 => mapping(address => uint256))) public lpPhaseInfo;
    
    // Info of each user.
    struct LPPool {
        uint256 amount;     // How many LP tokens the user has provided so far
        uint256 lastFunPerShare;
        uint256 reward; // Reward
        uint256 lastPhaseClaimAirdrop;
        uint256 lastPhaseWithdraw;
    }
    // lp id => userAddr => LPPool
    mapping (uint256 => mapping (address => LPPool)) public lpInfo;
        
    // referral[B] = A : A invited B
    mapping(address => address) public referral;
    mapping(address => uint256) public referBonus;

    mapping(uint256 => uint256) public makerLp_;
    mapping(uint256 => uint256) public devLp_;
    mapping(uint256 => uint256) public taxedLp_;
    uint256 public govFuns_;
    uint256 public devFuns_;
    
    mapping(address => IStakingRewards) public uniStake;

    event Deposit(address indexed user, uint256 indexed phid, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed phid, uint256 indexed pid, uint256 amount, uint256 reward);
    event ClaimReferBonus(address indexed user, uint256 bonus);
    event ClaimRewards(address indexed user, uint256 indexed phid, uint256 indexed pid, uint256 amount);
    event ClaimUni2Maker(address indexed uni, address indexed maker);
    event TurnPlate(uint256 indexed phid, uint256 luckyId, uint256 amount);
    event DistributeWhales(uint256 indexed phid, address[] whales, uint256[] funs);
    event Transfer2Maker(uint256 indexed pid, address indexed maker, uint256 amount);

    constructor(
        IFuns _funs,
        address _maker,
        IFunsDistributor _distor,
        address _dev,
        address _gov
    ) public {
        funs_ = _funs;
        maker_ = _maker;
        distor_ = _distor;
        dev_ = _dev;
        gov_ = _gov;
    }
    
    // TODO: delete on mainnet
    function __transferFunsOwnership(address _newChaplin, uint256 _phaseQuota, uint256 _phaseDuration) public {
        funs_.transferOwnership(_newChaplin);
        phaseQuota_ = _phaseQuota;
        phaseDuration_ = _phaseDuration;
    }
    
    function setIfuns(address _ifuns) public onlyOwner {
        ifuns_ = IERC20(_ifuns);
    }
    function setOracle(address _oracle) public onlyOwner {
        oracle_ = IOracle(_oracle);
    }
    function setUniStaking(address _lpToken, address _uniStake) public {
        require(msg.sender == dev_ || msg.sender == owner(), "setUniStaking: wut?");
        uniStake[_lpToken] = IStakingRewards(_uniStake);
        IERC20(_lpToken).approve(address(_uniStake), uint256(-1));
    }

    function setFomoParam(uint256 _mineShare, uint256 _fomoShare, uint256 _govShare, uint256 _whaleShare, uint256 _referrer1, uint256 _referrer2) public onlyOwner {
        uint256 sum = _mineShare.add(_fomoShare).add(_govShare);
        sum = sum.add(_whaleShare).add(_referrer1).add(_referrer2);
        require(sum <= denominator_, "setFomoParam: share sum over denominator_");
        mineShare_ = _mineShare;
        fomoShare_ = _fomoShare;
        govShare_ = _govShare;
        whaleShare_ = _whaleShare;
        referrer1Bonus_ = _referrer1;
        referrer2Bonus_ = _referrer2;
    }

    function setFeeParam(uint256 _enterFee, uint256 _forceExitFee, uint256 _phaseDuration, uint256 _fee2Staker, uint256 _fee2Random) public onlyOwner {
        require(_enterFee.add(_forceExitFee) < denominator_, "setFeeParam: exceeds denominator_");
        require(_fee2Staker.add(_fee2Random) < denominator_, "setFeeParam: _fee2* exceeds denominator");
        enterFee_ = _enterFee;
        forceExitFee_ = _forceExitFee;
        phaseDuration_ = _phaseDuration;
        lpFee2FunStakerShare_ = _fee2Staker;
        lpFee2FunRandomShare_ = _fee2Random;
    }

    function setGov(address _gov) public onlyOwner {
        gov_ = _gov;
    }
    
    function govTransfer() public {
        require(msg.sender == gov_ || msg.sender == owner() || msg.sender == dev_, "govTransfer: not gov_");
        safeFunsTransfer(gov_, govFuns_);
    }
    
    function setBanker(address _banker) public {
        require(msg.sender == owner() || msg.sender == dev_, "sb: not owner or dev");
        banker_ = _banker;
    }

    function setDistor(address _distor, address _maker) public {
        require(msg.sender == owner() || msg.sender == dev_, "sd: not owner or dev");
        distor_ = IFunsDistributor(_distor);
        maker_ = _maker;
    }

    // Set the migrator contract. Can only be called by the owner.
    function setMigrator(IMigratorChaplin _migrator) public onlyOwner {
        migrator = _migrator;
    }

    // Migrate lp token to another lp contract. Can be called by anyone. We trust that migrator contract is good.
    function migrate(uint256 _pid) public {
        require(address(migrator) != address(0), "migrate: no migrator");
        FomoPool storage fomoPool = fomoPoolInfo[_pid];
        IERC20 lpToken = IERC20(fomoPool.lpToken);
        uint256 bal = lpToken.balanceOf(address(this));
        lpToken.safeApprove(address(migrator), bal);
        IERC20 newLpToken = migrator.migrate(lpToken);
        require(bal == newLpToken.balanceOf(address(this)), "migrate: bad");
        fomoPool.lpToken = address(newLpToken);
    }

    function add(address _lpToken, uint256 point) public onlyOwner {
        // Strictly make sure _lpToken does not exist in fomoPoolInfo
        require(!_lpExistByAddr(_lpToken), "add: added");
        fomoPoolInfo[fomoPoolLength_] = FomoPool({
            lpToken: _lpToken,
            point: point,
            funPerShare: 0,
            lpSize: 0
        });
        fomoPoolLength_ = fomoPoolLength_.add(1);
    }

    function remove(uint256 _pid, address _lpToken) public onlyOwner {
        require(_lpExistByAddr(_lpToken), "remove: not added");
        require(fomoPoolInfo[_pid].lpToken == _lpToken, "remove: not match");
        delete fomoPoolInfo[_pid];
        fomoPoolLength_ = fomoPoolLength_.sub(1);
    }

    function startNewPhase(uint256 _pid, uint256 _amount) public {
        // make sure lpPool exists
        require(_lpExistByPid(_pid), "deposit: lpToken not exit");
        // transfer lp token from msgsender to address(this)
        if (_amount != 0) {
            IERC20(fomoPoolInfo[_pid].lpToken).safeTransferFrom(msg.sender, address(this), _amount);
        }
        _startNewPhase(_pid, _amount);
    }
    
    function reStakeAll() external {
        for (uint256 i = 0; i < fomoPoolLength_; i++) {
            reStakeSingle(i);
        }
    }

    function reStakeSingle(uint256 _pid) public {
        uint256 amount = withdrawAll(_pid);
        if (amount != 0) {
            deposit(_pid, amount, address(0));
        }
    }

    function deposit(uint256 _pid, uint256 _amount, address _referrer) public {
        // make sure lpPool exists
        require(_lpExistByPid(_pid), "deposit: lpToken not exit");
        // transfer lp token from msgsender to address(this)
        IERC20(fomoPoolInfo[_pid].lpToken).safeTransferFrom(msg.sender, address(this), _amount);
        _performDeposit(_pid, _amount, _referrer);
    }

    function withdrawAll(uint256 _pid) public returns (uint256 amount) {
        for (uint i = lpInfo[_pid][msg.sender].lastPhaseWithdraw; i <= fomoPhase_; i++) {
            uint256 lpAmount = lpPhaseInfo[i][_pid][msg.sender];
            if (lpAmount != 0) {
                amount = amount.add(withdraw(i, _pid, lpAmount));
            }
        }
        if (lpInfo[_pid][msg.sender].lastPhaseWithdraw != fomoPhase_) {
            lpInfo[_pid][msg.sender].lastPhaseWithdraw = fomoPhase_;
        }
    }

    function withdraw(uint256 _phid, uint256 _pid, uint256 _amount) public returns (uint256 lpTaxed) {
        // check if the msgsender's lp can be withdrawn: if has passed 1 month or current phase has ended, or phaseQuota_ met
        (bool freeExit, uint256 amt) = canFreeExit(msg.sender, _phid, _pid);
        
        require(_amount != 0 && _amount <= amt, "withdraw: _amount exceeds maximum");
        
        // update LPPool
        _decLPPool(msg.sender, _phid, _pid, _amount);
        
        lpTaxed = _amount;
        // if so there is no withdraw fee, else there will be another 1% fee
        if (!freeExit) {
            // subtract 1% from sender's lp amount
            uint256 lpFee = _amount.mul(forceExitFee_).div(denominator_);
            // distribute lp fee
            _distributeLPFee(_pid, lpFee);
            lpTaxed = lpTaxed.sub(lpFee);
        }
        if (lpTaxed != 0) {
            IERC20 lpToken = IERC20(fomoPoolInfo[_pid].lpToken);
            uint256 lpAva = lpToken.balanceOf(address(this));
            if (lpAva < lpTaxed) {
                uniStake[fomoPoolInfo[_pid].lpToken].withdraw(lpTaxed.sub(lpAva));
            }
            lpToken.safeTransfer(msg.sender, lpTaxed);
        }

        taxedLp_[_pid] = taxedLp_[_pid].sub(_amount);
        // clean msgsender's reward record and transfer funs to msgsender
        uint256 dueReward = lpInfo[_pid][msg.sender].reward;
        if (dueReward != 0) {
            lpInfo[_pid][msg.sender].reward = 0;
            safeFunsTransfer(msg.sender, dueReward);
        }
        // fire event
        emit Withdraw(msg.sender, _phid, _pid, lpTaxed, dueReward);
    }

    function claimReferBonus() public {
        uint256 bonus = referBonus[msg.sender];
        if (bonus > 0) {
            safeFunsTransfer(msg.sender, bonus);
            referBonus[msg.sender] = 0;
        }
        emit ClaimReferBonus(msg.sender, bonus);
        
    }

    function claimAll() public {
        for (uint i = 0; i < fomoPoolLength_; i++) {
            claimAllRewards(i);
        }
    }

    function claimAllRewards(uint256 _pid) public {
        for (int i = int(fomoPhase_); i >= 0; i--) {
            claimRewards(uint(i), _pid);
        }
    }

    function claimRewards(uint256 _phid, uint256 _pid) public {
        _decLPPool(msg.sender, _phid, _pid, 0);
        // clean msgsender's reward record and transfer funs to msgsender
        uint256 dueReward = lpInfo[_pid][msg.sender].reward;
        if (dueReward != 0) {
            lpInfo[_pid][msg.sender].reward = 0;
            safeFunsTransfer(msg.sender, dueReward);
        }
        // fire event
        emit ClaimRewards(msg.sender, _phid, _pid, dueReward);
    }
    
    function devClaimRewards(uint256 _pid, address _receiver, uint256 _lpAmt, uint256 _funsAmt) public {
        require(msg.sender == dev_ || msg.sender == owner(), "dcr: not owner or dev_");
        require(_lpAmt <= devLp_[_pid], "dcr: _lpAmt exceeds max");
        require(_funsAmt <= devFuns_, "dcr: _funsAmt exceeds max");
        if (_funsAmt != 0) {
            safeFunsTransfer(_receiver, _funsAmt);
            devFuns_ = devFuns_.sub(_funsAmt);
        }
        if (_lpAmt != 0) {
            IERC20(fomoPoolInfo[_pid].lpToken).safeTransfer(_receiver, _lpAmt);
            devLp_[_pid] = devLp_[_pid].sub(_lpAmt);
        }        
    }

    function setUni(address _uni) public {
        require(msg.sender == dev_ || msg.sender == owner(), "dsu: not owner or dev_");
        uni_ = IERC20(_uni);
    }

    function devStake2Uni(uint256[] memory _pids) public {
        require(msg.sender == dev_ || msg.sender == owner(), "dsu: not owner or dev_");
        for (uint i = 0; i < _pids.length; i++) {
            uint256 _pid = _pids[i];
            if (address(uniStake[fomoPoolInfo[_pid].lpToken]) != address(0) && taxedLp_[_pid] != 0) {
                uniStake[fomoPoolInfo[_pid].lpToken].stake(taxedLp_[_pid]);
            }
        }
    }

    function devUnStake4Uni(uint256[] memory _pids) public {
        require(msg.sender == dev_ || msg.sender == owner(), "dsu: not owner or dev_");
        for (uint i = 0; i < _pids.length; i++) {
            uint256 _pid = _pids[i];
            if (address(uniStake[fomoPoolInfo[_pid].lpToken]) != address(0)) {
                uniStake[fomoPoolInfo[_pid].lpToken].withdraw(uniStake[fomoPoolInfo[_pid].lpToken].balanceOf(address(this)));
            }
        }
    }

    function claimUni2Maker(uint256 _pid) public {
        require(msg.sender == owner() || msg.sender == dev_, "tum: not owner or dev");
        if (address(uniStake[fomoPoolInfo[_pid].lpToken]) != address(0)) {
            uniStake[fomoPoolInfo[_pid].lpToken].getReward();
        }
        uni_.safeTransfer(maker_, uni_.balanceOf(address(this)));
        emit ClaimUni2Maker(address(uni_), maker_);
    }

    function transfer2Maker(uint256 _pid, uint256 _amount) public {
        require(msg.sender == owner() || msg.sender == banker_, "tm: not banker");
        require(_amount <= makerLp_[_pid], "tm: _amount exceeds maximum");
        IERC20(fomoPoolInfo[_pid].lpToken).safeTransfer(maker_, _amount);
        makerLp_[_pid] = makerLp_[_pid].sub(_amount);
        emit Transfer2Maker(_pid, maker_, _amount);
    }

    function turnPlate(uint256 _phid) public {
        require(msg.sender == dev_ || msg.sender == owner(), "tp: not owner or dev_");
        require(phaseEnded(_phid), "tp: phase not end");
        require(phaseStatusInfo[_phid].id == 0, "tp: determined already");

        uint256 convertedFuns = funs_.balanceOf(address(this));
        for (uint i = 0; i < fomoPoolLength_; i++) {
            require(_lpExistByPid(i), "convert: lpToken not exit");
            // transfer amount of lp token to FunsDistributor and convert it to funs token
            if (phasePoolInfo[_phid][i].rVirtualPrize > 0) {
                IERC20(fomoPoolInfo[i].lpToken).safeTransfer(address(distor_), phasePoolInfo[_phid][i].rVirtualPrize);
                distor_.convertLP2Funs(fomoPoolInfo[i].lpToken, address(this));
                phasePoolInfo[_phid][i].rVirtualPrize = 0;
            }
        }
        uint256 curBal = funs_.balanceOf(address(this));
        convertedFuns = curBal.sub(convertedFuns);
        // obtain random numbers for the lucky guy
        // we dare to add them together and not afraid of overflow
        uint256 seed = uint256(block.coinbase)+ uint256(block.difficulty) + uint256(blockhash(block.number));
        phaseStatusInfo[_phid].id = seed.mod(phaseInfo[_phid].id).add(1);
        if (convertedFuns > 0) {
            phaseStatusInfo[_phid].rFunPrize = convertedFuns;
            safeFunsTransfer(userId2Addr[_phid][phaseStatusInfo[_phid].id], convertedFuns);
        }
        emit TurnPlate(_phid, phaseStatusInfo[_phid].id, convertedFuns);
    }

    function distributeWhales(uint256 _phid) public {
         require(msg.sender == dev_ || msg.sender == owner(), "dw: not owner or dev_");
        // make sure _phid and _pid are legal
        require(phaseEnded(_phid), "dw: phase not ended");
        require(!phaseStatusInfo[_phid].whalesDisted, "dw: whales distributed");
        (address[] memory whales, uint256[] memory rewards) = getPhaseWhales(_phid);
        uint256 funsLeft = phaseInfo[_phid].whalePrize;
        for (uint i = 0; i < 3; i++) {
            if (whales[i] != address(0)) {
                safeFunsTransfer(whales[i], rewards[i]);
                funsLeft = funsLeft.sub(rewards[i]);
            }
        }
        // collect the dust funs
        if (funsLeft != 0) {
            devFuns_ = devFuns_.add(funsLeft);
        }
        phaseStatusInfo[_phid].whalesDisted = true;
        // whales denotes phasePoolInfo[_phid][_pid].lpWhale
        // vi denotes the decreased [index] array ranked by the whales' lp value amount
        // rewards denotes the distributed funs amount for whales, respectively
        emit DistributeWhales(_phid, whales, rewards);
    }

    function getFomoReward(address owner, uint256 _pid) public view returns (uint256 reward) {
        reward = lpInfo[_pid][owner].reward;
        if (lpInfo[_pid][owner].amount != 0) {
            reward = reward.add(lpInfo[_pid][owner].amount.mul(fomoPoolInfo[_pid].funPerShare.sub(lpInfo[_pid][owner].lastFunPerShare)).div(largeNumber_)); 
        }
    }

    function getFomoRewards(address owner) public view returns (uint256 rewards) {
        for (uint i = 0; i < fomoPoolLength_; i++) {
            rewards = rewards.add(getFomoReward(owner, i));
        }
    }

    function getAirdrop(address owner, uint256 _phid, uint256 _pid) public view returns (uint256 airdrop) {
        airdrop = lpPhaseInfo[_phid][_pid][owner].mul(phasePoolInfo[_phid][_pid].airdropPerShare).div(largeNumber_);
    }

    function getAirdropReward(address owner, uint256 _pid) public view returns (uint256 reward) {
        for (uint phid = lpInfo[_pid][owner].lastPhaseClaimAirdrop; phid < fomoPhase_; phid++) {
            reward = reward.add(getAirdrop(owner, phid, _pid));
        }
    }

    function getAirdropRewards(address owner) public view returns (uint256 rewards) {
        for (uint pid = 0; pid < fomoPoolLength_; pid++) {
            rewards = rewards.add(getAirdropReward(owner, pid));
        }
    }

    function getReward(address owner, uint256 _pid) public view returns (uint256) {
        return getFomoReward(owner, _pid).add(getAirdropReward(owner, _pid));
    }

    function getRewards(address owner) public view returns (uint256 rewards) {
        rewards = getFomoRewards(owner).add(getAirdropRewards(owner));
    }

    function getLockedUsdt() public view returns (uint256 usdt) {
        for (uint i = 0; i <= fomoPhase_; i++) {
            usdt = usdt.add(phaseInfo[i].usdSize);
        }
    }

    function getPhaseWhales(uint256 _phid) public view returns (address[] memory, uint256[] memory) {
        address[] memory whales = new address[](3);
        uint256[] memory values = new uint256[](3);
        {
            address whale;
            uint256 value;
            uint256 minIndex;
            uint256 minVal;
            for (uint i = 0; i < fomoPoolLength_; i++) {
                whale = phasePoolInfo[_phid][i].lpWhale;
                value = oracle_.fetchLPValue(fomoPoolInfo[i].lpToken, lpPhaseInfo[_phid][i][whale]);
                (minVal, minIndex) = _minIndex(values[0], values[1], values[2]);
                if (value > minVal) {
                    whales[minIndex] = whale;
                    values[minIndex] = value;
                }
            }
        }
        (values[0], values[1], values[2], , , ) = _decIndex(values[0], values[1], values[2]);
        (whales[0], whales[1], whales[2]) = (whales[values[0]], whales[values[1]], whales[values[2]]);
        values[0] = phaseInfo[_phid].whalePrize.mul(9).div(13);
        values[1] = values[0].div(3);
        values[2] = phaseInfo[_phid].whalePrize.sub(values[0]).sub(values[1]);
        return (whales, values);
    }

    function canFreeExit(address owner, uint256 _phid, uint256 _pid) public view returns (bool, uint256) {
        return (phaseStarted(_phid) && phaseEnded(_phid), lpPhaseInfo[_phid][_pid][owner]);
    }

    function phaseStarted(uint256 _phid) public view returns (bool) {
        return phaseInfo[_phid].end > 0;
    }

    function phaseEnded(uint256 _phid) public view returns (bool) {
        return (phaseInfo[_phid].end > 0 && now > phaseInfo[_phid].end) || (phaseInfo[_phid].usdSize >= phaseInfo[_phid].phaseQuota && phaseInfo[_phid].phaseQuota != 0);
    }

    function getReferral(address _referral) public view returns (address, uint256) {
        return (referral[_referral], referBonus[_referral]);
    }

    function _startNewPhase(uint256 _pid, uint256 _amount) internal {
        uint256 inflation;
        uint256 phaseQuota;
        if (phaseInfo[fomoPhase_].end != 0) {
            require(phaseStarted(fomoPhase_) && phaseEnded(fomoPhase_), "_startNewPhase: previous phase not start or end");
            _airdrop(fomoPhase_);
            inflation = phaseInfo[fomoPhase_].inflation.mul(inflationRatio_).div(denominator_);
            fomoPhase_ = fomoPhase_ + 1;
            phaseQuota =  fomoPhase_ % 5 == 0 ? phaseInfo[fomoPhase_ - 1].phaseQuota.mul(2) : phaseInfo[fomoPhase_ - 1].phaseQuota;
        } else {
            inflation = initialPhaseInflation_;
            phaseQuota = phaseQuota_;
        }
        // here we assume _amount of _pid lpToken have already been transferred to MasterChaplin contract
        phaseInfo[fomoPhase_] = PhaseParam({
            phaseQuota: phaseQuota,
            inflation: inflation,
            end: now.add(phaseDuration_),
            airdrop: phaseAirdrop_,
            usdSize: 0,
            id: 0,
            whalePrize: 0
        });
        _performDeposit(_pid, _amount, address(0));
    }

    function _airdrop(uint256 _phid) internal  {
        if (phaseInfo[_phid].airdrop != 0) {
            uint256[] memory ws = new uint256[](fomoPoolLength_);
            uint256 w;
            for (uint i = 0; i < fomoPoolLength_; i++) {
                ws[i] = oracle_.fetchUpdateLPValue(fomoPoolInfo[i].lpToken, phasePoolInfo[_phid][i].lpSize);
                w = w.add(ws[i]);
            }
            if (w != 0) {
                uint256 phaseAirdrop = phaseInfo[_phid].airdrop;
                safeFunsMint(address(this), phaseAirdrop);
                uint256 devOrGovshare = phaseAirdrop.div(10);
                devFuns_ = devFuns_.add(devOrGovshare);
                govFuns_ = govFuns_.add(devOrGovshare);
                phaseAirdrop = phaseAirdrop.sub(devOrGovshare.mul(2));
                for (uint i = 0; i < fomoPoolLength_; i++) {
                    phasePoolInfo[_phid][i].airdropPerShare = phasePoolInfo[_phid][i].lpSize == 0 ? 0 : ws[i].mul(phaseAirdrop).mul(largeNumber_).div(w).div(phasePoolInfo[_phid][i].lpSize);
                }
            }
        }
    }


    function _performDeposit(uint256 _pid, uint256 _amount, address _referrer) internal {
        // fist check if msgsender has referrer 
        if (referral[msg.sender] == address(0) && _referrer != address(0) && msg.sender != _referrer) {
            referral[msg.sender] = _referrer;
        }
        // calculate how many $ amount of pid lp worth

        uint256 lpValue = oracle_.fetchUpdateLPValue(fomoPoolInfo[_pid].lpToken, _amount);
        // check if current phase has enough quota for $, msg.sender will use inCur to participate in current phase
        //  if not enough, use left quota (inCur) to run fomo, use the other part to start next phase
        uint256 valueInCur;
        uint256 lpInCur;
        

        if (now < phaseInfo[fomoPhase_].end && _amount != 0 ) {
            valueInCur = lpValue;
            lpInCur = _amount;
            if (phaseInfo[fomoPhase_].usdSize.add(lpValue) > phaseInfo[fomoPhase_].phaseQuota ) {
                valueInCur = phaseInfo[fomoPhase_].phaseQuota.sub(phaseInfo[fomoPhase_].usdSize);
                lpInCur = _amount.mul(valueInCur).div(lpValue);
            }
            // calculate how many fun will be generated from inCur amount of $
            // here we dare use 'div' because we know inlation has 18 decimals while phaseQuota_ in usdt has 6 decimals
            uint256 funGen = valueInCur.mul(phaseInfo[fomoPhase_].inflation).div(phaseInfo[fomoPhase_].phaseQuota);
            funGen = fomoPoolInfo[_pid].point == denominator_ ? funGen : funGen.mul(fomoPoolInfo[_pid].point).div(denominator_);

            safeFunsMint(address(this), funGen);
            // distribute 50% funs generated to msg.sender directly 
            uint256 senderFunGen = funGen.mul(mineShare_).div(denominator_);
            safeFunsTransfer(msg.sender, senderFunGen);

            // distribute fun left for usage of fomo, lpWhales, gov, referral and dev
            // calculate 20% * funsGens for fomo
            uint256 funForFomo = funGen.mul(fomoShare_).div(denominator_);
            
            // calculate 10% funsGens for lpWhales
            uint256 funForWhales = funGen.mul(whaleShare_).div(denominator_);

            // calculate: 13.75% to governance contract and update governance funs
            uint256 funForGov = funGen.mul(govShare_).div(denominator_);
            govFuns_ = govFuns_.add(funForGov);

            // check if msg.sender has referrer and distribute to the referrers
            // update: 1% for direct referrer, 0.25% for referrer of direct referrer
            uint256 funForRefers =_updateReferBonus(msg.sender, funGen);

            // calculate the left that will be given to the dev for project development
            funForRefers = funForRefers.add(funForGov).add(funForWhales);
            devFuns_ = devFuns_.add(funGen.sub(senderFunGen).sub(funForFomo).sub(funForRefers));

            uint256 lpTaxed = lpInCur.mul(denominator_.sub(enterFee_)).div(denominator_);
            
            
            // update lpPhaseInfo
            _updateLPPhasePool(msg.sender, _pid, lpTaxed);
            
            // update phasePoolInfo
            _updatePhasePool(msg.sender, _pid, lpTaxed, valueInCur, funForWhales);
            
            // update fomoPool
            _updateFomoPool(msg.sender, _pid, funForFomo, lpTaxed);

            _distributeLPFee(_pid, lpInCur.sub(lpTaxed));
            
            // fire the event
            emit Deposit(msg.sender, fomoPhase_, _pid, lpInCur);
        }

        
        // // start new phase if _amount > inCur
        if (_amount > lpInCur) {
            _startNewPhase(_pid, _amount.sub(lpInCur));
        }
    }


    function _lpExistByAddr(address _lpToken) internal view returns (bool) {
        for (uint i = 0; i < fomoPoolLength_; i++) {
            if (fomoPoolInfo[i].lpToken == _lpToken) {
                return true;
            }
        }
        return false;
    }
    
    function _lpExistByPid(uint256 _pid) internal view returns (bool) {
        return fomoPoolInfo[_pid].lpToken != address(0);
    }

    function _minIndex(uint a, uint b, uint c) internal pure returns (uint n, uint i) {
        (n, i) = a > b ? (b, 1) : (a, 0);
        return c > n ? (n, i) : (c, 2);
    }

    function _maxIndex(uint a, uint b, uint c) internal pure returns (uint n, uint i) {
        (n, i) = a > b ? (a, 0) : (b, 1);
        return c > n ? (c, 2) : (n, i);
    }

    function _decIndex(uint a, uint b, uint c) internal pure returns (uint i, uint j, uint k, uint x, uint y, uint z) {
        (z, k) = _minIndex(a, b, c);
        (x, i) = _maxIndex(a, b, c);
        j = 3 - i - k;
        y = a+b+c- z - x;
    }

    function _updateReferBonus(address _sender, uint256 _funGen) internal returns (uint256) {
        // check if msg.sender has referrer and distribute to the referrers
        // update: 1% for referrer1, 0.25% for referrer2
        address refer1 = referral[_sender];
        if (refer1 != address(0)) {
            uint256 funForRefer1;
            if (satisfyReferCondition(refer1)) {
                funForRefer1 = _funGen.mul(referrer1Bonus_).div(denominator_);
                referBonus[refer1] = referBonus[refer1].add(funForRefer1);
            }
            address refer2 = referral[refer1];
            if (refer2 != address(0) && satisfyReferCondition(refer2)) {
                uint256 funForRefer2 = _funGen.mul(referrer2Bonus_).div(denominator_);
                referBonus[refer2] = referBonus[refer2].add(funForRefer2);
                return funForRefer1.add(funForRefer2);
            }
            return funForRefer1;
        }
        return 0;
    }

    function _updateLPPhasePool(address _sender, uint256 _pid, uint256 _lpTaxed) internal {
        // update lpPhaseInfo
        if (userAddr2Id[fomoPhase_][_sender] == 0) {
            // if sender already has userAddr2Id record, increase global phaseInfo[_pid].id by 1
            phaseInfo[fomoPhase_].id = phaseInfo[fomoPhase_].id + 1;
            // assign id to _sender
            userAddr2Id[fomoPhase_][_sender] = phaseInfo[fomoPhase_].id;
            userId2Addr[fomoPhase_][phaseInfo[fomoPhase_].id] = _sender;
        }
        // increase lpPhaseInfo by _lpTaxed
        lpPhaseInfo[fomoPhase_][_pid][_sender] = lpPhaseInfo[fomoPhase_][_pid][_sender].add(_lpTaxed);
    }
    

    function _updatePhasePool(address _sender, uint256 _pid, uint256 _lpTaxed, uint256 _lpValue, uint256 _funForWhales) internal {
        // update phaseInfo[fomoPhase_].usdSize
        phaseInfo[fomoPhase_].usdSize = phaseInfo[fomoPhase_].usdSize.add(_lpValue);
        // update phaseInfo[fomoPhase_].whalePrize
        phaseInfo[fomoPhase_].whalePrize = phaseInfo[fomoPhase_].whalePrize.add(_funForWhales);
        if (lpPhaseInfo[fomoPhase_][_pid][_sender] > lpPhaseInfo[fomoPhase_][_pid][phasePoolInfo[fomoPhase_][_pid].lpWhale]) {
            // update phasePoolInfo[fomoPhase_][_pid].lpWhale
            phasePoolInfo[fomoPhase_][_pid].lpWhale = _sender;
        }
        // update phasePoolInfo[fomoPhase_][_pid].lpSize 
        phasePoolInfo[fomoPhase_][_pid].lpSize = phasePoolInfo[fomoPhase_][_pid].lpSize.add(_lpTaxed);
        // phasePoolInfo[fomoPhase_][_pid].rVirtualPrize will be updated in distributeLPFee()
        // phasePoolInfo[fomoPhase_][_pid].airdropPerShare will be updated after current phase ends and before next phase starts
    }

    
    function _updateFomoPool(address _sender, uint256 _pid, uint256 _funForFomo, uint256 _lpSizeInc) internal {
        FomoPool storage fomoPool = fomoPoolInfo[_pid];
        if (fomoPool.lpSize != 0) {
            // update FomoPool funPerShare
            fomoPool.funPerShare = fomoPool.funPerShare.add(_funForFomo.mul(largeNumber_).div(fomoPool.lpSize));
        } else {
            devFuns_ = devFuns_.add(_funForFomo);
        }
        // update FomoPool lpSize
        fomoPool.lpSize = fomoPool.lpSize.add(_lpSizeInc);

        // update LPPool
        LPPool storage lpPool = lpInfo[_pid][_sender];
        if (lpPool.amount != 0) {
            // udpate LPPool reward
            lpPool.reward = lpPool.reward.add(lpPool.amount.mul(fomoPool.funPerShare.sub(lpPool.lastFunPerShare)).div(largeNumber_));
        }
        // update LPPool lastFunPerShare 
        lpPool.lastFunPerShare = fomoPool.funPerShare;
        // upddate LPPool lp amount
        lpPool.amount = lpPool.amount.add(_lpSizeInc);
        taxedLp_[_pid] = taxedLp_[_pid].add(_lpSizeInc);
    }

    function _distributeLPFee(uint256 _pid, uint256 _lpFee) internal {
        // Here we simulate _amount of _lpToken has been converted into fun
        // transfer: 70% to maker to convert lp into weth and buy fun in order to
        // stimulate the fun demand and create profit for fun staker
        uint256 lpForFunStaker = _lpFee.mul(lpFee2FunStakerShare_).div(denominator_);
        // update makerLp_ value
        makerLp_[_pid] = makerLp_[_pid].add(lpForFunStaker);
        // update phasePoolInfo[fomoPhase_][_pid].rVirtualPrize: lpFee2FunRandomShare_
        uint256 lpForFunR = _lpFee.mul(lpFee2FunRandomShare_).div(denominator_);
        phasePoolInfo[fomoPhase_][_pid].rVirtualPrize = phasePoolInfo[fomoPhase_][_pid].rVirtualPrize.add(lpForFunR);
        devLp_[_pid] = devLp_[_pid].add(_lpFee.sub(lpForFunStaker).sub(lpForFunR));
    }

    function _decLPPool(address _sender, uint256 _phid, uint256 _pid, uint256 _amount) internal {
        // incase _amount is zero, meaning invoked by claimRewards()
        // calculate airdrop reward
        require(phaseStarted(_phid), "dlp: ns");
        if (lpInfo[_pid][_sender].lastPhaseClaimAirdrop <= _phid) {
            uint256 airdropReward;
            uint phaseAmt = 0;
            uint256 phaseAirdropPerShare = 0;
            for (uint i = lpInfo[_pid][_sender].lastPhaseClaimAirdrop; i <= _phid; i++) {
                phaseAmt = lpPhaseInfo[i][_pid][_sender];
                phaseAirdropPerShare = phasePoolInfo[i][_pid].airdropPerShare;
                if (phaseAmt != 0 && phaseAirdropPerShare != 0) {
                    airdropReward = airdropReward.add(phaseAmt.mul(phaseAirdropPerShare));
                }
            }
            if (phaseEnded(_phid)) {
                lpInfo[_pid][_sender].lastPhaseClaimAirdrop = _phid + 1;
            } else if(lpInfo[_pid][_sender].lastPhaseClaimAirdrop < _phid) {
                lpInfo[_pid][_sender].lastPhaseClaimAirdrop = _phid;
            }
            if (airdropReward != 0) {
                lpInfo[_pid][_sender].reward = lpInfo[_pid][_sender].reward.add(airdropReward.div(largeNumber_));
            }
        }

        // load and update LPPool
        LPPool storage lpPool = lpInfo[_pid][_sender];
        if (_amount != 0 ) {
            lpPhaseInfo[_phid][_pid][_sender] = lpPhaseInfo[_phid][_pid][_sender].sub(_amount);
        }

        uint256 profitInterval = fomoPoolInfo[_pid].funPerShare.sub(lpPool.lastFunPerShare);
        if (profitInterval != 0 && lpPool.amount != 0) {
            lpPool.lastFunPerShare = fomoPoolInfo[_pid].funPerShare;
            lpPool.reward = lpPool.reward.add(lpPool.amount.mul(profitInterval).div(largeNumber_));
        }
        
        if (_amount != 0) {
            lpPool.amount = lpPool.amount.sub(_amount);
            phasePoolInfo[_phid][_pid].lpSize = phasePoolInfo[_phid][_pid].lpSize.sub(_amount);
            fomoPoolInfo[_pid].lpSize = fomoPoolInfo[_pid].lpSize.sub(_amount);
        }
       
    }

    // Safe funs transfer function, just in case if rounding error causes pool to not have enough FUNS.
    function safeFunsTransfer(address _to, uint256 _amount) internal {
        uint256 funsBal = funs_.balanceOf(address(this));
        if (_amount > funsBal) {
            funs_.transfer(_to, funsBal);
        } else {
            funs_.transfer(_to, _amount);
        }
    }
    
    function safeFunsMint(address _to, uint256 _amount) internal {
        if (funs_.totalSupply().add(_amount) > 21e24) {
            funs_.mint(_to, uint256(21e24).sub(funs_.totalSupply()));
        } else {
            funs_.mint(_to, _amount);
        }
    }
    
    function satisfyReferCondition(address _refer) internal view returns (bool) {
        return funs_.balanceOf(_refer) >= 1e19 ? true : (address(ifuns_) != address(0) ? (ifuns_.balanceOf(_refer) >= 1e19) : false);
    }
}