/**
 * Replayable headless Chrome evidence capture runner using Chrome DevTools Protocol (CDP).
 *
 * Captures loaded-state screenshots, image completeness predicates (naturalWidth > 0),
 * negative search query behavior, and unauthenticated failure states.
 *
 * Usage:
 *   node ./docs/artifacts/cine-002/fixtures/capture_evidence.mjs
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const LOCAL_PORT = 3055;
const CHROME_PORT = 9222;
const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();
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
        } else if (msg.method && this.eventListeners.has(msg.method)) {
          this.eventListeners.get(msg.method)(msg.params);
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

  on(event, handler) {
    this.eventListeners.set(event, handler);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function getPngDimensions(buffer) {
  if (buffer.length < 24) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

async function main() {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.join(process.env.TEMP, `chrome-evidence-${Date.now()}`);

  console.log(`[runner] Launching Chrome CDP on port ${CHROME_PORT}...`);
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${CHROME_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
    `--user-data-dir=${userDataDir}`
  ]);

  await new Promise(r => setTimeout(r, 2000));

  const versionRes = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`);
  const versionData = await versionRes.json();
  console.log(`[runner] Connected to ${versionData.Browser}`);

  const newTabRes = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/new?about:blank`, { method: 'PUT' });
  const tabData = await newTabRes.json();
  const cdp = new CDPClient(tabData.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    deviceScaleFactor: 1,
    mobile: false
  });

  const outputDir = path.resolve("D:\\projects\\cinemania-cine-002\\docs\\artifacts\\cine-002");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const testPlan = [
    {
      name: 'root',
      path: '/',
      expectedCards: ['Fight Club', 'Interstellar'],
      outputFilename: 'screenshot-root.png',
      predicateDescription: 'Hero banner loaded + Movie cards rendered with valid posters'
    },
    {
      name: 'movie',
      path: '/movie',
      expectedCards: ['Fight Club', 'Interstellar', 'The Dark Knight'],
      outputFilename: 'screenshot-movie.png',
      predicateDescription: '12-column movie grid populated with valid posters & ratings'
    },
    {
      name: 'tv',
      path: '/tv',
      expectedCards: ['Game of Thrones', 'Breaking Bad', 'Stranger Things'],
      outputFilename: 'screenshot-tv.png',
      predicateDescription: 'TV show grid with TV titles (Game of Thrones, Breaking Bad) and valid posters'
    },
    {
      name: 'trending',
      path: '/trending',
      expectedCards: ['Fight Club', 'Game of Thrones'],
      outputFilename: 'screenshot-trending.png',
      predicateDescription: 'Trending media grid populated with valid posters'
    },
    {
      name: 'search',
      path: '/search?q=Inception',
      expectedCards: ['Inception'],
      outputFilename: 'screenshot-search.png',
      predicateDescription: 'Search result card for Inception with valid poster artwork'
    },
    {
      name: 'search-negative',
      path: '/search?q=NonExistentQuery',
      expectedCards: [],
      outputFilename: 'screenshot-search-negative.png',
      predicateDescription: 'Genuine negative search query returning zero results'
    },
    {
      name: 'search-diagnostic-empty',
      path: '/search?q=unauthorized_query',
      expectedCards: [],
      outputFilename: 'screenshot-search-diagnostic-empty.png',
      predicateDescription: 'Diagnostic unauthenticated error alert state ("Failed to load search results")'
    }
  ];

  const results = [];

  for (const t of testPlan) {
    const targetUrl = `http://localhost:${LOCAL_PORT}${t.path}`;
    console.log(`\n[runner] Navigating to ${targetUrl}...`);
    await cdp.send('Page.navigate', { url: targetUrl });

    // Allow page scripts and images to settle (wait longer for React Query error retries to settle on diagnostic test)
    const waitMs = t.name === 'search-diagnostic-empty' ? 10000 : 4000;
    await new Promise(res => setTimeout(res, waitMs));

    // Deep DOM inspection: cards, headings, image naturalWidth, broken images
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
            isLoaded: img.complete && img.naturalWidth > 0
          }));
          const loadedImages = imageStats.filter(i => i.isLoaded).length;
          const brokenImages = imageStats.filter(i => !i.isLoaded && i.complete).length;

          const cardsFound = [];
          for (const card of document.querySelectorAll('article, div[class*="rounded-lg"]')) {
            const text = card.innerText || '';
            for (const expected of ['Fight Club', 'Interstellar', 'The Dark Knight', 'Inception', 'Game of Thrones', 'Breaking Bad', 'Stranger Things', 'Arcane']) {
              if (text.includes(expected) && !cardsFound.includes(expected)) {
                cardsFound.push(expected);
              }
            }
          }

          const hasAlert = !!document.querySelector('[role="alert"]') || bodyText.includes('Failed to load search results') || bodyText.includes('Failed to load media');
          const alertText = hasAlert ? (document.querySelector('[role="alert"]')?.innerText || 'Failed to load search results. Please try again later.') : null;

          return {
            title: document.title,
            headings: headings.slice(0, 8),
            cardsFound,
            totalImages: allImages.length,
            loadedImages,
            brokenImages,
            hasAlert,
            alertText
          };
        })()
      `,
      returnByValue: true
    });

    const pageState = evalRes.result.value;
    console.log(`[runner] ${t.name} page state:`, JSON.stringify(pageState, null, 2));

    const shotRes = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(shotRes.data, 'base64');
    const dimensions = getPngDimensions(buffer);

    const outPath = path.join(outputDir, t.outputFilename);
    fs.writeFileSync(outPath, buffer);
    console.log(`[runner] Saved ${t.outputFilename} (${buffer.length} bytes, ${dimensions?.width}x${dimensions?.height})`);

    const isPass = t.name === 'search-diagnostic-empty' ? pageState.hasAlert :
                   t.name === 'search-negative' ? (pageState.cardsFound.length === 0 && !pageState.hasAlert) :
                   (t.expectedCards.every(c => pageState.cardsFound.includes(c)) && pageState.brokenImages === 0);

    results.push({
      test: t.name,
      path: t.path,
      outputFilename: t.outputFilename,
      bytes: buffer.length,
      dimensions: `${dimensions?.width}x${dimensions?.height}`,
      pageState,
      pass: isPass
    });
  }

  cdp.close();
  chromeProc.kill();

  console.log("\n================== CAPTURE SUMMARY ==================");
  console.log(JSON.stringify(results, null, 2));

  // Save report JSON
  fs.writeFileSync(
    path.join(outputDir, 'fixtures', 'capture-results.json'),
    JSON.stringify(results, null, 2)
  );
}

main().catch(err => {
  console.error("[runner] Fatal error:", err);
  process.exit(1);
});
