
const config = require('../config/global.config.json');

module.exports =  {


    printLog(_log)
    {
        if (config.logs.print_logs)
/*
        switch (_type) {
            case "WARN":
                console.log("\n == WARNING!! == \n " + _log)
                break;
            default:
                console.log(_log)

        }*/

        console.log(_log)
    },


}
