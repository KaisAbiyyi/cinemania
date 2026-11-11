/**
 * Hermetic Fail-Closed Network Guard for CINE-005 Onboarding Verification
 *
 * Ensures that during hermetic test execution, NO outbound HTTP/HTTPS/fetch requests
 * can reach the external internet. Only local loopback connections (localhost, 127.0.0.1, ::1)
 * are permitted on the wire.
 *
 * Any external network attempt (including undici-backed globalThis.fetch, node:http, node:https,
 * or unintercepted calls to api.themoviedb.org) immediately fails closed with [FAIL_CLOSED].
 *
 * Usage:
 *   NODE_OPTIONS="--require ./docs/artifacts/cine-005/hermetic_network_guard.cjs"
 */

const http = require('http');
const https = require('https');

const ALLOWED_LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]'
]);

function isAllowedHost(host) {
  if (!host) return false;
  const cleanHost = host.split(':')[0].toLowerCase();
  return ALLOWED_LOOPBACK_HOSTS.has(cleanHost);
}

function extractHost(args) {
  if (typeof args[0] === 'string' || (args[0] && typeof args[0] === 'object' && args[0] instanceof URL)) {
    try {
      const parsed = new URL(args[0]);
      return parsed.hostname;
    } catch (_) {}
  }
  if (args[0] && typeof args[0] === 'object') {
    return args[0].hostname || args[0].host;
  }
  return null;
}

function installNodeHttpGuard(moduleRef, protocolName) {
  const origRequest = moduleRef.request;
  moduleRef.request = function (...args) {
    const host = extractHost(args);
    if (!isAllowedHost(host)) {
      const failClosedError = new Error(
        `[FAIL_CLOSED] Blocked unauthorized outbound ${protocolName} request to external host: "${host}". External networking is strictly prohibited in hermetic test mode.`
      );
      failClosedError.code = 'ENETUNREACH';

      const EventEmitter = require('events');
      const req = new EventEmitter();
      req.setHeader = () => {};
      req.getHeader = () => {};
      req.removeHeader = () => {};
      req.write = () => {};
      req.end = () => {};
      req.abort = () => {};
      req.destroy = () => {};
      req.setTimeout = () => {};

      process.nextTick(() => {
        req.emit('error', failClosedError);
      });
      return req;
    }
    return origRequest.apply(this, args);
  };

  const origGet = moduleRef.get;
  moduleRef.get = function (...args) {
    const req = moduleRef.request(...args);
    req.end();
    return req;
  };
}

// 1. Install guard on node:http and node:https
installNodeHttpGuard(http, 'HTTP');
installNodeHttpGuard(https, 'HTTPS');

// 2. Install guard on Node.js globalThis.fetch (undici-backed in Node 24)
if (typeof globalThis.fetch === 'function') {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async function (input, init) {
    let urlStr = '';
    if (typeof input === 'string') {
      urlStr = input;
    } else if (input instanceof URL) {
      urlStr = input.href;
    } else if (input && typeof input === 'object' && 'url' in input) {
      urlStr = input.url;
    }

    try {
      const parsed = new URL(urlStr, 'http://localhost');
      if (!isAllowedHost(parsed.hostname)) {
        const fetchError = new Error(
          `[FAIL_CLOSED] Blocked unauthorized outbound fetch to external host: "${parsed.hostname}". External networking is strictly prohibited in hermetic test mode.`
        );
        fetchError.code = 'ENETUNREACH';
        throw fetchError;
      }
    } catch (e) {
      if (e.message && e.message.includes('[FAIL_CLOSED]')) {
        throw e;
      }
    }

    return origFetch.apply(this, arguments);
  };
}

// 3. Ensure synthetic offline TMDB token is set if missing, allowing hardened tmdbApi client to pass through to mock_tmdb
if (!process.env.TMDB_API_RAT || process.env.TMDB_API_RAT.trim() === '') {
  process.env.TMDB_API_RAT = 'synthetic-tmdb-offline-dev-token';
}

console.log('[hermetic_network_guard] Fail-closed network boundary initialized: loopback-only wire policy enforced for http, https, and native fetch.');
