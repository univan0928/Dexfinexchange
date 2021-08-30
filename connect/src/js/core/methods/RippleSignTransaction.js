/* @flow */
'use strict';

import AbstractMethod from './AbstractMethod';
import { validateParams } from './helpers/paramsValidator';
import { validatePath } from '../../utils/pathUtils';

import type { RippleSignedTx } from '../../types/trezor';
import type { Transaction as $RippleTransaction, RippleSignedTx as RippleSignedTxResponse } from '../../types/ripple';
import type { CoreMessage } from '../../types';

type Params = {
    path: Array<number>,
    transaction: $RippleTransaction,
}

export default class RippleSignTransaction extends AbstractMethod {
    params: Params;

    constructor(message: CoreMessage) {
        super(message);
        this.requiredPermissions = ['read', 'write'];
        this.requiredFirmware = ['0', '2.0.8'];
        this.info = 'Sign Ripple transaction';

        const payload: Object = message.payload;
        // validate incoming parameters
        validateParams(payload, [
            { name: 'path', obligatory: true },
            { name: 'transaction', obligatory: true },
        ]);

        const path = validatePath(payload.path, 5);
        // incoming data should be in ripple-sdk format
        const transaction: $RippleTransaction = payload.transaction;

        validateParams(transaction, [
            { name: 'fee', type: 'string' },
            { name: 'flags', type: 'number' },
            { name: 'sequence', type: 'number' },
            { name: 'maxLedgerVersion', type: 'number' },
            { name: 'payment', type: 'object' },
        ]);

        validateParams(transaction.payment, [
            { name: 'amount', type: 'string', obligatory: true },
            { name: 'destination', type: 'string', obligatory: true },
        ]);

        this.params = {
            path,
            transaction,
        };
    }

    async run(): Promise<RippleSignedTxResponse> {
        const tx: $RippleTransaction = this.params.transaction;
        const response: RippleSignedTx = await this.device.getCommands().rippleSignTx({
            address_n: this.params.path,
            fee: parseInt(tx.fee),
            flags: tx.flags,
            sequence: tx.sequence,
            last_ledger_sequence: tx.maxLedgerVersion,
            payment: {
                amount: parseInt(tx.payment.amount),
                destination: tx.payment.destination,
            },
        });

        return {
            serializedTx: response.serialized_tx,
            signature: response.signature,
        };
    }
}
