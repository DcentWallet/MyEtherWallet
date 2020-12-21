import DcentWebConnector from 'dcent-web-connector';
import { DCENTWALLET as dcentType } from '../../bip44/walletTypes';
import bip44Paths from '../../bip44';
import HDWalletInterface from '@/wallets/HDWalletInterface';
import { Transaction } from 'ethereumjs-tx';
import {
  getSignTransactionObject,
  getHexTxObject,
  getBufferFromHex,
  calculateChainIdFromV
} from '../../utils';
import { Toast } from '@/helpers';
import errorHandler from './errorHandler';
import store from '@/store';
import commonGenerator from '@/helpers/commonGenerator';
import Vue from 'vue';
import { getCoinType, getFullPath, isHardenedPath } from './util';
import HDKey from 'hdkey';

const NEED_PASSWORD = false;
class DcentWallet {
  constructor() {
    this.identifier = dcentType;
    this.isHardware = true;
    this.needPassword = NEED_PASSWORD;
    this.supportedPaths = bip44Paths[dcentType];
  }
  async init(basePath) {
    basePath = basePath ? basePath : this.supportedPaths[0].path;
    if (!isHardenedPath(basePath)) {
      const result = await DcentWebConnector.getXPUB(basePath);
      const xpub = result.body.parameter.public_key;
      /** @type {HDKey} */
      this.hdkey = HDKey.fromExtendedKey(xpub);
    }
    this.basePath = basePath;
  }
  /**
   * Get the idx th account through path.
   * @param {*} idx
   */
  async getAccount(idx) {
    const fullPath = getFullPath(this.basePath, idx);
    /** @param {Transaction} tx */
    const txSigner = async tx => {
      tx = new Transaction(tx, {
        common: commonGenerator(store.state.main.network)
      });
      const networkId = tx.getChainId();
      const options = {
        path: fullPath,
        transaction: getHexTxObject(tx)
      };
      //dcent-web-connector throws an error when nonce is an empty string.
      if (options.transaction.nonce.trim() === '')
        options.transaction.nonce = '0x0';
      const result = await DcentWebConnector.getEthereumSignedTransaction(
        getCoinType(options.path),
        options.transaction.nonce,
        options.transaction.gasPrice,
        options.transaction.gasLimit,
        options.transaction.to,
        options.transaction.value,
        options.transaction.data,
        options.path,
        options.transaction.chainId
      );
      tx.v = getBufferFromHex(result.body.parameter.sign_v);
      tx.r = getBufferFromHex(result.body.parameter.sign_r);
      tx.s = getBufferFromHex(result.body.parameter.sign_s);
      const signedChainId = calculateChainIdFromV(tx.v);
      if (signedChainId !== networkId)
        throw new Error(
          Vue.$i18n.t('errorsGlobal.invalid-network-id-sig', {
            got: signedChainId,
            expected: networkId
          }),
          'InvalidNetworkId'
        );
      return getSignTransactionObject(tx);
    };
    const msgSigner = async msg => {
      const result = await DcentWebConnector.getSignedMessage(
        getCoinType(this.basePath),
        fullPath,
        msg
      );
      return getBufferFromHex(result.body.parameter.sign);
    };
    const displayAddress = async () => {
      Toast.responseHandler(
        Vue.$i18n.t('dcentError.not-support-display-address'),
        Toast.WARN
      );
    };
    let pubkey;
    if (!isHardenedPath(this.basePath)) {
      const derivedKey = this.hdkey.derive(`m/${idx}`);
      pubkey = derivedKey.publicKey;
    } else {
      try {
        pubkey = (
          await DcentWebConnector.getAddress(
            getCoinType(this.basePath),
            fullPath
          )
        ).body.parameter.address;
      } catch (err) {
        throw new Error(err.body.error.message);
      }
    }
    return new HDWalletInterface(
      fullPath,
      pubkey,
      this.isHardware,
      this.identifier,
      errorHandler,
      txSigner,
      msgSigner,
      displayAddress
    );
  }
  getCurrentPath() {
    return this.basePath;
  }
  getSupportedPaths() {
    return this.supportedPaths;
  }
}
const createWallet = async basePath => {
  const _dcentWallet = new DcentWallet();
  await _dcentWallet.init(basePath);
  return _dcentWallet;
};
createWallet.errorHandler = errorHandler;

export default createWallet;