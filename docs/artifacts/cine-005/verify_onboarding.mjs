/**
 * CINE-005 Onboarding & Synthetic Fixtures Verification Runner
 *
 * Verifies:
 * 1. Offline developer experience using synthetic TMDB mock interceptor (mock_tmdb.cjs).
 * 2. Route responses under synthetic fixtures without live TMDB credentials:
 *    - /api/genres?type=movie -> HTTP 200 (returns array of genres)
 *    - /api/languages -> HTTP 200 (returns array of languages)
 *    - /api/media/trending?mediaType=movie&timeWindow=day -> HTTP 200 (returns trending results)
 *    - /movie -> HTTP 200 (HTML render)
 *    - / -> HTTP 200 (HTML render)
 * 3. Parameter validation defensive assertions:
 *    - /api/media/trending without required params -> HTTP 400
 * 4. Actionable error handling when environment variables are omitted:
 *    - YOUTUBE_API_KEY omission yields HTTP 500 {"error": "Server configuration error"}.
 *    - IPINFO_TOKEN omission with localhost IP yields HTTP 200 {"region": "US"}.
 *
 * Output: docs/artifacts/cine-005/onboarding-evidence.json
 */

import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');
const PORT = 3058;
const BASE_URL = `http://localhost:${PORT}`;

function httpRequest(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await httpRequest(url);
      if (res.statusCode >= 200 && res.statusCode < 500) {
        return true;
      }
    } catch (_) {
      // server not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} failed to start within ${timeoutMs}ms`);
}

async function run() {
  console.log(`[CINE-005] Starting Next.js with synthetic TMDB mock on port ${PORT}...`);

  const mockScriptPath = path.resolve(rootDir, 'docs/artifacts/cine-002/fixtures/mock_tmdb.cjs');
  const nextBin = path.resolve(rootDir, 'node_modules/next/dist/bin/next');

  const serverProc = spawn(process.execPath, [
    '--require', mockScriptPath,
    nextBin, 'start', '-p', String(PORT)
  ], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'production',
      NEXT_PUBLIC_TMDB_POSTER_URL: 'https://image.tmdb.org/t/p',
      NEXT_PUBLIC_IMAGE_BASE_URL: 'https://image.tmdb.org/t/p'
      // Note: TMDB_API_RAT, YOUTUBE_API_KEY, IPINFO_TOKEN are intentionally omitted to test fallbacks
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProc.stdout.on('data', (d) => process.stdout.write(`[Next.js stdout] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`[Next.js stderr] ${d}`));

  const results = {
    task: 'CINE-005',
    timestamp: new Date().toISOString(),
    port: PORT,
    environment: {
      node: process.version,
      platform: process.platform,
      syntheticMockLoaded: true
    },
    checks: []
  };

  try {
    console.log(`[CINE-005] Polling ${BASE_URL} for server readiness...`);
    await waitForServer(BASE_URL, 40000);
    console.log(`[CINE-005] Next.js server is ready. Executing verification assertions...`);

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
      details: genresPass ? `Successfully intercepted and returned ${genresBody.length} synthetic genres` : 'Failed'
    });

    // Test 2: Synthetic TMDB /api/languages
    console.log(`Testing /api/languages (Synthetic TMDB)...`);
    const langRes = await httpRequest(`${BASE_URL}/api/languages`);
    const langBody = JSON.parse(langRes.body);
    const langPass = langRes.statusCode === 200 && Array.isArray(langBody) && langBody.length > 0;
    results.checks.push({
      id: 'SYNTHETIC_TMDB_LANGUAGES',
      endpoint: '/api/languages',
      expectedStatus: 200,
      actualStatus: langRes.statusCode,
      passed: langPass,
      itemCount: Array.isArray(langBody) ? langBody.length : 0,
      details: langPass ? `Successfully returned ${langBody.length} synthetic languages` : 'Failed'
    });

    // Test 3: Synthetic TMDB /api/media/trending?mediaType=movie&timeWindow=day
    console.log(`Testing /api/media/trending?mediaType=movie&timeWindow=day (Synthetic TMDB)...`);
    const trendRes = await httpRequest(`${BASE_URL}/api/media/trending?mediaType=movie&timeWindow=day`);
    const trendBody = JSON.parse(trendRes.body);
    const trendPass = trendRes.statusCode === 200 && Array.isArray(trendBody.results);
    results.checks.push({
      id: 'SYNTHETIC_TMDB_TRENDING_VALID',
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

    // Test 7: Env Omission - YOUTUBE_API_KEY
    console.log(`Testing /api/youtube?videoId=test (Env Omission Actionable Error)...`);
    const ytRes = await httpRequest(`${BASE_URL}/api/youtube?videoId=test`);
    const ytBody = JSON.parse(ytRes.body);
    const ytPass = ytRes.statusCode === 500 && ytBody.error === 'Server configuration error';
    results.checks.push({
      id: 'ENV_OMISSION_YOUTUBE_API_KEY',
      endpoint: '/api/youtube?videoId=test',
      expectedStatus: 500,
      actualStatus: ytRes.statusCode,
      responseBody: ytBody,
      passed: ytPass,
      details: ytPass ? 'Yields actionable HTTP 500 Server configuration error when YOUTUBE_API_KEY is omitted' : 'Failed'
    });

    // Test 8: Env Omission - IPINFO_TOKEN (Localhost IP Fallback)
    console.log(`Testing /api/geolocation (Env Omission Local Fallback)...`);
    const geoRes = await httpRequest(`${BASE_URL}/api/geolocation`);
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

    const allPassed = results.checks.every(c => c.passed);
    results.allPassed = allPassed;

    const outputPath = path.resolve(__dirname, 'onboarding-evidence.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`[CINE-005] Results written to: ${outputPath}`);

    console.log(`\n======================================================`);
    console.log(`CINE-005 ONBOARDING & FIXTURES VERIFICATION SUMMARY:`);
    console.log(`======================================================`);
    for (const check of results.checks) {
      console.log(`[${check.passed ? 'PASS' : 'FAIL'}] ${check.id}: HTTP ${check.actualStatus} (${check.details})`);
    }
    console.log(`OVERALL VERDICT: ${allPassed ? 'ALL PASS' : 'SOME CHECKS FAILED'}\n`);

    if (!allPassed) {
      process.exitCode = 1;
    }
  } finally {
    console.log(`[CINE-005] Shutting down Next.js server (PID: ${serverProc.pid})...`);
    serverProc.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('[CINE-005] Fatal error during verification:', err);
  process.exit(1);
});
