// EP-FLOOR-05 print tracer, controller-authored before implementation.
// One synthetic saved job through the real Print dialog (UX-CONTRACT §11).
// Literal geometry: room 9 x 6 x 2.7 m. "Cutting floor" x 0-3000, y 0-4000 and
// "Waiting and till" x 3000-6000, y 0-4000 share exterior A (hull 0-6 m of 9 m).
// Interior W1 at y 2000 from x 500 to 2500 sits inside Cutting floor, with a
// socket on each face and one run of each containment type.
// Run: node tests/floor-print-tracer-browser.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as C from '../prototype/js/core.js';

const playwrightPath = process.env.PLAYWRIGHT_MODULE
  || '/home/agent/.nvm/versions/node/v22.23.1/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightPath);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVE = path.join(ROOT, 'prototype');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml' };

function syntheticJob() {
  const job = C.blankJobV2('Synthetic print');
  job.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  C.addZone(job, { name: 'Cutting floor', x0: 0, y0: 0, x1: 3000, y1: 4000 });
  C.addZone(job, { name: 'Waiting and till', x0: 3000, y0: 0, x1: 6000, y1: 4000 });
  const wall = C.addWall(job, { x1: 500, y1: 2000, x2: 2500, y2: 2000 });
  C.placeItem(job, 'surface', wall, 400, 450, 'North socket', 'N');
  C.placeItem(job, 'surface', wall, 400, 450, 'South socket', 'S');
  C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 100, endMm: 1500, heightMm: 1200, notes: '' });
  C.addRoute(job, { type: 'conduit', wall, face: 'S', startMm: 200, endMm: 1800, heightMm: 300, notes: '' });
  return job;
}

function fail(message) { throw new Error(message); }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.join(SERVE, rel);
  if (!file.startsWith(SERVE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-print-'));
const backup = path.join(tmp, 'synthetic-print.json');
const job = syntheticJob();
fs.writeFileSync(backup, C.serialiseJob(job));
const expectedPrice = JSON.stringify(C.breakdown(job));

let browser;
let exitCode = 0;
try {
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.jobsBoot === 'ready');
  await page.setInputFiles('#file-input', backup);
  await page.locator('[data-testid="import-confirm"]').click();
  await page.waitForFunction(() => /^Saved on this device/.test(String((document.querySelector('[data-testid="save-chip"]') || {}).textContent || '').trim()));

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('#modal-root').getByRole('button', { name: 'Print', exact: true }).click();
  const dialog = page.locator('#modal-root');
  const sheets = dialog.getByRole('group', { name: 'Wall sheets' });
  await sheets.waitFor({ state: 'visible' });
  const whole = sheets.getByRole('checkbox', { name: 'Whole floor (every wall, full length)' });
  if (!(await whole.isChecked())) fail('Whole floor scope did not default to Whole floor');
  if (!/\b6 sheets\b/.test(await sheets.innerText())) fail(`whole floor count ${JSON.stringify(await sheets.innerText())}`);
  await whole.uncheck();
  await sheets.getByRole('checkbox', { name: 'Cutting floor' }).check();
  await sheets.getByRole('checkbox', { name: 'Waiting and till' }).check();
  const counted = await sheets.innerText();
  if (!/\b4 sheets\b/.test(counted) || !counted.includes('shared by the ticked zones')) fail(`zone count ${JSON.stringify(counted)}`);

  const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  await page.locator('[data-testid="print-go"]').click();
  await page.waitForFunction(() => window.__printed === 1);
  const heads = await page.locator('#print-pack .page h2').allInnerTexts();
  const a = heads.indexOf('Cutting floor, Waiting and till · North wall (A)');
  const d = heads.findIndex((h) => h.endsWith('(D)'));
  const n = heads.findIndex((h) => h.includes('W1 north side'));
  const s = heads.findIndex((h) => h.includes('W1 south side'));
  if (!(a > 0 && a < d && d < n && n < s)) fail(`sheet order ${JSON.stringify(heads)}`);
  if (heads.some((h) => /\((B|C)\)$/.test(h))) fail(`unticked walls printed ${JSON.stringify(heads)}`);
  const packText = await page.locator('#print-pack').innerText();
  if (!packText.includes('Looking north · 0.00 to 6.00 m of 9.00 m')) fail('A subtitle missing the hull range');
  if (!packText.includes("Containment isn't priced or measured in this version.")) fail('containment warning missing');
  if (heads[heads.length - 1] !== 'Labour breakdown — whole job, all layers') fail('breakdown is not last');
  const footers = await page.locator('#print-pack .page').count();
  if (!packText.includes(`Page ${footers} of ${footers}`)) fail('page footers');
  if (await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())) !== stored) fail('printing changed stored data');
  if (JSON.stringify(C.breakdown(job)) !== expectedPrice) fail('price changed');
  if (errors.length) fail(`page errors ${errors.join(' | ')}`);
  console.log('ok - print tracer');
} catch (err) {
  console.error(`FAIL - print tracer: ${err && err.stack ? err.stack : err}`);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(exitCode);
