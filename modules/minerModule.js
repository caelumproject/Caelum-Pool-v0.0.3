var _CONTRACT_ABI_MINER = require('../config/ABI/CaelumMinerABI.json');
var deployedContractInfo = require('../config/caelumContracts.json');

var web3Utils = require('web3-utils')
var clmHelper = require('./helperModule')

module.exports = {

async init(web3, redisInterface, mongoInterface, poolConfig, pool_env) {
    this.redisInterface = redisInterface;
    this.mongoInterface = mongoInterface;
    this.web3 = web3;
    this.pool_env = pool_env;
    this.poolConfig = poolConfig;

    this.miningContract = new web3.eth.Contract(_CONTRACT_ABI_MINER.abi, this.getMinerContractAddress())
    clmHelper.printLog("minerModule ready")
    this.update()
},

async update() {
    var self = this;

    await self.collectMiningParameters();

    setInterval(function() {
      self.collectMiningParameters()
    }, 2000);
},

getMinerContractAddress() {
  if (this.pool_env == 'test') {
    return deployedContractInfo.networks.testnet.contracts._contract_miner.blockchain_address;
  } else if (this.pool_env == 'staging') {
    return deployedContractInfo.networks.staging.contracts._contract_miner.blockchain_address;
  } else {
    return deployedContractInfo.networks.mainnet.contracts._contract_miner.blockchain_address;
  }

},

async collectMiningParameters() {
  var miningDifficultyString = await this.miningContract.methods.getMiningDifficulty().call();
  var miningDifficulty = parseInt(miningDifficultyString)
  var miningTargetString = await this.miningContract.methods.getMiningTarget().call();
  var miningTarget = web3Utils.toBN(miningTargetString)
  var challengeNumber = await this.miningContract.methods.getChallengeNumber().call();

  if (challengeNumber != this.challengeNumber) {

    // check if we've seen this challenge before
    var seenBefore = await this.redisInterface.isElementInRedisList("recent_challenges", challengeNumber);
    if (!seenBefore) {
      this.challengeNumber = challengeNumber;
      console.log('New challenge:', challengeNumber);
      this.redisInterface.pushToRedisList("recent_challenges", challengeNumber);
      this.redisInterface.popLastFromRedisList("recent_challenges");
      this.redisInterface.storeRedisData('challengeNumber', challengeNumber)
    } else {
      console.log('Old challenge:', challengeNumber);
    }
  }

  this.miningDifficulty = miningDifficulty;
  this.difficultyTarget = miningTarget;

  this.redisInterface.storeRedisData('miningDifficulty', miningDifficulty)
  this.redisInterface.storeRedisData('miningTarget', miningTarget.toString())

  var web3 = this.web3;
  var ethBlockNumber = await new Promise(function(fulfilled, error) {
    web3.eth.getBlockNumber(function(err, result) {
      if (err) {
        error(err);
        return
      }
      console.log('eth block number ', result)
      fulfilled(result);
      return;
    });
  });

  this.redisInterface.storeRedisData('ethBlockNumber', ethBlockNumber)
},

}
