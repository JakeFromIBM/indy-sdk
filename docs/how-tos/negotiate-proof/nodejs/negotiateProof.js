"use strict"
/*
 * Example demonstrating how to do the key rotation on the ledger.
 *
 * Steward already exists on the ledger and its DID/Verkey are obtained using seed.
 * Trust Anchor's DID/Verkey pair is generated and stored into wallet.
 * Stewards builds NYM request in order to add Trust Anchor to the ledger.
 * Once NYM transaction is done, Trust Anchor wants to change its Verkey.
 * First, temporary key is created in the wallet.
 * Second, Trust Anchor builds NYM request to replace the Verkey on the ledger.
 * Third, when NYM transaction succeeds, Trust Anchor makes new Verkey permanent in wallet
 * (it was only temporary before).
 *
 * To assert the changes, Trust Anchor reads both the Verkey from the wallet and the Verkey from the ledger
 * using GET_NYM request, to make sure they are equal to the new Verkey, not the original one
 * added by Steward
 */

const indy = require('indy-sdk')
const util = require('../indy-sdk/docs/how-tos/write-did-and-query-verkey/nodejs/util')
const colors = require('../indy-sdk/docs/how-tos/write-did-and-query-verkey/nodejs/colors')


const log = console.log

function logValue() {
    log(colors.CYAN, ...arguments, colors.NONE)
}

async function run() {


    const proverDid = 'VsKV7grR1BUE29mG2Fm2kX'

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
    } catch {
        await indy.deletePoolLedgerConfig(poolName)
        await indy.createPoolLedgerConfig(poolName, poolConfig)
    }


    // 2.
    log('2. Open pool ledger and get handle from libindy')
    const poolHandle = await indy.openPoolLedger(poolName)

    // 3.
    log("3. Creates Issuer wallet and opens it to get handle.")
    const issuerWalletName = { "id": "issuerWallet" }
    const issuerWalletCredentials = { "key": "issuerWalletKey" }
    try {
        await indy.createWallet(issuerWalletName, issuerWalletCredentials)
    } catch {
        await indy.deleteWallet(issuerWalletName, issuerWalletCredentials)
        await indy.createWallet(issuerWalletName, issuerWalletCredentials)
    }

    const issuerWalletHandle = await indy.openWallet(issuerWalletName, issuerWalletCredentials)

    // 4.
    log("4. Creates Prover wallet and opens it to get handle.")
    const proverWalletName = { "id": "proverWallet" }
    const proverWalletCredentials = { "key": "proverWalletKey" }
    try {
        await indy.createWallet(proverWalletName, proverWalletCredentials)
    } catch {
        await indy.deleteWallet(proverWalletName, proverWalletCredentials)
        await indy.createWallet(proverWalletName, proverWalletCredentials)
    }

    const proverWalletHandle = await indy.openWallet(proverWalletName, proverWalletCredentials)



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
    const didInfo = { 'seed': stewardSeed }
    const [stewardDid, stewardVerkey] = await indy.createAndStoreMyDid(issuerWalletHandle, didInfo)
    logValue('Steward DID: ', stewardDid)
    logValue('Steward Verkey: ', stewardVerkey)

    // Now, create a new DID and verkey for a trust anchor, and store it in our wallet as well. Don't use a seed;
    // this DID and its keys are secure and random. Again, we're not writing to the ledger yet.

    // 6.
    log('6. Generating and storing Issuer DID and verkey')
    const [issuerDid, issuerVerkey] = await indy.createAndStoreMyDid(issuerWalletHandle, {})
    logValue('Issuer DID: ', issuerDid)
    logValue('Issuer Verkey: ', issuerVerkey)

    // 7.
    log('7. Building NYM request to add Trust Anchor to the ledger')
    const nymRequest = await indy.buildNymRequest(/*submitterDid*/ stewardDid,
        /*targetDid*/ issuerDid,
        /*verKey*/ issuerVerkey,
        /*alias*/ undefined,
        /*role*/ 'TRUST_ANCHOR')
    logValue('NYM txn request', nymRequest)

    // 8.
    log('8. Sending NYM request to the ledger')
    const nymResponse = await indy.signAndSubmitRequest(/*poolHandle*/ poolHandle,
        /*walletHandle*/ issuerWalletHandle,
        /*submitterDid*/ stewardDid,
        /*requestJson*/ nymRequest)
    logValue('NYM txn response', nymResponse)

    // 9.
    log('9. Issuer create Credential Schema')
    const schema = {
        'name': 'gvt',
        'version': '1.0',
        'attributes': ['age', 'sex', 'height', 'name']
    }

    const [issuerSchemaId, issuerSchemaJson] = await indy.issuerCreateSchema(stewardDid,
        schema['name'],
        schema['version'],
        schema['attributes'])
    logValue('Schema ID: ', issuerSchemaId)
    logValue('Schema: ', issuerSchemaJson)

    // 10.
    log('9. Build the SCHEMA request to add new schema to the ledger as a Steward')
    const schemaRequest = await indy.buildSchemaRequest(stewardDid, issuerSchemaJson)
    logValue('Schema Request: ', schemaRequest)

    // 11.
    log('10. Sending the SCHEMA request to the ledger')
    const schemaResponse = await indy.signAndSubmitRequest(poolHandle, issuerWalletHandle, stewardDid, schemaRequest)
    logValue('Schema Response: ', schemaResponse)

    // 12.
    log('12. Creating and storing CRED DEFINITION using anoncreds as Trust Anchor, for the given Schema')
    const credDefTag = 'credDefTag'
    const credDefType = 'CL'
    const credDefConfig = { "supportRevocation": false }

    const [credDefId, credDefJson] = await indy.issuerCreateAndStoreCredentialDef(issuerWalletHandle, issuerDid, issuerSchemaJson,
        credDefTag, credDefType, credDefConfig)
    logValue('Cred Def ID: ', credDefId)
    logValue('Credential definition: ', credDefJson)


    // 14.
    log('14. Prover is creating Link Secret')
    const proverLinkSecretName = 'linkSecret'
    const linkSecretId = await indy.proverCreateMasterSecret(proverWalletHandle,
        proverLinkSecretName)

    // 15.
    log('15. Issuer (Trust Anchor) is creating a Credential Offer for Prover')
    const credOfferJson = await indy.issuerCreateCredentialOffer(issuerWalletHandle,
        credDefId)
    logValue('Credential Offer: ', credOfferJson)

    // 16.
    log('16. Prover creates Credential Request for the given credential offer')
    const [credReqJson, credReqMetadataJson] = await indy.proverCreateCredentialReq(proverWalletHandle,
        proverDid,
        credOfferJson,
        credDefJson,
        proverLinkSecretName)
    logValue('Credential Request: ', credReqJson)

    // 17.
    log('17. Issuer (Trust Anchor) creates Credential for Credential Request')
    const credValuesJson = {
        "sex": { "raw": "male", "encoded": "5944657099558967239210949258394887428692050081607692519917050011144233" },
        "name": { "raw": "Alex", "encoded": "1139481716457488690172217916278103335" },
        "height": { "raw": "175", "encoded": "175" },
        "age": { "raw": "28", "encoded": "28" }
    }
    const tailsWriterConfig = { 'base_dir': util.getPathToIndyClientHome() + "/tails", 'uri_pattern': '' }
    const blobStorageReaderHandle = await indy.openBlobStorageReader('default', tailsWriterConfig)

    const [credJson] = await indy.issuerCreateCredential(issuerWalletHandle,
        credOfferJson,
        credReqJson,
        credValuesJson, undefined, blobStorageReaderHandle)
    logValue('Credential: ', credJson)

    // 18.
    log('18. Prover processes and stores received Credential')
    const outCredId = await indy.proverStoreCredential(proverWalletHandle, null,
        credReqMetadataJson,
        credJson,
        credDefJson, null)
    logValue('Store Credential is {}', outCredId)

    // 19.
    log("19. Prover gets Credentials for Proof Request")
    const proofRequest = {
        'nonce': '123432421212',
        'name': 'proof_req_1',
        'version': '0.1',
        'requested_attributes': {
            'attr1_referent': {
                'name': 'name',
                'restrictions': [{
                    'cred_def_id': credDefId
                    /*
                    'issuer_did': issuerDid,
                    'schema_key': schemaKey
                    */
                }]
            }
        },
        'requested_predicates': {
            'predicate1_referent': {
                'name': 'age',
                'p_type': '>=',
                'p_value': 18,
                'restrictions': [{ 'issuer_did': issuerDid }]
            }
        }
    }
    const credsForProofRequest = await indy.proverGetCredentialsForProofReq(proverWalletHandle, proofRequest)

    // 20. 
    log("20. Prover creates Proof for Proof Request")
    const credForAttr1 = credsForProofRequest["attrs"]["attr1_referent"]
    const referent = credForAttr1[0].cred_info.referent
    const requestedCredentials = {
        "self_attested_attributes": {},
        "requested_attributes": {
            "attr1_referent": {
                cred_id: referent,
                revealed: true
            }
        },
        "requested_predicates": {
            "predicate1_referent": {
                cred_id: referent
            }
        }
    }
    const schemas = {
        [issuerSchemaId]: issuerSchemaJson
    }
    const credentialDefs = {
        [credDefId]: credDefJson
    }
    const revocRegs = {}
    const revRegs = {}
    const proof = await indy.proverCreateProof(proverWalletHandle, proofRequest, requestedCredentials, proverLinkSecretName, schemas, credentialDefs, revocRegs)
    logValue("Proof after request: ", proof)

    // 21.
    log("21. Verifier is verifying proof from Prover")
    const verified = await indy.verifierVerifyProof(proofRequest, proof, schemas, credentialDefs, revocRegs, revRegs)

    logValue("Proof :")
    logValue(". Name="+proof['requested_proof']['revealed_attrs']['attr1_referent']['raw'])
    logValue(". Verified="+verified)


    // 22.
    log('22. Closing both walletHandles and pool')
    await indy.closeWallet(issuerWalletHandle)
    await indy.closeWallet(proverWalletHandle)
    await indy.closePoolLedger(poolHandle)

    // 23.
    log('23. Deleting created walletHandles')
    await indy.deleteWallet(issuerWalletName, issuerWalletCredentials)
    await indy.deleteWallet(proverWalletName, proverWalletCredentials)

    // 24.
    log('24. Deleting pool ledger config')
    await indy.deletePoolLedgerConfig(poolName)

}


try {
    run()
} catch (e) {
    log("ERROR occurred : e")
}

