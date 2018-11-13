var INFURA_ROPSTEN_URL = 'https://ropsten.infura.io/gmXEVo5luMPUGPqg6mhy';
var INFURA_MAINNET_URL = 'https://mainnet.infura.io/gmXEVo5luMPUGPqg6mhy';

var clmHelper = require('./modules/helperModule')

const POOL_ENV = 'test';


var Web3 = require('web3')
fs = require('fs');

const poolConfig = require('./pool.config').config
var https_enabled = process.argv[2] === 'https';

if (process.argv[2] == "test") {
  POOL_ENV = 'test'
}

if (process.argv[2] == "staging") {
  POOL_ENV = 'staging'
}


var redisModule = require('./modules/redisModule')
var mongoModule = require('./modules/mongoModule')
var peerModule = require('./modules/peerModule')
var tokenModule = require('./modules/tokenModule')
var minerModule = require('./modules/minerModule')

var web3 = new Web3()

var specified_web3 = poolConfig.web3provider;
if (specified_web3 != null) {web3.setProvider(specified_web3)}


switch (POOL_ENV) {
  case "test":
    console.log("==== Using test mode - Ropsten ==== ")
    if (specified_web3 == null) {web3.setProvider(INFURA_ROPSTEN_URL)}
    accountConfig = require('./test.account.config').accounts;
    break;
  case "staging":
    console.log("Using staging mode!!! - Mainnet ")
    if (specified_web3 == null) {  web3.setProvider(INFURA_MAINNET_URL)}
    accountConfig = require('./account.config').accounts;
    break;
  default:
    console.log("Using default mode!!! - Mainnet ")
    if (specified_web3 == null) {web3.setProvider(INFURA_MAINNET_URL)}
    accountConfig = require('./account.config').accounts;
}

init(web3);

async function init(web3) {
  await redisModule.init()
  await mongoModule.init()
  await tokenModule.init(redisModule, mongoModule, web3, accountConfig, poolConfig, POOL_ENV)
  await minerModule.init( web3, redisModule, mongoModule, poolConfig, POOL_ENV)
  await peerModule.init(web3, accountConfig, poolConfig, redisModule, mongoModule, tokenModule, minerModule)
  peerModule.update();
  tokenModule.update();
  peerModule.listenForJSONRPC();

  clmHelper.printLog("Index.js ready")
}
