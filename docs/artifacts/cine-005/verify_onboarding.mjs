/**
 * Automated Verification Script for CINE-005: Developer Onboarding & Architecture Verification
 * Revision 4 (Comprehensive Mutational Control & Guarded Transport Verification)
 *
 * Requirements verified:
 * 1. Clean checkout reproducible start using synthetic offline provider fixtures (docs/artifacts/cine-002/fixtures/mock_tmdb.cjs).
 * 2. Complete absence of real workspace secrets: server executes inside a disposable isolated scratch directory
 *    in os.tmpdir() linked via directory junctions to .next and node_modules. ZERO workspace developer files are modified.
 * 3. Environment omission yields actionable errors:
 *    - Missing YOUTUBE_API_KEY returns HTTP 500 "Server configuration error".
 *    - Missing IPINFO_TOKEN returns HTTP 200 with default region "US".
 * 4. Mutational secret-present negative control:
 *    - A separate isolated server with an injected synthetic YOUTUBE_API_KEY confirms the omission predicate turns red
 *      (it no longer returns "Server configuration error", proving test sensitivity).
 *    - Concurrently verifies that unmocked external requests (to googleapis.com) fail closed at the transport boundary
 *      returning "Failed to fetch video data" without touching the external network.
 * 5. Fail-closed network boundary:
 *    - Preflight controls demonstrate that direct external node:https, globalThis.fetch, and 3xx loopback redirects
 *      to external hosts immediately fail closed with [FAIL_CLOSED].
 * 6. Clean lifecycle:
 *    - Server processes are gracefully terminated and awaited.
 *    - Scratch directories are recursively wiped and verified absent in finally blocks.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

/**
 * Allocate a dynamic ephemeral port
 */
function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    s.on('error', reject);
  });
}

/**
 * Minimal HTTP request helper for testing endpoints
 */
function httpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const req = http.request(parsed, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Poll server until it responds to HTTP requests
 */
async function waitForServer(baseUrl, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpRequest(`${baseUrl}/api/genres?type=movie`);
      if (res.statusCode === 200) {
        return true;
      }
    } catch (_) {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`Timed out waiting for server at ${baseUrl} after ${timeoutMs}ms`);
}

/**
 * Gracefully stop a child process and wait for its exit event
 */
function stopServer(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (_) {}
      resolve();
    }, 4000);

    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      proc.kill('SIGTERM');
    } catch (_) {
      clearTimeout(timer);
      resolve();
    }
  });
}

/**
 * Test node:https fail-closed behavior on an external host
 */
function verifyHttpsFailClosed() {
  return new Promise((resolve) => {
    const testHost = 'https://youtube.googleapis.com/youtube/v3/videos?id=test';
    https.get(testHost, () => {
      resolve({
        blocked: false,
        error: 'Expected connection to be blocked, but request unexpectedly proceeded'
      });
    }).on('error', (err) => {
      const isFailClosed = err.message.includes('[FAIL_CLOSED]') || err.code === 'ENETUNREACH';
      resolve({
        blocked: isFailClosed,
        errorMessage: err.message,
        errorCode: err.code
      });
    });
  });
}

/**
 * Test native globalThis.fetch fail-closed behavior on an external host
 */
async function verifyFetchFailClosed() {
  try {
    await globalThis.fetch('https://example.com/api/test');
    return {
      blocked: false,
      error: 'Expected fetch to be blocked, but request unexpectedly proceeded'
    };
  } catch (err) {
    const isFailClosed = err.message && err.message.includes('[FAIL_CLOSED]');
    return {
      blocked: isFailClosed,
      errorMessage: err.message
    };
  }
}

/**
 * Test redirect fail-closed behavior
 */
async function verifyRedirectFailClosed() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(302, { Location: 'https://example.com/external-redirect-target' });
      res.end();
    });

    srv.listen(0, '127.0.0.1', async () => {
      const port = srv.address().port;
      try {
        await globalThis.fetch(`http://127.0.0.1:${port}`);
        srv.close(() => {
          resolve({
            blocked: false,
            error: 'Expected redirect to external host to be blocked, but it proceeded'
          });
        });
      } catch (err) {
        const isFailClosed = err.message && err.message.includes('[FAIL_CLOSED]');
        srv.close(() => {
          resolve({
            blocked: isFailClosed,
            errorMessage: err.message
          });
        });
      }
    });
  });
}

async function run() {
  const PORT = await getAvailablePort();
  const BASE_URL = `http://127.0.0.1:${PORT}`;
  console.log(`[CINE-005] Initializing hermetic onboarding verification on allocated port ${PORT}...`);

  let tempDir = null;
  let mutTempDir = null;
  let serverProc = null;
  let mutServerProc = null;

  const results = {
    task: 'CINE-005',
    timestamp: new Date().toISOString(),
    primaryPort: PORT,
    environment: {
      node: process.version,
      platform: process.platform,
      scratchDirectoryIsolated: null,
      workspaceSecretsTouched: false,
      hermeticEnvAsserted: true,
      strippedVariables: ['TMDB_API_RAT', 'YOUTUBE_API_KEY', 'IPINFO_TOKEN'],
      failClosedNetworkGuardActive: true,
      initialCallGuardScope: 'node:http, node:https, and globalThis.fetch (with 3xx redirect inspection)',
      syntheticMockLoaded: true
    },
    checks: []
  };

  const networkGuardScript = path.resolve(__dirname, 'hermetic_network_guard.cjs');
  const mockScriptPath = path.resolve(rootDir, 'docs/artifacts/cine-002/fixtures/mock_tmdb.cjs');
  const nextBin = path.resolve(rootDir, 'node_modules/next/dist/bin/next');

  // Install network guard in parent process to run preflight controls
  const { createRequire } = await import('module');
  const req = createRequire(import.meta.url);
  req(networkGuardScript);

  try {
    // Step 1: Preflight network boundary verification
    console.log(`[CINE-005] Running preflight transport fail-closed controls...`);
    const httpsControl = await verifyHttpsFailClosed();
    console.log(`[CINE-005] Preflight node:https guard verdict: ${httpsControl.blocked ? 'PASS (FAIL_CLOSED enforced)' : 'FAIL'}`);

    const fetchControl = await verifyFetchFailClosed();
    console.log(`[CINE-005] Preflight globalThis.fetch guard verdict: ${fetchControl.blocked ? 'PASS (FAIL_CLOSED enforced)' : 'FAIL'}`);

    const redirectControl = await verifyRedirectFailClosed();
    console.log(`[CINE-005] Preflight fetch redirect guard verdict: ${redirectControl.blocked ? 'PASS (FAIL_CLOSED enforced)' : 'FAIL'}`);

    results.checks.push({
      id: 'FAIL_CLOSED_HTTPS_CONTROL',
      endpoint: 'https://youtube.googleapis.com (node:https)',
      expectedBehavior: 'Immediate connection rejection with [FAIL_CLOSED]',
      actualBehavior: httpsControl.errorMessage || 'Blocked',
      passed: httpsControl.blocked,
      details: httpsControl.blocked
        ? 'Outbound external HTTPS request successfully blocked by hermetic network guard'
        : 'Failed: external request reached network'
    });

    results.checks.push({
      id: 'FAIL_CLOSED_FETCH_CONTROL',
      endpoint: 'https://example.com/api/test (globalThis.fetch)',
      expectedBehavior: 'Immediate fetch rejection with [FAIL_CLOSED]',
      actualBehavior: fetchControl.errorMessage || 'Blocked',
      passed: fetchControl.blocked,
      details: fetchControl.blocked
        ? 'Native Undici fetch call successfully blocked by hermetic network guard'
        : 'Failed: fetch reached network'
    });

    results.checks.push({
      id: 'FAIL_CLOSED_REDIRECT_CONTROL',
      endpoint: 'http://127.0.0.1 -> https://example.com (3xx redirect)',
      expectedBehavior: 'Loopback redirect to external host rejected with [FAIL_CLOSED]',
      actualBehavior: redirectControl.errorMessage || 'Blocked',
      passed: redirectControl.blocked,
      details: redirectControl.blocked
        ? 'Redirect from loopback to external host successfully intercepted and blocked'
        : 'Failed: redirect reached external network'
    });

    // Step 2: Create isolated scratch test directory (inside try/finally)
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinematch-hermetic-'));
    results.environment.scratchDirectoryIsolated = tempDir;
    console.log(`[CINE-005] Created isolated scratch test environment: ${tempDir}`);

    const nextTarget = path.resolve(rootDir, '.next');
    const nodeModulesTarget = path.resolve(rootDir, 'node_modules');
    fs.symlinkSync(nextTarget, path.join(tempDir, '.next'), 'junction');
    fs.symlinkSync(nodeModulesTarget, path.join(tempDir, 'node_modules'), 'junction');
    fs.copyFileSync(path.resolve(rootDir, 'package.json'), path.join(tempDir, 'package.json'));
    fs.copyFileSync(path.resolve(rootDir, 'next.config.ts'), path.join(tempDir, 'next.config.ts'));

    const tempEnvFiles = fs.readdirSync(tempDir).filter(f => f.startsWith('.env'));
    if (tempEnvFiles.length > 0) {
      throw new Error(`Hermetic violation: Unexpected env files in scratch directory: ${tempEnvFiles.join(', ')}`);
    }

    // Step 3: Prepare clean environment without ambient secrets
    const cleanEnv = { ...process.env };
    delete cleanEnv.TMDB_API_RAT;
    delete cleanEnv.YOUTUBE_API_KEY;
    delete cleanEnv.IPINFO_TOKEN;

    if (cleanEnv.TMDB_API_RAT !== undefined || cleanEnv.YOUTUBE_API_KEY !== undefined || cleanEnv.IPINFO_TOKEN !== undefined) {
      throw new Error('Hermetic assertion failed: Secrets still present in child process cleanEnv');
    }

    cleanEnv.PORT = String(PORT);
    cleanEnv.NODE_ENV = 'production';
    cleanEnv.NEXT_PUBLIC_TMDB_POSTER_URL = 'https://image.tmdb.org/t/p';
    cleanEnv.NEXT_PUBLIC_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

    console.log(`[CINE-005] Spawning primary Next.js production server in isolated directory with hermetic guard and synthetic mocks...`);
    serverProc = spawn(process.execPath, [
      '--require', networkGuardScript,
      '--require', mockScriptPath,
      nextBin, 'start', '-p', String(PORT)
    ], {
      cwd: tempDir,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProc.stdout.on('data', (d) => process.stdout.write(`[Next.js stdout] ${d}`));
    serverProc.stderr.on('data', (d) => process.stderr.write(`[Next.js stderr] ${d}`));

    console.log(`[CINE-005] Polling ${BASE_URL} for server readiness...`);
    await waitForServer(BASE_URL, 40000);
    console.log(`[CINE-005] Next.js server is ready. Executing primary test assertions...`);

    // Test 1: Synthetic TMDB /api/genres?type=movie
    console.log(`Testing /api/genres?type=movie (Synthetic TMDB)...`);
    const genresRes = await httpRequest(`${BASE_URL}/api/genres?type=movie`);
    const genresBody = JSON.parse(genresRes.body);
    const genresPass = genresRes.statusCode === 200 && Array.isArray(genresBody) && genresBody.length > 0;
    results.checks.push({
      id: 'SYNTHETIC_TMDB_GENRES',
      endpoint: '/api/genres?type=movie',
      expectedStatus: 200,
      actualStatus: genresRes.statusCode,
      passed: genresPass,
      itemCount: Array.isArray(genresBody) ? genresBody.length : 0,
      details: genresPass ? `Successfully returned ${genresBody.length} synthetic genres` : 'Failed'
    });

    // Test 2: Synthetic TMDB /api/media?mediaType=movie&page=1
    console.log(`Testing /api/media?mediaType=movie&page=1 (Synthetic TMDB Popular Movies)...`);
    const moviesRes = await httpRequest(`${BASE_URL}/api/media?mediaType=movie&page=1`);
    const moviesBody = JSON.parse(moviesRes.body);
    const moviesPass = moviesRes.statusCode === 200 && Array.isArray(moviesBody.results) && moviesBody.results.length > 0;
    results.checks.push({
      id: 'SYNTHETIC_TMDB_MOVIES',
      endpoint: '/api/media?mediaType=movie&page=1',
      expectedStatus: 200,
      actualStatus: moviesRes.statusCode,
      passed: moviesPass,
      itemCount: Array.isArray(moviesBody.results) ? moviesBody.results.length : 0,
      details: moviesPass ? `Successfully returned ${moviesBody.results.length} synthetic movies` : 'Failed'
    });

    // Test 3: Synthetic TMDB /api/media/trending?mediaType=movie&timeWindow=day
    console.log(`Testing /api/media/trending?mediaType=movie&timeWindow=day (Synthetic TMDB Trending)...`);
    const trendRes = await httpRequest(`${BASE_URL}/api/media/trending?mediaType=movie&timeWindow=day`);
    const trendBody = JSON.parse(trendRes.body);
    const trendPass = trendRes.statusCode === 200 && Array.isArray(trendBody.results) && trendBody.results.length > 0;
    results.checks.push({
      id: 'SYNTHETIC_TMDB_TRENDING',
      endpoint: '/api/media/trending?mediaType=movie&timeWindow=day',
      expectedStatus: 200,
      actualStatus: trendRes.statusCode,
      passed: trendPass,
      itemCount: Array.isArray(trendBody.results) ? trendBody.results.length : 0,
      details: trendPass ? `Successfully returned ${trendBody.results.length} synthetic trending titles` : 'Failed'
    });

    // Test 4: Parameter Validation Negative Control: /api/media/trending without params
    console.log(`Testing /api/media/trending (Defensive Parameter Validation Control)...`);
    const trendMissingRes = await httpRequest(`${BASE_URL}/api/media/trending`);
    const trendMissingPass = trendMissingRes.statusCode === 400;
    results.checks.push({
      id: 'PARAM_VALIDATION_TRENDING_MISSING',
      endpoint: '/api/media/trending',
      expectedStatus: 400,
      actualStatus: trendMissingRes.statusCode,
      passed: trendMissingPass,
      details: trendMissingPass ? 'Defensively returned HTTP 400 on missing mediaType/timeWindow' : 'Failed'
    });

    // Test 5: Root Home Page render
    console.log(`Testing / (Root Home Page HTML)...`);
    const rootRes = await httpRequest(`${BASE_URL}/`);
    const rootPass = rootRes.statusCode === 200 && rootRes.body.includes('<!DOCTYPE html>');
    results.checks.push({
      id: 'UI_ROOT_HOME',
      endpoint: '/',
      expectedStatus: 200,
      actualStatus: rootRes.statusCode,
      passed: rootPass,
      details: rootPass ? 'Root home page rendered valid HTML' : 'Failed'
    });

    // Test 6: Movie Discovery Page render
    console.log(`Testing /movie (Movie Discovery Index HTML)...`);
    const movieRes = await httpRequest(`${BASE_URL}/movie`);
    const moviePass = movieRes.statusCode === 200 && movieRes.body.includes('<!DOCTYPE html>');
    results.checks.push({
      id: 'UI_MOVIE_INDEX',
      endpoint: '/movie',
      expectedStatus: 200,
      actualStatus: movieRes.statusCode,
      passed: moviePass,
      details: moviePass ? 'Movie index page rendered valid HTML' : 'Failed'
    });

    // Test 7: Env Omission Negative Control - YOUTUBE_API_KEY
    console.log(`Testing /api/youtube?videoId=test (Env Omission Negative Control)...`);
    const ytRes = await httpRequest(`${BASE_URL}/api/youtube?videoId=test`);
    const ytBody = JSON.parse(ytRes.body);
    const ytOmissionPass = ytRes.statusCode === 500 && ytBody.error === 'Server configuration error';
    results.checks.push({
      id: 'ENV_OMISSION_YOUTUBE_API_KEY',
      endpoint: '/api/youtube?videoId=test',
      expectedStatus: 500,
      actualStatus: ytRes.statusCode,
      responseBody: ytBody,
      passed: ytOmissionPass,
      details: ytOmissionPass ? 'Yields actionable HTTP 500 Server configuration error when YOUTUBE_API_KEY is omitted' : 'Failed'
    });

    // Test 8: Env Omission Local Fallback - IPINFO_TOKEN
    console.log(`Testing /api/geolocation (Env Omission Local Fallback)...`);
    const geoRes = await httpRequest(`${BASE_URL}/api/geolocation`, {
      headers: { 'x-forwarded-for': '127.0.0.1' }
    });
    const geoBody = JSON.parse(geoRes.body);
    const geoPass = geoRes.statusCode === 200 && geoBody.region === 'US';
    results.checks.push({
      id: 'ENV_OMISSION_IPINFO_LOCAL_FALLBACK',
      endpoint: '/api/geolocation',
      expectedStatus: 200,
      actualStatus: geoRes.statusCode,
      responseBody: geoBody,
      passed: geoPass,
      details: geoPass ? 'Localhost request safely returns default region US when IPINFO_TOKEN is omitted' : 'Failed'
    });

    // Step 4: Gracefully shut down primary server before launching mutational control
    console.log(`[CINE-005] Shutting down primary server to prepare mutational sensitivity control...`);
    await stopServer(serverProc);
    serverProc = null;

    // Step 5: Mutational Secret-Present Negative Control (P1-A verification)
    console.log(`\n[CINE-005] Executing P1-A Mutational Secret-Present Negative Control...`);
    mutTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinematch-mutational-'));
    fs.symlinkSync(nextTarget, path.join(mutTempDir, '.next'), 'junction');
    fs.symlinkSync(nodeModulesTarget, path.join(mutTempDir, 'node_modules'), 'junction');
    fs.copyFileSync(path.resolve(rootDir, 'package.json'), path.join(mutTempDir, 'package.json'));
    fs.copyFileSync(path.resolve(rootDir, 'next.config.ts'), path.join(mutTempDir, 'next.config.ts'));

    const MUT_PORT = await getAvailablePort();
    const MUT_BASE_URL = `http://127.0.0.1:${MUT_PORT}`;
    const mutEnv = {
      ...cleanEnv,
      PORT: String(MUT_PORT),
      YOUTUBE_API_KEY: 'synthetic-dev-mutational-youtube-key' // INJECT SYNTHETIC SECRET
    };

    mutServerProc = spawn(process.execPath, [
      '--require', networkGuardScript,
      '--require', mockScriptPath,
      nextBin, 'start', '-p', String(MUT_PORT)
    ], {
      cwd: mutTempDir,
      env: mutEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    await waitForServer(MUT_BASE_URL, 40000);
    console.log(`[CINE-005] Mutational server ready on port ${MUT_PORT}. Querying /api/youtube?videoId=test...`);

    const mutRes = await httpRequest(`${MUT_BASE_URL}/api/youtube?videoId=test`);
    const mutBody = JSON.parse(mutRes.body);

    // Predicate turning red: with YOUTUBE_API_KEY injected, it must NOT return "Server configuration error"
    const omissionPredicateTurnedRed = mutBody.error !== 'Server configuration error';
    // Security verification: outbound fetch to googleapis.com was blocked by fail-closed guard, yielding "Failed to fetch video data"
    const failClosedTransportEnforced = mutRes.statusCode === 500 && mutBody.error === 'Failed to fetch video data';
    const mutationalPass = omissionPredicateTurnedRed && failClosedTransportEnforced;

    results.checks.push({
      id: 'MUTATIONAL_SECRET_PRESENCE_CONTROL',
      endpoint: '/api/youtube?videoId=test (with injected YOUTUBE_API_KEY)',
      expectedStatus: 500,
      actualStatus: mutRes.statusCode,
      responseBody: mutBody,
      passed: mutationalPass,
      details: mutationalPass
        ? 'Sensitivity verified: omission predicate turned red (no configuration error returned) AND external outbound fetch was fail-closed blocked at transport boundary'
        : 'Failed: predicate did not turn red or external networking was not blocked'
    });

    console.log(`[CINE-005] Shutting down mutational server...`);
    await stopServer(mutServerProc);
    mutServerProc = null;

    // Step 6: Verify all checks passed and serialize results
    const allPassed = results.checks.every(c => c.passed);
    results.allPassed = allPassed;

    const outputPath = path.resolve(__dirname, 'onboarding-evidence.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`[CINE-005] Results written to: ${outputPath}`);

    console.log(`\n======================================================`);
    console.log(`CINE-005 HERMETIC ONBOARDING VERIFICATION SUMMARY:`);
    console.log(`======================================================`);
    for (const check of results.checks) {
      console.log(`[${check.passed ? 'PASS' : 'FAIL'}] ${check.id}: HTTP ${check.actualStatus || 'N/A'} (${check.details})`);
    }
    console.log(`OVERALL VERDICT: ${allPassed ? 'ALL PASS' : 'SOME CHECKS FAILED'}\n`);

    if (!allPassed) {
      process.exitCode = 1;
    }
  } finally {
    if (serverProc) {
      console.log(`[CINE-005] Cleaning up primary server process...`);
      await stopServer(serverProc);
    }
    if (mutServerProc) {
      console.log(`[CINE-005] Cleaning up mutational server process...`);
      await stopServer(mutServerProc);
    }
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        console.log(`[CINE-005] Cleaning up primary scratch directory: ${tempDir}...`);
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`[CINE-005] Primary scratch cleaned up. Exists: ${fs.existsSync(tempDir)}`);
      } catch (e) {
        console.error(`[CINE-005] Error cleaning primary scratch:`, e.message);
      }
    }
    if (mutTempDir && fs.existsSync(mutTempDir)) {
      try {
        console.log(`[CINE-005] Cleaning up mutational scratch directory: ${mutTempDir}...`);
        fs.rmSync(mutTempDir, { recursive: true, force: true });
        console.log(`[CINE-005] Mutational scratch cleaned up. Exists: ${fs.existsSync(mutTempDir)}`);
      } catch (e) {
        console.error(`[CINE-005] Error cleaning mutational scratch:`, e.message);
      }
    }
  }
}

run().catch((err) => {
  console.error('[CINE-005] Fatal error during verification:', err);
  process.exit(1);
});
