/* @flow */
/* eslint  no-undef: 0 */

import 'babel-polyfill';
import { testFunctions } from './index.js';
import { Core, init as initCore, initTransport } from '../../js/core/Core.js';
import { checkBrowser } from '../../js/utils/browser';
import { settings, testReporter } from './common.js';
import { CoreEventHandler } from './CoreEventHandler.js';

import type {
    TestPayload,
    ExpectedResponse,
    TestFunction,
} from 'flowtype/tests';

let core: Core;

// Functions
const startTestingPayloads = (testPayloads: Array<TestPayload>, expectedResponses: Array<ExpectedResponse>, specNames: Array<string>, isTestingPassphrase: boolean) => {
    if (isTestingPassphrase) {
        it('passphrase', async (done) => {
            const handler = new CoreEventHandler(core, expect, done);
            const shouldWaitForLastResponse = true;
            handler.setPayloads(testPayloads, expectedResponses, shouldWaitForLastResponse);

            handler.startListening();
            await initTransport(settings);
        });
    } else {
        for (let i = 0; i < testPayloads.length; i++) {
            const payload = testPayloads[i];
            const expectedResponse = expectedResponses[i];
            const specName = specNames[i];

            it(specName, async (done) => {
                const handler = new CoreEventHandler(core, expect, done);
                const shouldWaitForLastResponse = false;
                handler.setPayloads(payload, expectedResponse, shouldWaitForLastResponse);

                handler.startListening();
                await initTransport(settings);
            });
        }
    }
};

const runTest = (test: TestFunction, subtestNames: Array<string>) => {
    const { testName } = test;
    const hasSubtests = !!test.subtests;
    const isTestingPassphrase = testName === 'passphrase';

    describe(testName, () => {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 500000;

        beforeEach(async (done) => {
            core = await initCore(settings);
            checkBrowser();
            done();
        });
        afterEach(() => {
            // Deinitialize existing core
            core.onBeforeUnload();
        });

        if (!hasSubtests) {
            const { testPayloads, expectedResponses } = test;

            if (!testPayloads) {
                throw new Error('Test is missing test payloads but doesn\'t have any subtests');
            }

            if (!expectedResponses) {
                throw new Error('Test is missing expected responses but doesn\'t have any subtests');
            }
            const specNames = testPayloads.map(p => p.method);

            startTestingPayloads(testPayloads, expectedResponses, specNames, isTestingPassphrase);
        } else {
            if (!test.subtests) {
                throw new Error('Test is missing subtests but hasSubtest is true');
            }

            const subtestNamesFiltered: Array<string> = subtestNames.length > 0 ? subtestNames : Object.keys(test.subtests);
            subtestNamesFiltered.forEach(name => {
                // $FlowIssue is being handled above - if test.subtests is void throw error
                const { testPayloads, expectedResponses, specName } = test.subtests[name]();
                const specNames: Array<string> = testPayloads.map(p => specName);

                startTestingPayloads(testPayloads, expectedResponses, specNames, isTestingPassphrase);
            });

            // if (subtestNames.length > 0) {
            //     // Subtests were specified by the user
            //     subtestNames.forEach(subtestName => {

            //         const { testPayloads, expectedResponses, specName } = test.subtests[subtestName]();
            //         const specNames: Array<string> = testPayloads.map(p => specName);

            //         startTestingPayloads(testPayloads, expectedResponses, specNames);
            //     });
            // } else {
            //     // No subtests were specified but the test has subtests - run them all
            //     for (const k in test.subtests) {
            //         const { testPayloads, expectedResponses, specName } = test.subtests[k]();
            //         const specNames: Array<string> = testPayloads.map(p => specName);

            //         startTestingPayloads(testPayloads, expectedResponses, specNames);
            //     }
            // }
        }
    });
};
// Functions: END

jasmine.getEnv().addReporter(testReporter);
// 'ethereumSignTransaction/noData ethereumSignTransaction/data ethereumSignTransaction/dataEip155 getPublicKey'
const tests: string = __karma__.config.tests.trim();
// [ethereumSignTransaction/noData, ethereumSignTransaction/data, ethereumSignTransaction/dataEip155, getPublicKey]
const testsArr = tests.split(' ');

// config: {
//      'testName1': ['subtestName1', 'subtestName2'],
//      'testName2': [],
// }
const config = {};
testsArr.forEach(testItem => {
    const splitted = testItem.split('/');

    const testName = splitted[0];
    let subtestName = '';
    if (splitted.length === 2) {
        subtestName = splitted[1];
    }

    if (config[testName]) {
        if (subtestName !== '') {
            config[testName].push(subtestName);
        }
    } else {
        if (subtestName !== '') {
            config[testName] = [subtestName];
        } else {
            config[testName] = [];
        }
    }
});

// Iterate through the config object and run each test
for (const testName in config) {
    const subtestNames: Array<string> = config[testName];

    const test: TestFunction = testFunctions[testName]();
    runTest(test, subtestNames);
}
