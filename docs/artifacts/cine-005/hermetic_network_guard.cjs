/**
 * Hermetic Fail-Closed Network Guard for CINE-005 Onboarding Verification
 *
 * Ensures that during hermetic test execution, no unexpected outbound HTTP/HTTPS
 * requests reach the external internet. Only localhost and intercepted mock domains
 * are permitted.
 *
 * Usage:
 *   NODE_OPTIONS="--require ./docs/artifacts/cine-005/hermetic_network_guard.cjs"
 */

const http = require('http');
const https = require('https');

const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'api.themoviedb.org' // Handled deterministically in-memory by mock_tmdb.cjs
]);

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

function installGuard(moduleRef, protocolName) {
  const origRequest = moduleRef.request;
  moduleRef.request = function (...args) {
    const host = extractHost(args);
    if (host && !ALLOWED_HOSTS.has(host.split(':')[0].toLowerCase())) {
      const failClosedError = new Error(
        `[FAIL_CLOSED] Blocked unauthorized outbound ${protocolName} request to external host: "${host}". External networking is strictly prohibited in hermetic test mode.`
      );
      failClosedError.code = 'ENETUNREACH';

      // Return a dummy client request that immediately emits the fail-closed error
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

installGuard(http, 'HTTP');
installGuard(https, 'HTTPS');

// Ensure synthetic offline TMDB token is set if missing, allowing hardened tmdbApi client to pass through to mock_tmdb
if (!process.env.TMDB_API_RAT || process.env.TMDB_API_RAT.trim() === '') {
  process.env.TMDB_API_RAT = 'synthetic-tmdb-offline-dev-token';
}

console.log('[hermetic_network_guard] Fail-closed network boundary initialized: non-loopback external network calls are blocked.');
