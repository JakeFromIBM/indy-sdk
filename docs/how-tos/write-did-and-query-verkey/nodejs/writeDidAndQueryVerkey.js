/**
 * Example demonstrating how to add DID with the role of Trust Anchor as Steward.
 *
 * Uses seed to obtain Steward's DID which already exists on the ledger.
 * Then it generates new DID/Verkey pair for Trust Anchor.
 * Using Steward's DID, NYM transaction request is built to add Trust Anchor's DID and Verkey
 * on the ledger with the role of Trust Anchor.
 * Once the NYM is successfully written on the ledger, it generates new DID/Verkey pair that represents
 * a client, which are used to create GET_NYM request to query the ledger and confirm Trust Anchor's Verkey.
 *
 * For the sake of simplicity, a single wallet is used. In the real world scenario, three different wallets
 * would be used and DIDs would be exchanged using some channel of communication
 */

const indy = require('indy-sdk')
const util = require('./util')
const colors = require('./colors')

const log = console.log

function logValue() {
    log(colors.CYAN, ...arguments, colors.NONE)
}

async function run() {

    log("Set protocol version 2 to work with Indy Node 1.4")
    await indy.setProtocolVersion(2)

    // Tell SDK which pool you are going to use. You should have already started
    // this pool using docker compose or similar. Here, we are dumping the config
    // just for demonstration purposes.

    // 1.
    log('1. Creates a new local pool ledger configuration that is used later when connecting to ledger.')
    const poolName = 'pool'
    const genesisFilePath = await util.getPoolGenesisTxnPath(poolName)
    const poolConfig = { 'genesis_txn': genesisFilePath }
    try {
        await indy.createPoolLedgerConfig(poolName, poolConfig)
    } catch{
        await indy.deletePoolLedgerConfig(poolName)
        await indy.createPoolLedgerConfig(poolName, poolConfig)
    }


    // 2.
    log('2. Open pool ledger and get handle from libindy')
    const poolHandle = await indy.openPoolLedger(poolName, undefined)

    // 3.
    log('3. Creating new secure wallet')
    const walletName = { "id": "wallet" }
    const walletCredentials = { "key": "wallet_key" }
    await indy.createWallet(walletName, walletCredentials)

    // 4.
    log('4. Open wallet and get handle from libindy')
    const walletHandle = await indy.openWallet(walletName, walletCredentials)

    // First, put a steward DID and its keypair in the wallet. This doesn't write anything to the ledger,
    // but it gives us a key that we can use to sign a ledger transaction that we're going to submit later.
    // The DID and public verkey for this steward key are already in the ledger; they were part of the genesis
    // transactions we told the SDK to start with in the previous step. But we have to also put the DID, verkey,
    // and private signing key into our wallet, so we can use the signing key to submit an acceptably signed
    // transaction to the ledger, creating our *next* DID (which is truly new). This is why we use a hard-coded seed
    // when creating this DID--it guarantees that the same DID and key material are created that the genesis txns
    // expect.

    // 5.
    log('5. Generating and storing steward DID and verkey')
    const stewardSeed = '000000000000000000000000Steward1'
    const did = { 'seed': stewardSeed }
    const [stewardDid, stewardVerkey] = await indy.createAndStoreMyDid(walletHandle, did)
    logValue('Steward DID: ', stewardDid)
    logValue('Steward Verkey: ', stewardVerkey)

    // Now, create a new DID and verkey for a trust anchor, and store it in our wallet as well. Don't use a seed;
    // this DID and its keys are secure and random. Again, we're not writing to the ledger yet.

    // 6.
    log('6. Generating and storing trust anchor DID and verkey')
    const [trustAnchorDid, trustAnchorVerkey] = await indy.createAndStoreMyDid(walletHandle, "{}")
    logValue('Trust anchor DID: ', trustAnchorDid)
    logValue('Trust anchor Verkey: ', trustAnchorVerkey)

    // 7.
    log('7. Building NYM request to add Trust Anchor to the ledger')
    const nymRequest = await indy.buildNymRequest(/*submitter_did*/ stewardDid,
        /*target_did*/ trustAnchorDid,
        /*ver_key*/ trustAnchorVerkey,
        /*alias*/ undefined,
        /*role*/ 'TRUST_ANCHOR')

    // 8.
    log('8. Sending NYM request to the ledger')
    await indy.signAndSubmitRequest(/*pool_handle*/ poolHandle,
        /*wallet_handle*/ walletHandle,
        /*submitter_did*/ stewardDid,
        /*request_json*/ nymRequest)

    // Here we are creating a third DID. This one is never written to the ledger, but we do have to have it in the
    // wallet, because every request to the ledger has to be signed by some requester. By creating a DID here, we
    // are forcing the wallet to allocate a keypair and identity that we can use to sign the request that's going
    // to read the trust anchor's info from the ledger.

    // 9.
    log('9. Generating and storing DID and verkey representing a Client that wants to obtain Trust Anchor Verkey')
    const [clientDid, clientVerkey] = await indy.createAndStoreMyDid(walletHandle, "{}")
    logValue('Client DID: ', clientDid)
    logValue('Client Verkey: ', clientVerkey)

    // 10.
    log('10. Building the GET_NYM request to query trust anchor verkey')
    const getNymRequest = await indy.buildGetNymRequest(/*submitter_did*/ clientDid,
        /*target_did*/ trustAnchorDid)

    // 11.
    log('11. Sending the Get NYM request to the ledger')
    const getNymResponse = await indy.submitRequest(/*pool_handle*/ poolHandle,
        /*request_json*/ getNymRequest)

    // See whether we received the same info that we wrote the ledger in step 4.

    // 12.
    log('12. Comparing Trust Anchor verkey as written by Steward and as retrieved in GET_NYM response submitted by Client')
    logValue('Written by Steward: ', trustAnchorVerkey)
    const verkeyFromLedger = JSON.parse(getNymResponse['result']['data'])['verkey']
    logValue('Queried from ledger: ', verkeyFromLedger)
    logValue('Matching: ', verkeyFromLedger == trustAnchorVerkey)

    // Do some cleanup.

    // 13.
    log('13. Closing wallet and pool')
    await indy.closeWallet(walletHandle)
    await indy.closePoolLedger(poolHandle)

    // 14.
    log('14. Deleting created wallet')
    await indy.deleteWallet(walletName, walletCredentials)

    // 15.
    log('15. Deleting pool ledger config')
    await indy.deletePoolLedgerConfig(poolName)

}


try {
    run()
} catch (e) {
    log("ERROR occurred : e")
}
