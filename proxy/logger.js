const fs = require("fs")

function logRequest(data){

    const line = JSON.stringify(data) + "\n"

    fs.appendFileSync("./logs.txt",line)

}

module.exports = logRequest