/* @flow */
'use strict';

import AbstractMethod from './AbstractMethod';
import { validateParams } from './helpers/paramsValidator';
import { getCoinInfoByCurrency } from '../../data/CoinInfo';
import { getLabel } from '../../utils/pathUtils';
import { NO_COIN_INFO } from '../../constants/errors';

import type { Success } from '../../types/trezor';
import type { CoinInfo } from 'flowtype';
import type { CoreMessage } from '../../types';

type Params = {
    address: string,
    signature: string,
    message: string,
    coinInfo: CoinInfo,
}

export default class VerifyMessage extends AbstractMethod {
    params: Params;

    constructor(message: CoreMessage) {
        super(message);

        this.requiredPermissions = ['read', 'write'];
        this.info = 'Verify message';

        const payload: Object = message.payload;

        // validate incoming parameters for each batch
        validateParams(payload, [
            { name: 'address', type: 'string', obligatory: true },
            { name: 'signature', type: 'string', obligatory: true },
            { name: 'message', type: 'string', obligatory: true },
            { name: 'coin', type: 'string', obligatory: true },
        ]);

        const coinInfo: ?CoinInfo = getCoinInfoByCurrency(payload.coin);
        if (!coinInfo) {
            throw NO_COIN_INFO;
        } else {
            // check required firmware with coinInfo support
            this.requiredFirmware = [ coinInfo.support.trezor1, coinInfo.support.trezor2 ];
            this.info = getLabel('Verify #NETWORK message', coinInfo);
        }
        // TODO: check if message is already a hex
        const messageHex: string = Buffer.from(payload.message, 'utf8').toString('hex');
        const signatureHex: string = Buffer.from(payload.signature, 'base64').toString('hex');

        this.params = {
            address: payload.address,
            signature: signatureHex,
            message: messageHex,
            coinInfo,
        };
    }

    async run(): Promise<Success> {
        return await this.device.getCommands().verifyMessage(
            this.params.address,
            this.params.signature,
            this.params.message,
            this.params.coinInfo.name
        );
    }
}
