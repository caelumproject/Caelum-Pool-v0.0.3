const Tx = require('ethereumjs-tx')

var _CONTRACT_ABI_TOKEN = require('../config/ABI/CaelumTokenABI.json');
var deployedContractInfo = require('../config/caelumContracts.json');

var web3Utils = require('web3-utils')
var cluster = require('cluster')

var clmHelper = require('./helperModule')
var transactionCoordinator = require('./transactionModule')

/**
BUG : pool is resending transactions!
DEV: Is it??
**/


// We should seperate this. Necesarry? No. Usable? Yes.
// This section should hande the token ONLY.
module.exports = {

  async init(redisInterface, mongoInterface, web3, accountConfig, poolConfig, pool_env) {
      clmHelper.printLog("tokenModule started")
      this.redisInterface = redisInterface;
      this.mongoInterface = mongoInterface;
      this.web3 = web3;
      this.pool_env = pool_env;
      this.poolConfig = poolConfig;
      this.accountConfig = accountConfig;
      this.tokenContract = new web3.eth.Contract(_CONTRACT_ABI_TOKEN.abi, this.getTokenContractAddress())

      if (cluster.isMaster) {
        this.redisInterface.dropList("recent_challenges");
        this.redisInterface.pushToRedisList("recent_challenges", ["-", "-", "-", "-", "-"]);
      }

    },

    async update() {
      clmHelper.printLog("token update")
      var self = this;

      transactionCoordinator.init(
        this.web3,
        this.tokenContract,
        this.poolConfig,
        this.accountConfig,
        this.redisInterface,
        this.mongoInterface,
        this,
        this.pool_env
      )

      transactionCoordinator.update();

      setTimeout(function() {
        self.transferMinimumTokensToPayoutWallet()
      }, 1000)


      setTimeout(function() {
        self.queueTokenTransfersForBalances()
      }, 0)


    },

    async getPoolChallengeNumber() {
        console.log("get pool challange")
      return await this.redisInterface.loadRedisData('challengeNumber');
    },

    async getPoolDifficultyTarget() {
      var targetString = await this.redisInterface.loadRedisData('miningTarget');
      return targetString
    },

    async getPoolDifficulty() {
      return await this.redisInterface.loadRedisData('miningDifficulty');
    },

    async getEthBlockNumber() {
      var result = parseInt(await this.redisInterface.loadRedisData('ethBlockNumber'));

      if (isNaN(result) || result < 1) result = 0;

      return result
    },

    getTokenContractAddress() {
      if (this.pool_env == 'test') {
        return deployedContractInfo.networks.testnet.contracts._contract_token.blockchain_address;
      } else if (this.pool_env == 'staging') {
        return deployedContractInfo.networks.staging.contracts._contract_token.blockchain_address;
      } else {
        return deployedContractInfo.networks.mainnet.contracts._contract_token.blockchain_address;
      }

    },

    //use address from ?
    async queueMiningSolution(solution_number, minerEthAddress, challenge_digest, challenge_number) {
      var currentTokenMiningReward = await this.requestCurrentTokenMiningReward()

      var txData = {
        minerEthAddress: minerEthAddress, //we use this differently in the pool!
        solution_number: solution_number,
        challenge_digest: challenge_digest,
        challenge_number: challenge_number,
        tokenReward: currentTokenMiningReward
      }

      await transactionCoordinator.addTransactionToQueue('solution', txData)
    },

    //minerEthAddress
    async queueTokenTransfer(addressFromType, addressTo, tokenAmount, balancePaymentId) {
      var txData = {
        addressFromType: addressFromType, //payment or minting
        addressTo: addressTo,
        tokenAmount: tokenAmount,
        balancePaymentId: balancePaymentId
      }
     // await transactionCoordinator.addTransactionToQueue('transfer', txData)
    },

    async transferMinimumTokensToPayoutWallet() {
      var minPayoutWalletBalance = this.poolConfig.payoutWalletMinimum; //this is in token-satoshis

      if (minPayoutWalletBalance == null) {
        minPayoutWalletBalance = 1000 * 100000000;
      }

      var payoutWalletAddress = this.getPaymentAccount().address;
      var mintingWalletAddress = this.getMintingAccount().address;

      var payoutWalletBalance = await this.getTokenBalanceOf(payoutWalletAddress)
      var mintingWalletBalance = await this.getTokenBalanceOf(mintingWalletAddress)

      var balancePaymentId = web3Utils.randomHex(32);


      if (payoutWalletBalance < minPayoutWalletBalance && mintingWalletBalance >= minPayoutWalletBalance) {
        //queue a new transfer from the minting wallet to the payout wallet
        await this.queueTokenTransfer('minting', payoutWalletAddress, minPayoutWalletBalance, balancePaymentId)
      }


      var self = this;
      setTimeout(function() {
          self.transferMinimumTokensToPayoutWallet()
        }, 5 * 60 * 1000) //every five minutes

    },

    async getTokenBalanceOf(address) {
      var walletBalance = await this.tokenContract.methods.balanceOf(address).call();
      return walletBalance;
    },

    // TODO: Can we push a tx manually by setting min_balance_for_transfer to 0 ?
    async queueTokenTransfersForBalances() {
      console.log('queueTokenTransfersForBalances')
      var self = this;

      var min_balance_for_transfer = this.poolConfig.minBalanceForTransfer; //this is in token-satoshis

      var minerList = await this.getMinerList()

      for (i in minerList) //reward each miner
      {
        var minerAddress = minerList[i];

        var minerData = await this.getMinerData(minerAddress)

        var miner_token_balance = minerData.tokenBalance;


        if (miner_token_balance > min_balance_for_transfer) {

          console.log('transfer tokens to   ', minerAddress, 'with balance ', miner_token_balance)

          minerData.tokensAwarded += miner_token_balance;

          var blockNumber = await this.getEthBlockNumber();

          var balancePaymentData = {
            id: web3Utils.randomHex(32),
            minerAddress: minerAddress,
            previousTokenBalance: minerData.tokenBalance,
            newTokenBalance: 0,
            block: blockNumber
          }

          console.log('storing balance payment', ('balance_payments:' + minerAddress.toString().toLowerCase()), balancePaymentData)

          //this list is no longer used
          await this.redisInterface.pushToRedisList(('balance_payments:' + minerAddress.toString().toLowerCase()), JSON.stringify(balancePaymentData))

          await this.redisInterface.storeRedisHashData('balance_payment', balancePaymentData.id, JSON.stringify(balancePaymentData))

          await this.mongoInterface.upsertOne('balance_payment', {
              id: balancePaymentData.id
            }, balancePaymentData)

          minerData.tokenBalance = 0;

          this.saveMinerDataToRedis(minerAddress, minerData)

        }else {
        console.log("Not enough to reach min payout for " + miner_token_balance)
      }

      }

      setTimeout(function() {
        self.queueTokenTransfersForBalances()
      }, 20 * 1000)
    },

    async saveMinerDataToRedis(minerEthAddress, minerData) {
      if (minerEthAddress == null) return;
      minerEthAddress = minerEthAddress.toString().toLowerCase()
      await this.redisInterface.storeRedisHashData("miner_data_downcase", minerEthAddress, JSON.stringify(minerData))
      await this.mongoInterface.upsertOne("miner_data_downcase", {
        minerEthAddress: minerEthAddress
      }, minerData)
    },

    async getMinerData(minerEthAddress) {
      if (minerEthAddress == null) return;
      minerEthAddress = minerEthAddress.toString().toLowerCase()
      var minerDataJSON = await this.redisInterface.findHashInRedis("miner_data_downcase", minerEthAddress);
      return JSON.parse(minerDataJSON);
    },

    async getMinerList() {
      var minerData = await this.redisInterface.getResultsOfKeyInRedis("miner_data_downcase");
      return minerData;
    },

    getTransactionCoordinator() {
      return transactionCoordinator;
    },

    getTokenContract() {
      return this.tokenContract;
    },

    async requestCurrentTokenMiningReward() {
      /**
       * OVERRIDE FOR MASTERNODES:
       *
       * Call the `contractProgress` parameter.
       * Returns:
       *    [0] epoch|uint256
       *    [1] candidate|uint256
       *    [2] round|uint256
       *    [3] miningepoch|uint256
       *    [4] globalreward|uint256
       *    [5] powreward|uint256
       *    [6] masternodereward|uint256
       *    [7] usercounter|uint256
       */

      var self = this;
      var reward_amount = new Promise(function(fulfilled, error) {

        //self.tokenContract.methods.getMiningReward().call(function(err,
        self.tokenContract.methods.contractProgress().call(function(err, result) {
          if (err) {
            error(err);
            return;
          }

          fulfilled(result[5])

        });
      });

      return reward_amount;
    },

    getMintingAccount() {
      return this.accountConfig.minting;
    },

    getPaymentAccount() {
      return this.accountConfig.payment;
    }



}
