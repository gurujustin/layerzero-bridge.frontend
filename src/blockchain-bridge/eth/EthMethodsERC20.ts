import { Contract } from 'web3-eth-contract';
import { getAddress } from '@harmony-js/crypto';
import Web3 from 'web3';
import { mulDecimals } from '../../utils';
import { getGasPrice } from './helpers';

import { abi as ProxyERC20Abi } from '../out/ProxyERC20Abi';
import { abi as ProxyERC721Abi } from '../out/ProxyERC721Abi';
import { networks, getTokenConfig } from '../../configs';
import { NETWORK_TYPE, TOKEN } from 'stores/interfaces';
import BN from 'bn.js';

export interface IEthMethodsInitParams {
  web3: Web3;
  ethManagerContract: Contract;
  ethManagerAddress: string;
  gasPrice?: number;
  gasLimit?: number;

}

export class EthMethodsERC20 {
  private web3: Web3;
  private ethManagerContract: Contract;
  private ethManagerAddress: string;
  gasPrice?: number;
  gasLimit?: number;

  constructor(params: IEthMethodsInitParams) {
    this.web3 = params.web3;
    this.ethManagerContract = params.ethManagerContract;
    this.ethManagerAddress = params.ethManagerAddress;
    this.gasPrice = params.gasPrice;
    this.gasLimit = params.gasLimit;
  }

  approveEthManger = async (
    erc20Address,
    amount,
    decimals,
    sendTxCallback?,
  ) => {
    // @ts-ignore
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });

    if (Number(amount) === 0) {
      sendTxCallback('skip');
      return;
    }

    const MyERC20Json = require('../out/MyERC20');
    const erc20Contract = new this.web3.eth.Contract(
      MyERC20Json.abi,
      erc20Address,
    );

    const USDT_ADDR = '0xdac17f958d2ee523a2206206994597c13d831ec7'.toUpperCase();
    const AAG_ADDR = '0x5ba19d656b65f1684cfea4af428c23b9f3628f97'.toUpperCase();

    if ([AAG_ADDR, USDT_ADDR].includes(erc20Address.toUpperCase())) {
      const allowed = await this.allowance(accounts[0], erc20Address);

      if (
        allowed > 0 &&
        mulDecimals(Number(amount), decimals).cmp(Number(this.allowance)) > 0
      ) {
        // reset to 0
        await erc20Contract.methods
          .approve(getTokenConfig(erc20Address).proxyERC20, 0)
          .send({
            from: accounts[0],
            gas: process.env.ETH_GAS_LIMIT,
            gasPrice: this.gasPrice
              ? this.gasPrice
              : await getGasPrice(this.web3),
          });
      }
    }

    const tokenConfig = getTokenConfig(erc20Address);

    const isArb = tokenConfig.network  === NETWORK_TYPE.ARBITRUM;

    const arbParams = {
      from: accounts[0],
      gas: this.gasLimit,
      gasLimit: this.gasLimit,
      gasPrice: this.gasPrice ? this.gasPrice : await getGasPrice(this.web3),
    }

    await erc20Contract.methods
      .approve(
        getTokenConfig(erc20Address).proxyERC20,
        mulDecimals(amount, decimals),
      )
      .send(isArb ? arbParams : {
        from: accounts[0],
        gas: process.env.ETH_GAS_LIMIT,
        gasPrice: this.gasPrice ? this.gasPrice : await getGasPrice(this.web3),
      })
      .on('transactionHash', hash => sendTxCallback(hash));
  };

  setApprovalForAllEthManger = async (erc20Address, sendTxCallback?) => {
    // @ts-ignore
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });

    const MyERC20Json = require('../out/MyERC721');
    const erc20Contract = new this.web3.eth.Contract(
      MyERC20Json.abi,
      erc20Address,
    );

    const tokenConfig = getTokenConfig(erc20Address);

    let res = await erc20Contract.methods
      .isApprovedForAll(accounts[0], tokenConfig.proxyERC20)
      .call();

    if (!res) {
      await erc20Contract.methods
        .setApprovalForAll(tokenConfig.proxyERC20, true)
        .send({
          from: accounts[0],
          gas: process.env.ETH_GAS_LIMIT,
          gasPrice: await getGasPrice(this.web3),
        })
        .on('transactionHash', hash => sendTxCallback(hash));
    } else {
      sendTxCallback('skip');
    }
  };

  lockTokens = async (erc20Address, userAddr, amount, sendTxCallback?) => {
    // @ts-ignore
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });

    const hmyAddrHex = getAddress(userAddr).checksum;

    // const estimateGas = await this.ethManagerContract.methods
    //   .lockTokens(erc20Address, amount, hmyAddrHex)
    //   .estimateGas({ from: accounts[0] });

    // const gasLimit = Math.max(
    //   // estimateGas + estimateGas * 0.3,
    //   Number(process.env.ETH_GAS_LIMIT),
    // );

    // let transaction = await this.ethManagerContract.methods
    //   .lockTokens(erc20Address, amount, hmyAddrHex)
    //   .send({
    //     from: accounts[0],
    //     gas: new BN(gasLimit),
    //     gasPrice: await getGasPrice(this.web3),
    //   })
    //   .on('transactionHash', hash => sendTxCallback(hash));
    const tokenConfig = getTokenConfig(erc20Address);

    const proxyContract = new this.web3.eth.Contract(
      ProxyERC721Abi as any,
      tokenConfig.proxyERC20,
    );

    // const - 500k gasLimit
    const adapterParams =
      '0x0001000000000000000000000000000000000000000000000000000000000007a120';

    const sendFee = await proxyContract.methods
      .estimateSendFee(
        networks.HARMONY.layerzero.chainId,
        hmyAddrHex, // to user address
        amount,
        false,
        adapterParams,
      )
      .call();

    console.log('Send Fee: ', sendFee);

    const gasLimit = Math.max(500000, Number(process.env.ETH_GAS_LIMIT));

    const res = await proxyContract.methods
      .sendFrom(
        accounts[0], // from user address
        networks.HARMONY.layerzero.chainId,
        hmyAddrHex, // to user address
        amount,
        accounts[0], // refund address
        '0x0000000000000000000000000000000000000000', // const
        adapterParams,
      )
      .send({
        value: sendFee.nativeFee,
        from: accounts[0],
        gas: new BN(gasLimit),
        gasPrice: await getGasPrice(this.web3),
      })
      .on('transactionHash', hash => sendTxCallback(hash));

    return res;
  };

  getFee = async (erc20Address, userAddr, amount, decimals) => {
    const hmyAddrHex = getAddress(userAddr).checksum;

    const proxyContract = new this.web3.eth.Contract(
      ProxyERC20Abi as any,
      getTokenConfig(erc20Address).proxyERC20,
    );

    // const - 500k gasLimit
    const adapterParams =
      '0x0001000000000000000000000000000000000000000000000000000000000007a120';

    const sendFee = await proxyContract.methods
      .estimateSendFee(
        networks.HARMONY.layerzero.chainId,
        hmyAddrHex, // to user address
        mulDecimals(amount, decimals),
        false,
        adapterParams,
      )
      .call();

    return sendFee.nativeFee;
  };

  lockToken = async (
    erc20Address,
    userAddr,
    amount,
    decimals,
    sendTxCallback?,
  ) => {
    // @ts-ignore
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });

    const hmyAddrHex = getAddress(userAddr).checksum;

    // const estimateGas = await this.ethManagerContract.methods
    //   .lockToken(erc20Address, mulDecimals(amount, decimals), hmyAddrHex)
    //   .estimateGas({ from: accounts[0] });

    // const gasLimit = Math.max(
    //   estimateGas + estimateGas * 0.3,
    //   Number(process.env.ETH_GAS_LIMIT),
    // );

    // let transaction = await this.ethManagerContract.methods
    //   .lockToken(erc20Address, mulDecimals(amount, decimals), hmyAddrHex)
    //   .send({
    //     from: accounts[0],
    //     gas: new BN(gasLimit),
    //     gasPrice: this.gasPrice ? this.gasPrice : await getGasPrice(this.web3),
    //   })
    //   .on('transactionHash', hash => sendTxCallback(hash));

    // return transaction.events.Locked;

    const token = getTokenConfig(erc20Address);

    const proxyContract = new this.web3.eth.Contract(
      ProxyERC721Abi as any,
      token.proxyERC20,
    );

    // const - 500k gasLimit
    const adapterParams = token.adapterParams || token.adapterParamsEth ||
      '0x0001000000000000000000000000000000000000000000000000000000000007a120';

    const sendFee = await proxyContract.methods
      .estimateSendFee(
        networks.HARMONY.layerzero.chainId,
        hmyAddrHex, // to user address
        mulDecimals(amount, decimals),
        false,
        adapterParams,
      )
      .call();

    let value;

    switch (token.token) {
      case TOKEN.ETH:
        value = mulDecimals(amount, decimals).add(new BN(sendFee.nativeFee));
        break;

      default:
        value = sendFee.nativeFee;
    }  

    let estimateGas = 0;

    try {
      estimateGas = await proxyContract.methods.sendFrom(
        accounts[0], // from user address
        networks.HARMONY.layerzero.chainId,
        hmyAddrHex, // to user address
        mulDecimals(amount, decimals),
        accounts[0], // refund address
        '0x0000000000000000000000000000000000000000', // const
        adapterParams
      )
        .estimateGas({ 
          value,
          from: accounts[0] 
        });
    } catch(e) {
      console.error(e);
    }

    const gasLimit = Math.max(estimateGas, 500000, Number(process.env.ETH_GAS_LIMIT));

    const res = await proxyContract.methods
      .sendFrom(
        accounts[0], // from user address
        networks.HARMONY.layerzero.chainId,
        hmyAddrHex, // to user address
        mulDecimals(amount, decimals),
        accounts[0], // refund address
        '0x0000000000000000000000000000000000000000', // const
        adapterParams,
      )
      .send({
        value,
        from: accounts[0],
        gas: new BN(gasLimit),
        gasPrice: this.gasPrice ? this.gasPrice : await getGasPrice(this.web3),
      })
      .on('transactionHash', hash => sendTxCallback(hash));

    return res;
  };

  checkEthBalance = async (erc20Address: string, addr: string) => {
    const MyERC20Json = require('../out/MyERC20');
    const erc20Contract = new this.web3.eth.Contract(
      MyERC20Json.abi,
      erc20Address,
    );

    return await erc20Contract.methods.balanceOf(addr).call();
  };

  tokenDetails = async erc20Address => {
    if (!this.web3.utils.isAddress(erc20Address)) {
      throw new Error('Invalid token address');
    }

    const MyERC20Json = require('../out/MyERC20');
    const erc20Contract = new this.web3.eth.Contract(
      MyERC20Json.abi,
      erc20Address,
    );

    const symbol = await erc20Contract.methods.symbol().call();

    let name = symbol;

    try {
      name = await erc20Contract.methods.name().call();
    } catch (e) {
      console.error(e);
    }

    const decimals = await erc20Contract.methods.decimals().call();

    return { name, symbol, decimals, erc20Address };
  };

  tokenDetailsERC721 = async erc20Address => {
    if (!this.web3.utils.isAddress(erc20Address)) {
      throw new Error('Invalid token address');
    }

    const MyERC20Json = require('../out/MyERC721');
    const erc20Contract = new this.web3.eth.Contract(
      MyERC20Json.abi,
      erc20Address,
    );

    if (erc20Address === '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85') {
      return {
        name: 'Ethereum Name Service',
        symbol: 'ENS',
        decimals: '0',
      };
    }

    const name = await erc20Contract.methods.name().call();
    const symbol = await erc20Contract.methods.symbol().call();
    // const decimals = await erc20Contract.methods.decimals().call();

    return { name, symbol, erc20Address };
  };

  allowance = async (addr: string, erc20Address: string) => {
    if (!this.web3.utils.isAddress(erc20Address)) {
      throw new Error('Invalid token address');
    }

    const MyERC20Json = require('../out/MyERC20');

    const erc20Contract = new this.web3.eth.Contract(
      MyERC20Json.abi,
      erc20Address,
    );

    let res;

    try {
      res = await erc20Contract.methods
        .allowance(addr, getTokenConfig(erc20Address).proxyERC20)
        .call();
    } catch (e) {
      console.error(e);
    }

    return res;
  };

  lockNative = async (userAddr, amount, sendTxCallback?) => {
    // @ts-ignore
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });

    const hmyAddrHex = getAddress(userAddr).checksum;

    const managerContract = new this.web3.eth.Contract(
      [
        {
          constant: false,
          inputs: [
            {
              internalType: 'uint256',
              name: 'amount',
              type: 'uint256',
            },
            {
              internalType: 'address',
              name: 'recipient',
              type: 'address',
            },
          ],
          name: 'lockNative',
          outputs: [],
          payable: true,
          stateMutability: 'payable',
          type: 'function',
        },
      ],
      this.ethManagerAddress,
    );

    let response = await managerContract.methods
      .lockNative(mulDecimals(amount, 18), hmyAddrHex)
      .send({
        from: accounts[0],
        gas: process.env.ETH_GAS_LIMIT,
        gasPrice: await getGasPrice(this.web3),
        value: mulDecimals(amount, 18),
      })
      .on('transactionHash', hash => sendTxCallback(hash));

    return response;
  };
}
