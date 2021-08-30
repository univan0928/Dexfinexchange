/* @flow */
// Ethereum types
// https://github.com/ethereumjs/ethereumjs-tx

import type { $Path, $Common } from './params';
import type { Unsuccessful$ } from './response';
import type {
    Success,
    MessageSignature,
    EthereumSignedTx,
} from './trezor';

export type Transaction = {
    to: string,
    value: string,
    gasPrice: string,
    gasLimit: string,
    nonce: string,
    data?: string,
    chainId?: number,
    txType?: number,
    v: string,
    r: string,
    s: string,
}

// get account info

export type EthereumAccount = {
    address: string,
    block: number,
    transactions: number,
    balance: string,
    nonce: number,
}

export type $EthereumGetAccountInfo = {
    account: EthereumAccount,
    coin: string,
}

export type $$EthereumGetAccountInfo = {
    accounts: Array<EthereumAccount>,
    coin: string,
}

export type EthereumGetAccountInfo$ = {
    success: true,
    payload: EthereumAccount,
} | Unsuccessful$;

export type EthereumGetAccountInfo$$ = {
    success: true,
    payload: Array<EthereumAccount>,
} | Unsuccessful$;

// get address

export type EthereumAddress = {
    address: string,
    path: Array<number>,
    serializedPath: string,
}

export type $EthereumGetAddress = {
    path: $Path,
    showOnTrezor?: boolean,
}

export type EthereumGetAddress$ = {
    success: true,
    payload: EthereumAddress,
} | Unsuccessful$;

export type EthereumGetAddress$$ = {
    success: true,
    payload: Array<EthereumAddress>,
} | Unsuccessful$;

// sign transaction

export type $EthereumSignTransaction = $Common & {
    path: $Path,
    transaction: Transaction,
}

export type EthereumSignTransaction$ = {
    success: true,
    payload: EthereumSignedTx,
} | Unsuccessful$;

// sign message

export type $EthereumSignMessage = $Common & {
    path: $Path,
    message: string,
    hex?: boolean,
};

export type EthereumSignMessage$ = {
    success: true,
    payload: MessageSignature,
} | Unsuccessful$;

// verify message

export type $EthereumVerifyMessage = $Common & {
    address: string,
    message: string,
    hex?: boolean,
    signature: string,
}

export type EthereumVerifyMessage$ = {
    success: true,
    payload: Success,
} | Unsuccessful$;
