import BigInteger from 'bigi'

import { BigNumber } from 'bignumber.js'
import bitcoin from 'bitcoinjs-lib'
import bitcoinMessage from 'bitcoinjs-message'
import { getState } from 'redux/core'
import reducers from 'redux/core/reducers'
import { btc, request, constants, api } from 'helpers'


const login = (privateKey) => {
  let keyPair

  if (privateKey) {
    const hash  = bitcoin.crypto.sha256(privateKey)
    const d     = BigInteger.fromBuffer(hash)

    keyPair     = new bitcoin.ECPair(d, null, { network: btc.network })
  }
  else {
    console.info('Created account Bitcoin ...')
    keyPair     = bitcoin.ECPair.makeRandom({ network: btc.network })
    privateKey  = keyPair.toWIF()
  }

  localStorage.setItem(constants.privateKeyNames.btc, privateKey)

  const account     = new bitcoin.ECPair.fromWIF(privateKey, btc.network) // eslint-disable-line
  const address     = account.getAddress()
  const publicKey   = account.getPublicKeyBuffer().toString('hex')

  const data = {
    account,
    keyPair,
    address,
    privateKey,
    publicKey,
  }

  window.getBtcAddress = () => data.address

  console.info('Logged in with Bitcoin', data)
  reducers.user.setAuthData({ name: 'btcData', data })
}

const getBalance = () => {
  const { user: { btcData: { address } } } = getState()

  return request.get(`${api.getApiServer('bitpay')}/addr/${address}`)
    .then(({ balance, unconfirmedBalance }) => {
      console.log('BTC Balance: ', balance)
      console.log('BTC unconfirmedBalance Balance: ', unconfirmedBalance)
      reducers.user.setBalance({ name: 'btcData', amount: balance, unconfirmedBalance })
      return balance
    }, () => Promise.reject())
}

const fetchBalance = (address) =>
  request.get(`${api.getApiServer('bitpay')}/addr/${address}`)
    .then(({ balance }) => balance)

const fetchTx = (hash) =>
  request.get(`${api.getApiServer('bitpay')}/tx/${hash}`)

const getTransaction = () =>
  new Promise((resolve) => {
    const { user: { btcData: { address } } } = getState()

    const url = `${api.getApiServer('bitpay')}/txs/?address=${address}`

    return request.get(url)
      .then((res) => {
        const transactions = res.txs.map((item) => ({
          type: 'btc',
          hash: item.txid,
          confirmations: item.confirmations,
          value: item.vout.filter(item => item.scriptPubKey.addresses[0] === address)[0].value,
          date: item.time * 1000,
          direction: address === item.vout[0].scriptPubKey.addresses[0] ? 'in' : 'out',
        }))
        resolve(transactions)
      })
      .catch(() => {
        resolve([])
      })
  })

const createScript = (data) => {
  const { secretHash, ownerPublicKey, recipientPublicKey, lockTime } = data

  const script = bitcoin.script.compile([

    bitcoin.opcodes.OP_RIPEMD160,
    Buffer.from(secretHash, 'hex'),
    bitcoin.opcodes.OP_EQUALVERIFY,

    Buffer.from(recipientPublicKey, 'hex'),
    bitcoin.opcodes.OP_EQUAL,
    bitcoin.opcodes.OP_IF,

    Buffer.from(recipientPublicKey, 'hex'),
    bitcoin.opcodes.OP_CHECKSIG,

    bitcoin.opcodes.OP_ELSE,

    bitcoin.script.number.encode(lockTime),
    bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
    bitcoin.opcodes.OP_DROP,
    Buffer.from(ownerPublicKey, 'hex'),
    bitcoin.opcodes.OP_CHECKSIG,

    bitcoin.opcodes.OP_ENDIF,
  ])

  const scriptPubKey  = bitcoin.script.scriptHash.output.encode(bitcoin.crypto.hash160(script))
  const scriptAddress = bitcoin.address.fromOutputScript(scriptPubKey, { network: btc.network })

  return {
    scriptAddress,
  }
}


const send = async (from, to, amount, feeValue = 15000) => {
  const { user: { btcData: { privateKey } } } = getState()
  const keyPair = bitcoin.ECPair.fromWIF(privateKey, btc.network)

  const tx            = new bitcoin.TransactionBuilder(btc.network)
  const unspents      = await fetchUnspents(from)

  const fundValue     = new BigNumber(String(amount)).multipliedBy(1e8).integerValue().toNumber()
  const totalUnspent  = unspents.reduce((summ, { satoshis }) => summ + satoshis, 0)
  const skipValue     = totalUnspent - fundValue - feeValue

  unspents.forEach(({ txid, vout }) => tx.addInput(txid, vout, 0xfffffffe))
  tx.addOutput(to, fundValue)

  if (skipValue > 546) {
    tx.addOutput(from, skipValue)
  }

  tx.inputs.forEach((input, index) => {
    tx.sign(index, keyPair)
  })

  const txRaw = tx.buildIncomplete()

  broadcastTx(txRaw.toHex())

  return txRaw
}


const fetchUnspents = (address) =>
  request.get(`${api.getApiServer('bitpay')}/addr/${address}/utxo`)

const broadcastTx = (txRaw) =>
  request.post(`${api.getApiServer('bitpay')}/tx/send`, {
    body: {
      rawtx: txRaw,
    },
  })

const signMessage = (message, encodedPrivateKey) => {
  const keyPair = bitcoin.ECPair.fromWIF(encodedPrivateKey, [bitcoin.networks.bitcoin, bitcoin.networks.testnet])
  const privateKey = keyPair.d.toBuffer(32)

  const signature = bitcoinMessage.sign(message, privateKey, keyPair.compressed)

  return signature.toString('base64')
}

export default {
  login,
  getBalance,
  getTransaction,
  send,
  fetchUnspents,
  createScript,
  broadcastTx,
  fetchTx,
  fetchBalance,
  signMessage,
}
