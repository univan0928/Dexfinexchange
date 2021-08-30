/* @flow */
/* eslint  no-undef: 0 */

let currentSuite: string = '';

export const settings = {
    configSrc: 'base/src/__tests__/config.json', // constant
    debug: __karma__.config.printDebug === 'true',
    origin: 'localhost',
    priority: 0,
    trustedHost: true,
    connectSrc: '',
    iframeSrc: 'iframe.html',
    popup: false,
    popupSrc: 'popup.html',
    webusbSrc: 'webusb.html',
    transportReconnect: false,
    webusb: true,
    pendingTransportEvent: true,
    supportedBrowser: true,
    extension: null,
    // excludedDevices: ['emulator21325']
};

export const httpPost = (url: string, data ?: any): Promise<any> => {
    return new Promise((resolve, reject) => {
        const xhr: XMLHttpRequest = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.response);
            } else {
                reject({
                    status: xhr.status,
                    statusText: xhr.statusText,
                    response: xhr.response,
                    url,
                });
            }
        };

        xhr.onerror = () => {
            reject({
                status: xhr.status,
                statusText: xhr.statusText,
                response: xhr.response,
                url,
            });
        };

        xhr.send(data);
    });
};

export const testReporter: Reporter = {
    suiteStarted(result) {
        console.log(`Test: ${result.description}`);
        currentSuite = result.description;
    },
    specStarted(result) {
        console.log(`- Running ${result.description} ...`);
    },
    specDone(result) {
        TestResults.incrementTotalSpecs();

        if (result.status === 'passed') {
            TestResults.incrementPassedSpecs();
        } else if (result.status === 'failed') {
            TestResults.incrementFailedSpecs();
            TestResults.addFailedSpecResult(currentSuite, result.description);
        }
        console.log(`\t ${result.status.toUpperCase()}`);
    },
    jasmineDone() {
        TestResults.show();
    },
};

class FailedSpecResult {
    suiteName: string;
    specDescription: string;

    constructor(suiteName: string, specDescription: string) {
        this.suiteName = suiteName;
        this.specDescription = specDescription;
    }
}

class TestResults {
    static _failedSpecResults: Array<FailedSpecResult> = [];

    static _totalSpecs = 0;
    static _failedSpecs = 0;
    static _passedSpecs = 0;

    static addFailedSpecResult(suiteName: string, specDescription: string) {
        const failedSpecResult = new FailedSpecResult(suiteName, specDescription);
        this._failedSpecResults.push(failedSpecResult);
    }

    static show() {
        const delimiterLength = 100;
        const delimiterEq = '='.repeat(delimiterLength);
        const delimiterLine = '¯'.repeat(delimiterLength);

        console.log(delimiterEq);

        console.log(`Total: ${this._totalSpecs}`);
        console.log(`- Failed: ${this._failedSpecs}`);
        console.log(`- Passed: ${this._passedSpecs}`);
        console.log(delimiterLine);

        if (this._failedSpecResults.length > 0) {
            console.log('FOLLOWING TESTS FAILED');
            this._failedSpecResults.forEach(failedSpecResult => {
                const desc = `${failedSpecResult.suiteName} ${failedSpecResult.specDescription}`.padEnd(80, '.');
                console.log(`${desc}FAILED`);
            });
        } else {
            console.log('ALL TESTS PASSED');
        }

        console.log(delimiterEq);
    }

    static incrementTotalSpecs() {
        this._totalSpecs += 1;
    }

    static incrementFailedSpecs() {
        this._failedSpecs += 1;
    }

    static incrementPassedSpecs() {
        this._passedSpecs += 1;
    }
}
