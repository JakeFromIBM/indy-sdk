const indy = require('indy-sdk')
const util = require('./util')
const colors = require('./colors')
const prompts = require('prompts')
const fs = require('fs')

const log = console.log


function logValue() {
    log(colors.CYAN, ...arguments, colors.NONE)
}

async function init() {

    const response = await prompts({
        type: 'text',
        name: 'userName',
        message: 'what is your name?: '
    })
    const walletName = { 'id': `${response.userName}Wallet` }
    const walletCredentials = { 'key': `${response.userName}Credentials` }
    logValue('Wallet name:', walletName)


    try {
        await indy.createWallet(walletName, walletCredentials)
    } catch {
        await indy.deleteWallet(walletName, walletCredentials)
        await indy.createWallet(walletName, walletCredentials)
    }

    const walletHandle = await indy.openWallet(walletName, walletCredentials)
    logValue("wallet", walletHandle)

    const [myDid, myVerkey] = await indy.createAndStoreMyDid(walletHandle, {})

    logValue("My DID: ", myDid, "\n", "My Verkey: ", myVerkey)

    const theirResponse = await prompts([{
        type: 'text',
        name: 'theirDid',
        message: 'what is the other party\'s DID?: '
    },
    {
        type: 'text',
        name: 'theirVerkey',
        message: 'what is the other party\'s Verkey?: '
    }
    ])



    return {
        wallet: walletHandle,
        senderDID: myDid,
        senderVerkey: myVerkey,
        recvDID: theirResponse.theirDid,
        recvVerykey: theirResponse.theirVerkey,
        walletCredential: walletCredentials,
        walletName: walletName
    }
}

async function prep(walletHandle, myVerkey, recvVerkey, msg) {
    var textEncoder = new TextEncoder()
    var msgAsByteArray = textEncoder.encode(msg)
    var verkeyArray = [recvVerkey]
    var encryptedMsg = await indy.packMessage(walletHandle, msgAsByteArray, verkeyArray, myVerkey)
    logValue("Encrypted msg: ", encryptedMsg)
    fs.writeFile('msg.dat', encryptedMsg, 'utf8', function (err) {
        if (err) throw err;
        log('Saved!')
    })
}

async function read(walletHandle) {
    var textEncoder = new TextEncoder()
    var textDecoder = new TextDecoder()

    fs.readFile('msg.dat', 'utf8', async function (err, data) {
        var encryptedMsg = data
        var decryptedMsg = await indy.unpackMessage(walletHandle, textEncoder.encode(encryptedMsg))
        logValue("Decrypted message: ", JSON.parse(textDecoder.decode(decryptedMsg)).message)
    })
}

async function run() {

    var initValues = await init()

    while (true) {
        const response = await prompts({
            type: 'text',
            name: 'command',
            message: 'what would you like to do (quit, read, or prep)?: '
        })
        if (response.command == 'prep') {
            const msgResponse = await prompts({
                type: 'text',
                name: 'msg',
                message: 'what message would you like to send?: '
            })
            await prep(initValues.wallet,
                initValues.senderVerkey,
                initValues.recvVerykey,
                msgResponse.msg)
        }
        if (response.command == 'quit') {
            indy.closeWallet(initValues.wallet)
            indy.deleteWallet(initValues.walletName, initValues.walletCredential)
            break
        }
        if (response.command == 'read') {
            await read(initValues.wallet)
        }
    }
}



try {
    run()
} catch (e) {
    log("ERROR occurred : e")
}