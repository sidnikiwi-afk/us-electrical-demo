// Live v13 (zones) -> current build -> rollback to v13, at the same URL.
// Proves an upgraded job survives and takes a wall, and that rolling back
// leaves every stored byte alone (v13 cannot read the newer record).
// Needs the v13 prototype on disk: OLD_PROTOTYPE=/path/to/v13/prototype
// Run: OLD_PROTOTYPE=... node tests/floor-upgrade-browser.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwrightPath = process.env.PLAYWRIGHT_MODULE
  || '/home/agent/.nvm/versions/node/v22.23.1/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightPath);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEW = path.join(ROOT, 'prototype');
const OLD = process.env.OLD_PROTOTYPE;
if (!OLD || !fs.existsSync(path.join(OLD, 'sw.js'))) { console.error('FAIL - set OLD_PROTOTYPE to the v13 prototype directory'); process.exit(1); }
const buildOf = (dir) => fs.readFileSync(path.join(dir, 'js', 'core.js'), 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const OLD_BUILD = buildOf(OLD);
const NEW_BUILD = buildOf(NEW);
const EV = path.join(ROOT, '.worker-output', 'upgrade-evidence');
fs.mkdirSync(EV, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

let root = OLD;
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;

function fail(message) { throw new Error(message); }

// The v13 core builds the backup, so the record is exactly what live writes.
const OC = await import(pathToFileURL(path.join(OLD, 'js', 'core.js')).href);
const seed = OC.blankJobV2('Upgrade job');
seed.room = { widthM: 9, depthM: 6, heightM: 2.7 };
OC.addZone(seed, { name: 'Upgrade zone', x0: 0, y0: 0, x1: 4000, y1: 4000 });
OC.placeItem(seed, 'surface', 'A', 1000, 450, 'Live socket');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-upgrade-'));
const backup = path.join(tmp, 'upgrade.json');
fs.writeFileSync(backup, OC.serialiseJob(seed));

const storage = (page) => page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
const running = (page) => page.evaluate(async () => (await import('./js/core.js')).BUILD).catch(() => null);
async function switchTo(page, dir, build) {
  root = dir;
  for (let i = 0; i < 10; i++) {
    await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.update().catch(() => {}); }).catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.jobsBoot, null, { timeout: 15000 }).catch(() => {});
    if (await running(page) === build) return;
    await page.waitForTimeout(500);
  }
  fail(`app did not switch to ${build}; running ${await running(page)}`);
}

let browser;
let exitCode = 0;
const steps = [];
try {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(`${root === OLD ? 'v13' : 'new'}: ${err}`));

  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.jobsBoot === 'ready');
  if (await running(page) !== OLD_BUILD) fail(`old app not running: ${await running(page)}`);
  await page.setInputFiles('#file-input', backup);
  await page.locator('[data-testid="import-confirm"]').click();
  await page.waitForFunction(() => Object.values(localStorage).some((v) => v.includes('"name":"Upgrade job"')));
  await page.waitForFunction(async () => !!navigator.serviceWorker.controller);
  steps.push('v13-saved');

  await switchTo(page, NEW, NEW_BUILD);
  await page.waitForFunction(() => document.documentElement.dataset.jobsBoot === 'ready');
  const name = await page.locator('#btn-job-name').textContent();
  if (name !== 'Upgrade job') fail(`upgraded app opened ${JSON.stringify(name)}`);
  const zones = await page.locator('[data-testid="zone-select"] option').allTextContents();
  if (!zones.some((z) => z.includes('Upgrade zone'))) fail(`zone missing after upgrade ${JSON.stringify(zones)}`);
  if (!(await page.locator('#quote-summary').innerText()).includes('£')) fail('quote missing after upgrade');
  steps.push('upgraded-job-opens');

  await page.locator('#mode-rail [data-mode="build"]').click();
  await page.locator('[data-testid="build-add-wall"]').click();
  await page.locator('[data-testid="build-enter-sizes"]').click();
  await page.locator('#modal-root [data-testid="wall-line"]').fill('3000');
  await page.locator('#modal-root [data-testid="wall-start"]').fill('2000');
  await page.locator('#modal-root [data-testid="wall-end"]').fill('7000');
  await page.locator('#modal-root [data-testid="wall-add"]').click();
  await page.waitForFunction(() => Object.values(localStorage).some((v) => v.includes('"name":"Upgrade job"') && v.includes('"id":"W1"')));
  await page.waitForTimeout(1500);
  const upgraded = await storage(page);
  steps.push('wall-added-and-saved');
  await page.screenshot({ path: path.join(EV, '01-upgraded.png') });

  await switchTo(page, OLD, OLD_BUILD);
  await page.waitForTimeout(3000);
  if (await storage(page) !== upgraded) fail('rolling back to v13 changed stored data');
  await page.screenshot({ path: path.join(EV, '02-rolled-back.png') });
  const shown = await page.evaluate(() => document.body.innerText.slice(0, 600));
  fs.writeFileSync(path.join(EV, 'rollback-visible.txt'), shown);
  steps.push('rollback-storage-untouched');

  if (errors.length) fail(`page errors ${errors.join(' | ')}`);
  console.log(`ok - upgrade ${OLD_BUILD} -> ${NEW_BUILD} -> rollback (${steps.join(', ')})`);
} catch (err) {
  console.error(`FAIL - upgrade (${steps.join(', ')}): ${err && err.stack ? err.stack : err}`);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(exitCode);
