interface Window {
  env: string
  tinySecp256k1: any,
  bitcoinjsLib: any,
  runestoneLib: any,

  bitfront: {
    connect: typeof connect
    sendRunesMany: typeof sendRunesMany
  }
}

const tinysecp = window.tinySecp256k1
const btcJSLib = window.bitcoinjsLib
const { encodeRunestone } = window.runestoneLib

tinysecp.then((tinySecp256k1: any) => btcJSLib.initEccLib(tinySecp256k1))

window.bitfront = { connect, sendRunesMany }

let connected: boolean, _isTestnet: boolean

async function sendRunesMany(runeId: string, outputs: [{ toAddress: string, amount: number }], options?: { feeRate: number }): Promise<string> {
  try {
    if (!address) throw new Error('!address')
    if (!_publicKey) throw new Error('!_publicKey')
    console.log('publicKey:', _publicKey)

    const addressType = getBitcoinAddressType(address)

    console.log('addressType:', addressType)

    let payment, network = _isTestnet ? btcJSLib.networks.testnet : btcJSLib.networks.bitcoin

    if (addressType === 'Taproot') {
      payment = btcJSLib.payments.p2tr({ internalPubkey: toXOnly(Buffer.from(_publicKey, 'hex')), network })
    } else if (addressType === 'Native Segwit') {
      payment = btcJSLib.payments.p2wpkh({ pubkey: Buffer.from(_publicKey, 'hex'), network })
    } else if (addressType === 'Legacy') {
      payment = btcJSLib.payments.p2pkh({ pubkey: Buffer.from(_publicKey, 'hex'), network })
    } else if (addressType === 'Nested Segwit') {
      // payment = btcJSLib.payments.p2sh({ pubkey: Buffer.from(_publicKey, 'hex'), network })
      // 注意：p2sh 通常需要 p2wpkh 嵌套
      const p2wpkhPayment = btcJSLib.payments.p2wpkh({ pubkey: Buffer.from(_publicKey, 'hex'), network })
      payment = btcJSLib.payments.p2sh({ redeem: p2wpkhPayment, network })
    }

    const getRawTransactionHex = async (txHash: string): Promise<string> => {
      try {
        const response = await fetch(`https://blockstream.info/${_isTestnet ? 'testnet/' : ''}api/tx/${txHash}/hex`)
        return response.text()
      } catch (error) {
        console.error('Error fetching transaction:', error);
        throw error;
      }
    }

    const runeUtxos: any[] = (await btcProxy('/utxo/runes', {
      address,
      runeid: runeId
    }))
    runeUtxos.forEach((u: any) => {
      delete u.inscriptions
      if (u.txId === undefined) u.txId = u.txid
      if (u.outputIndex === undefined) u.outputIndex = u.vout
      return u
    })
    const psbt = new btcJSLib.Psbt({ network })
    const totalAmount = outputs.map(o => o.amount).reduce((a, b) => a + b)
    let totalInputRunesValue = 0
    for (let i = 0; i < runeUtxos.length; i++) {
      if (totalInputRunesValue >= totalAmount) break
      const utxo = runeUtxos[i]
      if (addressType === 'Taproot') {
        psbt.addInput({
          hash: utxo.txId,
          index: utxo.outputIndex,
          witnessUtxo: { value: utxo.satoshis, script: payment!.output! },
          tapInternalKey: toXOnly(Buffer.from(_publicKey, 'hex'))
        })
      } else {
        const inputData: any = {
          hash: utxo.txId,
          index: utxo.outputIndex,
          witnessUtxo: {
            value: utxo.satoshis,
            script: payment!.output!
            // script: (addressType === 'Nested Segwit' ? payment!.redeem!.output! : payment!.output!) as Buffer
          }
        }
        if (payment?.redeem?.output) inputData.redeemScript = payment.redeem.output
        if (addressType === 'Legacy') inputData.nonWitnessUtxo = Buffer.from(await getRawTransactionHex(utxo.txId), 'hex')
        psbt.addInput(inputData)
      }
      totalInputRunesValue += Number(utxo.runes[0].amount)
      // console.log(totalInputRunesValue, amount)
    }

    if (totalInputRunesValue < totalAmount) throw new Error('Not Enough Runes')

    const [block, tx] = runeId.split(':')
    const edicts = outputs.map((output, i) => ({
      id: {
        block: BigInt(block),
        tx: Number(tx)
      },
      amount: BigInt(output.amount),
      output: 2 + i
    }))
    const edictRunestone = encodeRunestone({ edicts })

    psbt.addOutput({
      script: edictRunestone.encodedRunestone,
      value: 0
    })

    psbt.addOutput({
      address: address, // runes change address
      value: 546
    })

    outputs.forEach(output => psbt.addOutput({
      address: output.toAddress, // runes receiver address
      value: 546
    }))

    // 计算交易大小
    let estimatedSize = psbt.data.inputs.length * 148 + psbt.data.outputs.length * 34 + 10

    // 设置费率（可以根据当前网络情况调整）
    let feeRate = options?.feeRate || 5  // satoshis per byte

    feeRate = Math.max(feeRate - 1, 1)

    // // 根据不同的地址类型调整估算大小
    // if (payment?.redeem?.output || addressType === 'Legacy') {
    //   // P2SH 或 Legacy 地址需要更多空间
    //   estimatedSize += psbt.data.inputs.length * 50
    // } else if (addressType === 'Taproot') {
    //   // Taproot 地址可能需要稍微不同的大小估算
    //   estimatedSize = psbt.data.inputs.length * 160 + psbt.data.outputs.length * 43 + 10
    // } else if (addressType === 'Native Segwit') {
    //   // SegWit 地址通常需要较少的空间
    //   estimatedSize = psbt.data.inputs.length * 102 + psbt.data.outputs.length * 31 + 10
    // }

    let fee = estimatedSize * feeRate + 546 * (outputs.length + 1) + JSON.stringify(edicts.map((edict: any) => ({
      id: {
        block: Number(edict.id.block),
        tx: Number(tx)
      },
      amount: Number(edict.amount),
      output: edict.output
    }))).length * feeRate

    const utxos: any[] = await btcProxy('/utxo/btc', { address })
    // await (await fetch(`https://deai-api-proxy.vercel.app/api/utxo/runes?${isTestnet ? 'network=testnet&' : ''}address=${address}&runeid=${runeId}`)).json()
    // const utxos: any[] = await (await fetch(`https://deai-api-proxy.vercel.app/api/utxo/btc?address=${address}${isTestnet ? '&network=testnet' : ''}`)).json()
    // const totalUtxos = [...runeUtxos, ...utxos]
    // const psbt = new btcJSLib.Psbt({ network })
    let totalInputValue = 0
    for (let i = 0; i < utxos.length; i++) {
      if (totalInputValue >= fee) break
      const utxo = utxos[i]
      if (addressType === 'Taproot') {
        psbt.addInput({
          hash: utxo.txId,
          index: utxo.outputIndex,
          witnessUtxo: { value: utxo.satoshis, script: payment!.output! },
          tapInternalKey: toXOnly(Buffer.from(_publicKey, 'hex'))
        })
      } else {
        const inputData: any = {
          hash: utxo.txId,
          index: utxo.outputIndex,
          witnessUtxo: {
            value: utxo.satoshis,
            script: payment!.output!
            // script: (addressType === 'Nested Segwit' ? payment!.redeem!.output! : payment!.output!) as Buffer
          }
        }
        if (payment?.redeem?.output) inputData.redeemScript = payment.redeem.output
        if (addressType === 'Legacy') inputData.nonWitnessUtxo = Buffer.from(await getRawTransactionHex(utxo.txId), 'hex')
        psbt.addInput(inputData)
      }
      totalInputValue += utxo.satoshis
      // console.log(totalInputValue)
    }

    const change = totalInputValue - fee

    if (change <= 0) throw new Error('Not Enough BTC')

    psbt.addOutput({
      address: address, // change address
      value: change
    })

    const psbtHex = psbt.toHex()

    console.log('psbtHex:', psbtHex)

    const signedPsbtHex = await signPsbt(psbtHex)

    console.log('signedPsbtHex:', signedPsbtHex)

    // const txid = await pushPsbt(signedPsbtHex)

    // console.log('txid:', txid)

    return signedPsbtHex
  } catch (err: any) {
    // alert(err.message)
    throw err
  }
}

async function signPsbt(psbtHex: string, options: any = {}) {
  try {
    if (walletType === 'okx' && options.autoFinalized === false) {
      const psbt = await btcProxy('/compile', { psbtHex }, true)
      options.toSignInputs = psbt.inputs.filter((i: any) => i.address === address).map((i: any) => ({
        index: i.index,
        publicKey: _publicKey
      }))
    }
    console.log('signPsbt options:', options)
    try {
      return await wallet.signPsbt(psbtHex, options)
    } catch (err: any) {
      if (walletType === 'okx' && options.autoFinalized === false) {
        delete options.toSignInputs
        return await wallet.signPsbt(psbtHex, options)
      } else {
        throw err
      }
    }
  } catch (err: any) {
    // alert(err.message)
    throw err
  }
}

async function btcProxy(api: string, params?: any, isPost?: boolean) {
  if (isPost) {
    if (_isTestnet) {
      params.network = 'testnet'
      if (!params.node) params.node = '1'
    }

    // return (await fetch(`https://deai-api-proxy.vercel.app/api${api}`, {
    //   method: 'POST',
    //   body: JSON.stringify(params)
    // })).json()
    return (
      await fetch(`${window.env === 'development' ? (
        _isTestnet ? 'https://www.miningmachine.xyz' : 'https://www.runesdeai.com'
      ) : ''}/api/deai${api}`, {
        method: 'POST',
        body: JSON.stringify(params)
      })).json()
  } else {
    const query = new URLSearchParams(params)
    if (_isTestnet) {
      query.set('network', 'testnet')
      if (!query.get('node')) query.set('node', '1')
    }
    return (await fetch(`${window.env === 'development' ? (
      _isTestnet ? 'https://www.miningmachine.xyz' : 'https://www.runesdeai.com'
    ) : ''}/api/deai${api}?${query.toString()}`)).json()
  }
}

let walletType: 'unisat' | 'okx'
let wallet: any
let _network: 'testnet' | 'livenet'
let address: string
let _publicKey: string
let _balance: number

async function connect(isTestnet: boolean): Promise<{
  walletType: string,
  network: 'testnet' | 'livenet',
  address: string,
  publicKey: string,
  balance: number
}> {
  try {
    console.log('connect')
    const okx = getOKXWallet(isTestnet)
    const unisat = getUnisatWallet()
    if (okx) {
      walletType = 'okx'
      wallet = okx
      const result = await wallet.connect()
      const network = await wallet.getNetwork?.()
      const balance = await wallet.getBalance()
      console.log('network:', network)
      _network = network
      address = result.address
      let publicKey = result.compressedPublicKey || result.publicKey
      if (getBitcoinAddressType(result.address) === 'Taproot' && publicKey.length === 64) {
        publicKey = `02${publicKey}`
      }
      _publicKey = publicKey
      _balance = balance.total
    } else if (unisat) {
      walletType = 'unisat'
      wallet = unisat
      try {
        var { network } = await wallet.switchChain(isTestnet ? 'BITCOIN_TESTNET' : 'BITCOIN_MAINNET')
      } catch (err: any) {
        throw err
      }
      const addresses = await wallet.requestAccounts()
      // const network = await wallet.getNetwork()
      const balance = await wallet.getBalance()
      console.log('network:', network)
      _network = network
      address = addresses[0]
      _balance = balance.total
      const publicKey = await wallet.getPublicKey()
      _publicKey = publicKey
    } else {
      throw new Error('只支持 UniSat 钱包和 OKX 钱包')
    }
  } catch (err: any) {
    // alert(err.message)
    throw err
  }
  _isTestnet = isTestnet
  if (wallet && !connected) {
    connected = true
    wallet.on('accountsChanged', () => { connect(_isTestnet) })
    wallet.on('networkChanged', (network: string) => {
      console.log('networkChanged:', network)
    })
  }
  return {
    walletType,
    network: _network,
    address,
    publicKey: _publicKey,
    balance: _balance
  }
}

function getWallet(isTestnet: boolean) {
  const okx = getOKXWallet(isTestnet)
  const unisat = getUnisatWallet()
  return okx || unisat
}

function getUnisatWallet() { return (window as any).unisat }

function getOKXWallet(isTestnet: boolean) {
  return isTestnet ?
    ((window as any).okxwallet?.bitcoinTestnet || (window as any).okxwallet?.bitcoin) : (window as any).okxwallet?.bitcoin
}

function getBitcoinAddressType(address: string): 'Legacy' | 'Nested Segwit' | 'Taproot' | 'Native Segwit' | "Unknown" {
  // Mainnet P2PKH: starts with 1, length should be 34
  const MAINNET_P2PKH_REGEX = /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/;
  // Mainnet P2SH: starts with 3, length should be 34
  const MAINNET_P2SH_REGEX = /^3[1-9A-HJ-NP-Za-km-z]{25,34}$/;
  // Mainnet Bech32: starts with bc1, length should be 42 or 62
  const MAINNET_BECH32_REGEX = /^(bc1)[0-9ac-hj-np-z]{39,59}$/;
  // Mainnet Taproot: starts with bc1p, generally length should be 42
  const MAINNET_TAPROOT_REGEX = /^(bc1p)[0-9ac-hj-np-z]{38,59}$/;

  // Testnet P2PKH: starts with m or n, length should be 34
  const TESTNET_P2PKH_REGEX = /^[mn][1-9A-HJ-NP-Za-km-z]{25,34}$/;
  // Testnet P2SH: starts with 2, length should be 34
  const TESTNET_P2SH_REGEX = /^2[1-9A-HJ-NP-Za-km-z]{25,34}$/;
  // Testnet Bech32: starts with tb1, length should be 42 or 62
  const TESTNET_BECH32_REGEX = /^(tb1)[0-9ac-hj-np-z]{39,59}$/;
  // Testnet Taproot: starts with tb1p, generally length should be 42
  const TESTNET_TAPROOT_REGEX = /^(tb1p)[0-9ac-hj-np-z]{38,59}$/;

  if (MAINNET_P2PKH_REGEX.test(address)) {
    return 'Legacy';
  } else if (MAINNET_P2SH_REGEX.test(address)) {
    return 'Nested Segwit';
  } else if (MAINNET_TAPROOT_REGEX.test(address)) {
    return 'Taproot';
  } else if (MAINNET_BECH32_REGEX.test(address)) {
    return 'Native Segwit';
  } else if (TESTNET_P2PKH_REGEX.test(address)) {
    return 'Legacy';
  } else if (TESTNET_P2SH_REGEX.test(address)) {
    return 'Nested Segwit';
  } else if (TESTNET_TAPROOT_REGEX.test(address)) {
    return 'Taproot';
  } else if (TESTNET_BECH32_REGEX.test(address)) {
    return 'Native Segwit';
  } else {
    return "Unknown";
  }
}

function toXOnly(pubKey: Buffer) {
  return pubKey.length === 32 ? pubKey : pubKey.slice(1, 33)
}