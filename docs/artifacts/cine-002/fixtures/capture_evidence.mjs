/**
 * Portable, replayable headless Chrome evidence capture runner using Chrome DevTools Protocol (CDP).
 *
 * Enforces strict assertion gates on:
 * - Image completeness (loadedImages === totalImages, brokenImages === 0, naturalWidth > 0, complete === true)
 * - Browser console error & uncaught exception tracking (Runtime.consoleAPICalled, Runtime.exceptionThrown)
 * - React hydration verification (window.__NEXT_HYDRATION_ERROR)
 * - Exact PNG dimensions via IHDR chunk audit
 * - Genuine negative search control (strict media card selector, zero results, tab counter)
 * - Unauthenticated error alert verification from live DOM
 * - Hard failure exit code (process.exit(1)) if any assertion fails
 *
 * Usage:
 *   node ./docs/artifacts/cine-002/fixtures/capture_evidence.mjs
 *   node ./docs/artifacts/cine-002/fixtures/capture_evidence.mjs --self-test
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Configurable environment variables with repo-relative defaults
const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3055';
const CHROME_PORT = Number(process.env.CHROME_PORT || 9222);
const VIEWPORT_WIDTH = Number(process.env.VIEWPORT_WIDTH || 1440);
const VIEWPORT_HEIGHT = Number(process.env.VIEWPORT_HEIGHT || 900);
const ARTIFACTS_DIR = process.env.OUTPUT_DIR || path.resolve(import.meta.dirname, '..');

// Cross-platform Chrome executable discovery
function findChromePath() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe')
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/local/bin/google-chrome'
    );
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error(`Chrome executable not found. Specify CHROME_BIN environment variable.`);
}

function getPngDimensions(buffer) {
  if (buffer.length < 24) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();
    this.consoleErrors = [];
    this.exceptions = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        } else if (msg.method) {
          if (msg.method === 'Runtime.consoleAPICalled') {
            const params = msg.params;
            if (params.type === 'error' || params.type === 'assert') {
              this.consoleErrors.push({
                type: params.type,
                args: params.args?.map(a => a.value || a.description || '')
              });
            }
          }
          if (msg.method === 'Runtime.exceptionThrown') {
            const details = msg.params?.exceptionDetails;
            this.exceptions.push({
              text: details?.text,
              description: details?.exception?.description || details?.text
            });
          }
          if (this.eventListeners.has(msg.method)) {
            this.eventListeners.get(msg.method)(msg.params);
          }
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  resetDiagnostics() {
    this.consoleErrors = [];
    this.exceptions = [];
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runTestPlan(testPlan) {
  const chromePath = findChromePath();
  const userDataDir = path.join(os.tmpdir(), `chrome-cdp-session-${Date.now()}`);

  console.log(`[runner] Chrome binary: ${chromePath}`);
  console.log(`[runner] Launching headless Chrome on port ${CHROME_PORT}...`);
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${CHROME_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
    `--user-data-dir=${userDataDir}`
  ]);

  const cleanup = () => {
    try { chromeProc.kill(); } catch (_) {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  };
  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });

  await new Promise(r => setTimeout(r, 2000));

  let cdp;
  const results = [];

  try {
    const versionRes = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`);
    const versionData = await versionRes.json();
    console.log(`[runner] Connected to ${versionData.Browser}`);

    const newTabRes = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/new?about:blank`, { method: 'PUT' });
    const tabData = await newTabRes.json();
    cdp = new CDPClient(tabData.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Console.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
      mobile: false
    });

    if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

    for (const t of testPlan) {
      cdp.resetDiagnostics();
      const targetUrl = `${TARGET_URL}${t.path}`;
      console.log(`\n[runner] Navigating to ${targetUrl}...`);
      await cdp.send('Page.navigate', { url: targetUrl });

      const waitMs = t.name === 'search-diagnostic-empty' ? 10000 : 4000;
      await new Promise(res => setTimeout(res, waitMs));

      const evalRes = await cdp.send('Runtime.evaluate', {
        expression: `
          (() => {
            const bodyText = document.body ? document.body.innerText : '';
            const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(h => h.innerText.trim()).filter(Boolean);
            const allImages = Array.from(document.querySelectorAll('img'));
            const imageStats = allImages.map(img => ({
              src: img.src,
              alt: img.alt,
              complete: img.complete,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              isLoaded: img.complete && img.naturalWidth > 0,
              isBroken: img.complete && img.naturalWidth === 0,
              isPending: !img.complete
            }));

            const loadedImages = imageStats.filter(i => i.isLoaded).length;
            const brokenImages = imageStats.filter(i => i.isBroken).length;
            const pendingImages = imageStats.filter(i => i.isPending).length;

            // Strict media card counting & detection
            const mediaCardElements = Array.from(document.querySelectorAll('article, [class*="MediaCard"], a[href*="/movie/"], a[href*="/tv/"]'));
            const mediaCardCount = mediaCardElements.length;

            const cardsFound = [];
            for (const card of mediaCardElements) {
              const text = card.innerText || '';
              for (const expected of ['Fight Club', 'Interstellar', 'The Dark Knight', 'Inception', 'Game of Thrones', 'Breaking Bad', 'Stranger Things', 'Arcane']) {
                if (text.includes(expected) && !cardsFound.includes(expected)) {
                  cardsFound.push(expected);
                }
              }
            }

            // Live DOM error alert reading without fallback
            const alertElement = document.querySelector('[role="alert"]') || Array.from(document.querySelectorAll('*')).find(el => el.innerText && el.innerText.includes('Failed to load search results'));
            const alertText = alertElement ? alertElement.innerText.trim() : null;
            const hasAlert = alertText !== null;

            // Next.js hydration error marker check
            const hydrationError = window.__NEXT_HYDRATION_ERROR || null;

            return {
              title: document.title,
              headings: headings.slice(0, 8),
              cardsFound,
              mediaCardCount,
              totalImages: allImages.length,
              loadedImages,
              brokenImages,
              pendingImages,
              hasAlert,
              alertText,
              hasZeroResultsTab: bodyText.includes('Movies (0)'),
              hydrationError
            };
          })()
        `,
        returnByValue: true
      });

      const pageState = evalRes.result.value;
      const consoleErrors = [...cdp.consoleErrors];
      const exceptions = [...cdp.exceptions];

      console.log(`[runner] ${t.name} page state:`, {
        title: pageState.title,
        cardsFound: pageState.cardsFound,
        mediaCardCount: pageState.mediaCardCount,
        images: `${pageState.loadedImages}/${pageState.totalImages} (broken=${pageState.brokenImages}, pending=${pageState.pendingImages})`,
        hasAlert: pageState.hasAlert,
        alertText: pageState.alertText,
        consoleErrors: consoleErrors.length,
        exceptions: exceptions.length,
        hydrationError: pageState.hydrationError
      });

      // Screenshot capture & dimension verification
      const shotRes = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const buffer = Buffer.from(shotRes.data, 'base64');
      const dimensions = getPngDimensions(buffer);

      if (t.outputFilename) {
        const outPath = path.join(ARTIFACTS_DIR, t.outputFilename);
        fs.writeFileSync(outPath, buffer);
        console.log(`[runner] Saved ${t.outputFilename} (${buffer.length} bytes, ${dimensions?.width}x${dimensions?.height})`);
      }

      // Assertions calculation
      let isPass = false;
      const failureReasons = [];

      if (t.testType === 'affirmative') {
        const hasExpectedCards = t.expectedCards.every(c => pageState.cardsFound.includes(c));
        const hasMinImages = pageState.totalImages >= (t.minExpectedImages || 1);
        const allImagesLoaded = pageState.totalImages > 0 && pageState.loadedImages === pageState.totalImages;
        const noBroken = pageState.brokenImages === 0;
        const noPending = pageState.pendingImages === 0;
        const noConsoleErrors = consoleErrors.length === 0;
        const noExceptions = exceptions.length === 0;
        const noHydration = pageState.hydrationError === null;
        const dimensionMatch = dimensions?.width === VIEWPORT_WIDTH && dimensions?.height === VIEWPORT_HEIGHT;

        if (!hasExpectedCards) failureReasons.push(`Missing expected cards. Expected: ${t.expectedCards}, Found: ${pageState.cardsFound}`);
        if (!hasMinImages) failureReasons.push(`Image count below minimum. Expected >= ${t.minExpectedImages}, Got ${pageState.totalImages}`);
        if (!allImagesLoaded) failureReasons.push(`Images incomplete: ${pageState.loadedImages}/${pageState.totalImages} loaded`);
        if (!noBroken) failureReasons.push(`Found ${pageState.brokenImages} broken images`);
        if (!noPending) failureReasons.push(`Found ${pageState.pendingImages} pending images`);
        if (!noConsoleErrors) failureReasons.push(`Console errors: ${JSON.stringify(consoleErrors)}`);
        if (!noExceptions) failureReasons.push(`Uncaught exceptions: ${JSON.stringify(exceptions)}`);
        if (!noHydration) failureReasons.push(`Hydration error detected: ${pageState.hydrationError}`);
        if (!dimensionMatch) failureReasons.push(`Dimension mismatch: expected ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}, got ${dimensions?.width}x${dimensions?.height}`);

        isPass = failureReasons.length === 0;
      } else if (t.testType === 'negative') {
        const noCards = pageState.mediaCardCount === 0;
        const noImages = pageState.totalImages === 0;
        const hasZeroTab = pageState.hasZeroResultsTab;
        const noAlert = !pageState.hasAlert;
        const noConsoleErrors = consoleErrors.length === 0;
        const noExceptions = exceptions.length === 0;

        if (!noCards) failureReasons.push(`Expected 0 media cards, found ${pageState.mediaCardCount}`);
        if (!noImages) failureReasons.push(`Expected 0 images, found ${pageState.totalImages}`);
        if (!hasZeroTab) failureReasons.push('Tab counter did not render "Movies (0)"');
        if (!noAlert) failureReasons.push(`Unexpected error alert rendered: ${pageState.alertText}`);
        if (!noConsoleErrors) failureReasons.push(`Console errors: ${JSON.stringify(consoleErrors)}`);
        if (!noExceptions) failureReasons.push(`Uncaught exceptions: ${JSON.stringify(exceptions)}`);

        isPass = failureReasons.length === 0;
      } else if (t.testType === 'diagnostic-unauth') {
        const hasAlert = pageState.hasAlert;
        const alertMatches = pageState.alertText && pageState.alertText.includes('Failed to load search results');
        const noCards = pageState.mediaCardCount === 0;

        if (!hasAlert) failureReasons.push('Expected error alert, but none found in DOM');
        if (!alertMatches) failureReasons.push(`Alert text mismatch: expected "Failed to load search results", got "${pageState.alertText}"`);
        if (!noCards) failureReasons.push(`Expected 0 media cards during error state, found ${pageState.mediaCardCount}`);

        isPass = failureReasons.length === 0;
      }

      results.push({
        test: t.name,
        path: t.path,
        outputFilename: t.outputFilename || null,
        bytes: buffer.length,
        dimensions: `${dimensions?.width}x${dimensions?.height}`,
        pageState: {
          title: pageState.title,
          headings: pageState.headings,
          cardsFound: pageState.cardsFound,
          mediaCardCount: pageState.mediaCardCount,
          totalImages: pageState.totalImages,
          loadedImages: pageState.loadedImages,
          brokenImages: pageState.brokenImages,
          pendingImages: pageState.pendingImages,
          hasAlert: pageState.hasAlert,
          alertText: pageState.alertText,
          consoleErrorsCount: consoleErrors.length,
          exceptionsCount: exceptions.length,
          hydrationError: pageState.hydrationError
        },
        pass: isPass,
        failureReasons
      });
    }
  } finally {
    if (cdp) cdp.close();
    cleanup();
  }

  return results;
}

const standardTestPlan = [
  {
    name: 'root',
    path: '/',
    testType: 'affirmative',
    expectedCards: ['Fight Club', 'Interstellar'],
    minExpectedImages: 20,
    outputFilename: 'screenshot-root.png'
  },
  {
    name: 'movie',
    path: '/movie',
    testType: 'affirmative',
    expectedCards: ['Fight Club', 'Interstellar', 'The Dark Knight'],
    minExpectedImages: 12,
    outputFilename: 'screenshot-movie.png'
  },
  {
    name: 'tv',
    path: '/tv',
    testType: 'affirmative',
    expectedCards: ['Game of Thrones', 'Breaking Bad', 'Stranger Things', 'Arcane'],
    minExpectedImages: 12,
    outputFilename: 'screenshot-tv.png'
  },
  {
    name: 'trending',
    path: '/trending',
    testType: 'affirmative',
    expectedCards: ['Fight Club', 'Interstellar', 'Game of Thrones', 'Breaking Bad'],
    minExpectedImages: 4,
    outputFilename: 'screenshot-trending.png'
  },
  {
    name: 'search',
    path: '/search?q=Inception',
    testType: 'affirmative',
    expectedCards: ['Inception'],
    minExpectedImages: 1,
    outputFilename: 'screenshot-search.png'
  },
  {
    name: 'search-negative',
    path: '/search?q=NonExistentQuery',
    testType: 'negative',
    outputFilename: 'screenshot-search-negative.png'
  },
  {
    name: 'search-diagnostic-empty',
    path: '/search?q=unauthorized_query',
    testType: 'diagnostic-unauth',
    outputFilename: 'screenshot-search-diagnostic-empty.png'
  }
];

const selfTestMutationPlan = [
  {
    name: 'intentional-failure-missing-card',
    path: '/movie',
    testType: 'affirmative',
    expectedCards: ['NonExistentCardTitle_MutationTest'],
    minExpectedImages: 12,
    outputFilename: null
  }
];

async function main() {
  const isSelfTest = process.argv.includes('--self-test');

  if (isSelfTest) {
    console.log('[runner] Executing self-test mutation mode (testing negative exit code enforcement)...');
    const results = await runTestPlan(selfTestMutationPlan);
    const failedAsExpected = results.every(r => !r.pass);
    if (failedAsExpected) {
      console.log('\n[runner] SELF-TEST PASS: Failing predicate successfully detected and marked pass: false.');
      console.log('[runner] Failure details:', JSON.stringify(results[0].failureReasons, null, 2));
      process.exit(0);
    } else {
      console.error('\n[runner] SELF-TEST FAIL: Mutation did not trigger pass: false!');
      process.exit(2);
    }
  }

  const results = await runTestPlan(standardTestPlan);

  console.log('\n================== CAPTURE SUMMARY ==================');
  console.log(JSON.stringify(results, null, 2));

  // Persist machine-readable assertion results
  const resultsPath = path.join(ARTIFACTS_DIR, 'fixtures', 'capture-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`[runner] Saved results to ${resultsPath}`);

  // Hard exit code enforcement: fail if ANY assertion failed
  const allPassed = results.length > 0 && results.every(r => r.pass);
  if (!allPassed) {
    const failed = results.filter(r => !r.pass).map(r => `${r.test}: ${r.failureReasons.join('; ')}`);
    console.error('\n[runner] RUNNER FAILED WITH NONZERO EXIT. Failed assertions:');
    failed.forEach(f => console.error(` - ${f}`));
    process.exit(1);
  }

  console.log(`\n[runner] ALL ${results.length} VERIFICATION GATES PASSED.`);
  process.exit(0);
}

main().catch(err => {
  console.error('[runner] Fatal error:', err);
  process.exit(1);
});
