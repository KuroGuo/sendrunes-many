window.env = process.env.BITFRONT_ENV
window.Buffer = require('buffer').Buffer
window.tinySecp256k1 = require('tiny-secp256k1')
window.bitcoinjsLib = require('bitcoinjs-lib')
window.runestoneLib = require('@magiceden-oss/runestone-lib')
window.ECPair = require('ecpair')

if (!Uint8Array.prototype.equals) {
  Uint8Array.prototype.equals = function (other) {
    if (this === other) return true
    if (this.length !== other.length) return false
    for (let i = 0; i < this.length; i++) {
      if (this[i] !== other[i]) return false
    }
    return true
  }
}