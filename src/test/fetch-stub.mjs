//
// Usage:
//   const calls = installFetchStub((call) => {
//     if (call.method === 'POST' && call.url === '/api/v1/auth/request-code') return reply(204);
//     // return undefined for any call you did not expect — the stub then throws
//   });
//   ...
//   uninstallFetchStub();
//
// Every recorded call carries method, url, the raw options, and the parsed
// JSON body when there is one.

export function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError('no body');
      return body;
    },
  };
}

export function installFetchStub(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = {
      method: (options.method || 'GET').toUpperCase(),
      url: String(url),
      options,
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    calls.push(call);
    const res = await handler(call);
    if (res === undefined) {
      throw new Error(`fetch stub: unexpected call ${call.method} ${call.url}`);
    }
    return res;
  };
  return calls;
}

export function uninstallFetchStub() {
  delete globalThis.fetch;
}
