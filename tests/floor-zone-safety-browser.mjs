// Zone correction journeys. Controller runs this file. Do not treat a missing
// run as a pass. Evidence goes only to zone-ui-corrections-evidence.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const playwrightPath = process.env.PLAYWRIGHT_MODULE
  || '/home/agent/.nvm/versions/node/v22.23.1/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightPath);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVE = path.join(ROOT, 'prototype');
const EV = path.join(ROOT, '.worker-output', 'zone-ui-corrections-evidence');
const BUILD = 'surface-proto-v13-floor-zones-20261012';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

fs.mkdirSync(EV, { recursive: true });
const checks = [];
let serveMixed = false;

function fail(message) {
  const err = new Error(message);
  err.expectedRed = false;
  throw err;
}

function hashFile(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const sourceHash = {
  'prototype/js/ui.js': hashFile('prototype/js/ui.js'),
  'prototype/js/jobs-v2.js': hashFile('prototype/js/jobs-v2.js'),
  'prototype/js/floor-zones.js': hashFile('prototype/js/floor-zones.js'),
  'prototype/js/core.js': hashFile('prototype/js/core.js'),
  'prototype/css/style.css': hashFile('prototype/css/style.css'),
};
fs.writeFileSync(path.join(EV, 'source-hash.json'), JSON.stringify(sourceHash, null, 2));

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(SERVE, rel);
  if (!file.startsWith(SERVE + path.sep) && file !== SERVE) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = data;
    if (serveMixed && rel === 'js/core.js') body = Buffer.from(data.toString('utf8').replaceAll(BUILD, BUILD + '-mixed'));
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const baseUrl = `http://127.0.0.1:${server.address().port}/index.html`;

let browser;
let exitCode = 0;
const hard = setTimeout(() => {
  console.error('FAIL - global timeout');
  Promise.resolve(browser && browser.close()).finally(() => {
    server.close();
    process.exit(1);
  });
}, 180000);

function shot(page, name) {
  return page.screenshot({ path: path.join(EV, name) });
}

async function onlyVisible(page, testid) {
  const loc = page.locator(`[data-testid="${testid}"]:visible`);
  await loc.first().waitFor({ state: 'visible', timeout: 10000 });
  const n = await loc.count();
  if (n !== 1) fail(`${testid}: expected 1 visible control, found ${n}`);
  return loc;
}

async function reachable(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const problem = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return 'too small';
    if (r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) {
      return `clipped ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 22));
    if (hit && (hit === el || el.contains(hit))) return null;
    return `covered by ${hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : 'nothing'}`;
  });
  if (problem) fail(`${label}: ${problem}`);
}

async function svgClient(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const svg = document.querySelector('#canvas');
    const world = svg.querySelector('#world');
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const s = pt.matrixTransform(world.getScreenCTM());
    return { x: s.x, y: s.y };
  }, { x, y });
}

async function newRoom(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await (await onlyVisible(page, 'start-blank')).click();
  await (await onlyVisible(page, 'newjob-name')).fill('Barber refit');
  await (await onlyVisible(page, 'room-widthM')).fill('9');
  await (await onlyVisible(page, 'room-depthM')).fill('6');
  await (await onlyVisible(page, 'room-heightM')).fill('2.7');
  await (await onlyVisible(page, 'room-save')).click();
  await page.locator('#app:visible').waitFor({ timeout: 10000 });
  await page.locator('button[data-mode="build"]').click();
  await (await onlyVisible(page, 'build-enter-sizes')).click();
  await (await onlyVisible(page, 'zone-name')).fill('Cutting floor');
  await (await onlyVisible(page, 'zone-x0')).fill('2500');
  await (await onlyVisible(page, 'zone-y0')).fill('0');
  await (await onlyVisible(page, 'zone-width')).fill('3500');
  await (await onlyVisible(page, 'zone-depth')).fill('6000');
  await (await onlyVisible(page, 'zone-apply')).click();
  await page.locator('[data-testid="zone-select"]').waitFor({ state: 'visible' });
  await page.locator('.zone-rect').waitFor({ state: 'attached' });
  await reachable(page.locator('[data-testid="build-add-zone"]'), 'Add zone');
  await reachable(page.locator('[data-testid="build-enter-sizes"]'), 'Enter sizes');
}

async function historyCount(page) {
  return Number(await page.locator('#btn-undo').getAttribute('data-history'));
}

async function zoneJourney(page, key, { layoutOnly = false } = {}) {
  await newRoom(page);
  await shot(page, `${key}-01-created.png`);
  const phone = key.startsWith('phone') || key.startsWith('narrow');
  if (phone) {
    const primacy = await page.evaluate(() => {
      const canvas = document.querySelector('#canvas').getBoundingClientRect();
      const sheet = document.querySelector('#inspector').getBoundingClientRect();
      return {
        collapsed: document.body.classList.contains('inspector-collapsed'),
        canvas: canvas.height,
        sheet: sheet.height,
      };
    });
    if (!primacy.collapsed) fail(`${key}: details opened on their own after create`);
    if (!(primacy.canvas > primacy.sheet)) fail(`${key}: drawing is not taller than the details sheet`);
    checks.push({ step: `${key}-drawing-primary`, ...primacy, source: sourceHash['prototype/js/ui.js'] });
  }
  await reachable(page.locator('button[data-mode="build"]'), `${key} Build`);
  const order = await page.locator('#mode-rail .mode-btn').evaluateAll((els) => els.map((el) => el.dataset.mode || el.id));
  if (!(order.indexOf('draw') >= 0 && order.indexOf('draw') < order.indexOf('build'))) fail(`${key}: Build is not after Draw`);
  await page.locator('button[data-mode="select"]').click();
  await page.locator('[data-testid="zone-select"]').selectOption({ label: 'Whole floor' });
  const centre = await svgClient(page, 4250, 3000);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 48, centre.y + 12, { steps: 4 });
  const mid = await page.locator('[data-testid="zone-select"]').inputValue();
  if (mid !== '') fail(`${key}: pan pointerdown selected a zone (${mid})`);
  await page.mouse.up();
  const afterPan = await page.locator('[data-testid="zone-select"]').inputValue();
  if (afterPan !== '') fail(`${key}: a pan selected a zone`);
  await page.mouse.click(centre.x, centre.y);
  const selected = await page.locator('[data-testid="zone-select"]').inputValue();
  if (selected !== 'Z1') fail(`${key}: tap did not select Z1 (${selected})`);
  if (phone) {
    const still = await page.evaluate(() => document.body.classList.contains('inspector-collapsed'));
    if (!still) fail(`${key}: selecting a zone unfolded the phone sheet`);
  }
  await shot(page, `${key}-02-selected.png`);
  if (layoutOnly) return;
  const before = await historyCount(page);
  const handle = page.locator('[data-testid="zone-handle-e"]');
  await handle.waitFor({ state: 'attached' });
  const box = await handle.boundingBox();
  if (!box || box.width < 40 || box.height < 40) fail(`${key}: east handle hit area is under 44px`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const after = await historyCount(page);
  if (after !== before + 1) fail(`${key}: edge drag history ${before} to ${after}`);
  if (phone) {
    const toggle = page.locator('#btn-inspector-toggle');
    await toggle.waitFor({ state: 'visible' });
    await toggle.click();
  }
  const width = await (await onlyVisible(page, 'zone-width')).inputValue();
  if (width === '3500') fail(`${key}: east drag did not resize the zone`);
  await shot(page, `${key}-03-drag.png`);
  const held = await historyCount(page);
  const edge = await page.locator('[data-testid="zone-handle-e"]').boundingBox();
  const canvas = await page.locator('#canvas').boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width - 4, edge.y + edge.height / 2, { steps: 5 });
  await page.mouse.up();
  const toast = (await page.locator('[data-testid="toast"]').textContent()) || '';
  if (!toast.includes('Keep the zone inside the floor, which is 9.00 × 6.00 m.')) fail(`${key}: refusal toast was ${JSON.stringify(toast)}`);
  if (toast.startsWith('Change not applied')) fail(`${key}: refusal has an extra prefix`);
  if (await historyCount(page) !== held) fail(`${key}: refused drag added a history frame`);
  const widthAfter = await (await onlyVisible(page, 'zone-width')).inputValue();
  if (widthAfter !== width) fail(`${key}: refused drag changed the width`);
  for (const testid of ['zone-apply', 'zone-remove']) {
    await page.locator(`[data-testid="${testid}"]`).scrollIntoViewIfNeeded();
    const blocked = await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      const toast = document.querySelector('#toast');
      if (!el) return 'missing';
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 22));
      if (hit && hit !== el && !el.contains(hit)) return 'covered';
      if (toast && !toast.hidden) {
        const t = toast.getBoundingClientRect();
        const overlap = !(t.right <= r.left + 1 || r.right <= t.left + 1 || t.bottom <= r.top + 1 || r.bottom <= t.top + 1);
        if (overlap) return 'toast';
      }
      return '';
    }, testid);
    if (blocked) fail(`${key}: ${testid} is ${blocked}`);
  }
  await shot(page, `${key}-04-refused.png`);
  const tabs = await page.locator('#view-tabs button').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  if (!tabs.includes('tab-PLAN') || !tabs.includes('tab-A') || !tabs.includes('tab-C')) fail(`${key}: missing clipped faces ${tabs.join(',')}`);
  if (tabs.includes('tab-B') || tabs.includes('tab-D')) fail(`${key}: listed a wall the zone does not touch`);
  checks.push({ step: `${key}-faces`, tabs, width, source: sourceHash['prototype/js/ui.js'] });
}

async function wallClip(page) {
  // Restore the declared 2.50–6.00 m fixture after the earlier resize test.
  await page.locator('#btn-undo').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="zone-width"]')?.value === '3500');
  await page.locator('[data-testid="tab-A"]').click();
  const caption = await page.locator('[data-testid="wall-caption"]').textContent();
  if (!caption.includes('Cutting floor · Wall A · 2.50 to 6.00 m of 9.00 m')) fail(`caption ${JSON.stringify(caption)}`);
  const rulers = await page.locator('[data-testid="wall-ruler"]').allTextContents();
  if (!rulers.some((t) => t.includes('2.50')) || !rulers.some((t) => t.includes('6.00'))) fail(`ruler ${rulers.join('|')}`);
  if (await page.locator('[data-testid="wall-continues"]').count() < 1) fail('missing Wall continues');
  await page.locator('button[data-mode="place"]').click();
  const outside = await svgClient(page, 1800, 1350);
  await page.mouse.click(outside.x, outside.y);
  const refused = (await page.locator('[data-testid="toast"]').textContent()) || '';
  if (refused !== 'Place inside the part of the wall that belongs to this zone.') fail(`place toast ${JSON.stringify(refused)}`);
  const summary = await page.locator('#quote-summary').innerText();
  if (!summary.includes('No fittings yet')) fail('placement outside the clip created a fitting');
  const inside = await svgClient(page, 4000, 1350);
  await page.mouse.click(inside.x, inside.y);
  await page.locator('[data-testid="delete-fitting"]').waitFor({ state: 'visible' });
  const layersBefore = await page.locator('#btn-layers').textContent();
  await page.locator('[data-testid="zone-select"]').selectOption({ label: 'Whole floor' });
  await page.locator('[data-testid="zone-select"]').selectOption({ label: 'Cutting floor' });
  if (await page.locator('[data-testid="delete-fitting"]').count() !== 1) fail('zone scope cleared a fitting that is still on this face');
  const layersAfter = await page.locator('#btn-layers').textContent();
  if (layersBefore !== layersAfter) fail(`layers changed from ${layersBefore} to ${layersAfter}`);
  await page.locator('[data-testid="zone-select"]').selectOption({ label: 'Whole floor' });
  await page.locator('[data-testid="tab-A"]').click();
  await page.locator('button[data-mode="draw"]').click();
  const a = await svgClient(page, 400, 500);
  const b = await svgClient(page, 4000, 700);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  page.once('dialog', (dialog) => dialog.accept('Outside pin'));
  await page.locator('button[data-mode="notes"]').click();
  const pin = await svgClient(page, 500, 800);
  await page.mouse.click(pin.x, pin.y);
  await page.locator('.note-pin').waitFor({ state: 'attached' });
  await page.locator('[data-testid="zone-select"]').selectOption({ label: 'Cutting floor' });
  await page.locator('[data-testid="tab-A"]').click();
  const clip = await page.locator('.stroke').first().getAttribute('clip-path');
  const points = await page.locator('.stroke').first().getAttribute('points');
  if (!clip || !clip.includes('zone-face-clip')) fail(`sketch was not clipped (${clip})`);
  if (!points.includes('400') || !points.includes('4000')) fail('sketch points were rewritten');
  if (await page.locator('.note-pin').count() !== 0) fail('a pin outside the zone is still drawn');
  await shot(page, 'desktop-05-clip.png');
  checks.push({ step: 'desktop-clip', caption, clip, source: sourceHash['prototype/js/floor-zones.js'] });
}

async function offlineReload(page) {
  await page.locator('#save-chip', { hasText: 'Saved' }).waitFor({ timeout: 10000 });
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 });
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#btn-job-name', { hasText: 'Barber refit' }).waitFor({ timeout: 10000 });
  await shot(page, 'desktop-06-offline.png');
  checks.push({ step: 'offline-reload', job: 'Barber refit', source: sourceHash['prototype/js/jobs-v2.js'] });
}

async function mixedZeroWrite(context) {
  serveMixed = true;
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  try {
    await page.goto(baseUrl + '?mixed=1', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="mixed-build"]').waitFor({ state: 'visible' });
    const before = await page.evaluate(() => Object.keys(localStorage));
    await page.locator('[data-testid="start-sample"]').click();
    await page.locator('#btn-job-name').waitFor({ state: 'visible' });
    const opened = await page.evaluate(() => Object.keys(localStorage));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    const after = await page.evaluate(() => Object.keys(localStorage));
    const rescue = after.filter((key) => key.startsWith('surface.jobs.v2.'));
    if (rescue.length || opened.length || before.length) fail(`mixed build wrote ${after.join(',')}`);
    await shot(page, 'mixed-pagehide.png');
    checks.push({ step: 'mixed-zero-write', keys: after, source: sourceHash['prototype/js/jobs-v2.js'] });
  } finally {
    serveMixed = false;
    await page.close();
  }
}

async function runProfile(key, width, height, extra) {
  const context = await browser.newContext({
    viewport: { width, height },
    serviceWorkers: 'allow',
    hasTouch: height < 900 || width < 500,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  try {
    await zoneJourney(page, key, extra);
    if (key === 'desktop-1280x800') {
      await wallClip(page);
      await offlineReload(page);
    }
    if (key === 'tablet-768x1024') {
      await page.locator('button[data-mode="build"]').click();
      const hit = await page.evaluate(() => {
        const pal = document.querySelector('#place-palette');
        const ins = document.querySelector('#inspector');
        if (!pal || pal.hidden || !ins) return false;
        const a = pal.getBoundingClientRect();
        const b = ins.getBoundingClientRect();
        return !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1);
      });
      if (hit) fail('tablet toolbar overlaps the inspector');
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (overflow) fail(`${key}: horizontal overflow`);
    if (errors.length) fail(`${key}: console ${errors[0]}`);
  } catch (err) {
    await shot(page, `error-${key}.png`).catch(() => {});
    throw err;
  } finally {
    await context.close();
  }
}

try {
  browser = await chromium.launch({ headless: true });
  await runProfile('desktop-1280x800', 1280, 800);
  await runProfile('tablet-768x1024', 768, 1024);
  await runProfile('phone-390x844', 390, 844);
  await runProfile('narrow-360x740', 360, 740, { layoutOnly: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
  try {
    await mixedZeroWrite(context);
  } finally {
    await context.close();
  }
  fs.writeFileSync(path.join(EV, 'checks.json'), JSON.stringify({ sourceHash, checks }, null, 2));
  console.log('PASS zone correction journeys');
} catch (err) {
  exitCode = 1;
  fs.writeFileSync(path.join(EV, 'checks.json'), JSON.stringify({ sourceHash, checks, error: String(err && err.stack || err) }, null, 2));
  console.error('FAIL', err && err.stack || err);
} finally {
  clearTimeout(hard);
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
process.exit(exitCode);
