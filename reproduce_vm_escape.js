
import vm from 'node:vm';

const logs = [];
const sandbox = {
    params: {},
    fetch: globalThis.fetch,
    JSON,
    Math,
    Date,
    URL,
    URLSearchParams,
    console: {
      log: (...args) => {
        logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      },
    },
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    crypto: { randomUUID: () => globalThis.crypto.randomUUID() },
    encodeURIComponent,
    decodeURIComponent,
    AbortController,
    Headers,
    structuredClone,
    __result: undefined,
};

const toolCode = `
const process = this.constructor.constructor('return process')();
return process.version;
`;

const wrappedCode = `
(async () => {
  ${toolCode}
})().then(r => { __result = typeof r === 'string' ? r : JSON.stringify(r); })
   .catch(e => { __result = 'Error: ' + (e.message || String(e)); });
`;

const context = vm.createContext(sandbox);
const script = new vm.Script(wrappedCode);
script.runInContext(context);

// Wait a bit for the async IIFE
setTimeout(() => {
    console.log('Result:', sandbox.__result);
}, 100);
