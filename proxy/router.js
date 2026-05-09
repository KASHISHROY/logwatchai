const fs = require("fs")

function getTarget(){

    const config = JSON.parse(
        fs.readFileSync("./config.json")
    )

    if(config.mode === "stable"){
        return config.stable_url
    }

    if(config.mode === "test"){
        return config.test_url
    }

    if(config.mode === "canary"){

        const r = Math.random()*100

        if(r < config.canary_percent){
            return config.test_url
        }

        return config.stable_url
    }

}

module.exports = getTarget