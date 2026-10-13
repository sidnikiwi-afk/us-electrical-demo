// EP-FLOOR-04 containment UI journey. NOT RUN by the file-only author.
// Serves prototype/ only. One saved job at four viewports.
// Run: node tests/floor-route-browser.mjs
// Playwright: PLAYWRIGHT_MODULE or the Office path below. No install.
// Screens and checks are written only when this file is executed, under
// .worker-output/route-ui-evidence.
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
const EV = path.join(ROOT, '.worker-output', 'route-ui-evidence');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const JOB = 'Synthetic containment';
const WARNING = "Containment isn't priced or measured in this version.";
const PROFILES = [
  { key: 'desktop-1280x800', width: 1280, height: 800, touch: false, mobile: false },
  { key: 'tablet-768x1024', width: 768, height: 1024, touch: true, mobile: false },
  { key: 'phone-390x844', width: 390, height: 844, touch: true, mobile: true },
  { key: 'narrow-360x740', width: 360, height: 740, touch: true, mobile: true },
];

fs.mkdirSync(EV, { recursive: true });

function hashFile(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const sourceHash = {
  'prototype/js/ui.js': hashFile('prototype/js/ui.js'),
  'prototype/js/core.js': hashFile('prototype/js/core.js'),
  'prototype/js/floor-routes.js': hashFile('prototype/js/floor-routes.js'),
  'prototype/js/floor-walls.js': hashFile('prototype/js/floor-walls.js'),
  'prototype/js/floor-zones.js': hashFile('prototype/js/floor-zones.js'),
  'prototype/js/jobs-v2.js': hashFile('prototype/js/jobs-v2.js'),
  'prototype/sw.js': hashFile('prototype/sw.js'),
};
fs.writeFileSync(path.join(EV, 'source-hash.json'), JSON.stringify(sourceHash, null, 2));

function fail(message) {
  const err = new Error(message);
  err.expectedRed = false;
  throw err;
}

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
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const baseUrl = `http://127.0.0.1:${server.address().port}/index.html`;

let browser;
let exitCode = 0;
const summary = [];
const hard = setTimeout(() => {
  console.error('FAIL - global timeout');
  Promise.resolve(browser && browser.close()).finally(() => {
    server.close();
    process.exit(1);
  });
}, 300000);

function visible(page, testid) {
  return page.locator(testid.startsWith('mode-') ? `button[data-mode="${testid.slice(5)}"]:visible` : `[data-testid="${testid}"]:visible`);
}

async function onlyVisible(page, testid) {
  const loc = visible(page, testid);
  try {
    await loc.first().waitFor({ state: 'visible' });
  } catch {
    fail(`missing feature: [data-testid=${testid}] is not visible`);
  }
  const n = await loc.count();
  if (n !== 1) fail(`${testid}: expected 1 visible control, found ${n}`);
  return loc;
}

async function press(locator, touch) {
  await locator.scrollIntoViewIfNeeded();
  if (touch) await locator.tap();
  else await locator.click();
}

async function reachable(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const problem = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return 'not displayed';
    if (r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) {
      return `clipped ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} in ${innerWidth}x${innerHeight}`;
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && (hit === el || el.contains(hit))) return null;
    const id = hit ? hit.tagName.toLowerCase() + (hit.id ? `#${hit.id}` : '') : 'nothing';
    return `covered by ${id}`;
  });
  if (problem) fail(`${label}: ${problem}`);
}

async function assertNoOverflow(page, label) {
  const problem = await page.evaluate(() => {
    const width = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    return width <= window.innerWidth + 1
      ? null
      : `scrollWidth ${width} innerWidth ${window.innerWidth}`;
  });
  if (problem) fail(`${label}: horizontal overflow ${problem}`);
}

async function shot(page, dir, name) {
  await page.screenshot({ path: path.join(dir, name) });
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

async function planClick(page, x, y) {
  const p = await svgClient(page, x, y);
  await page.mouse.click(p.x, p.y);
}

async function canvasSpot(page) {
  return page.evaluate(() => {
    const r = document.querySelector('#canvas').getBoundingClientRect();
    const app = document.querySelector('#app');
    return { x: Math.round(r.x), y: Math.round(r.y), appScroll: app ? app.scrollLeft + ',' + app.scrollTop : null, page: window.scrollX + ',' + window.scrollY };
  });
}

async function historyCount(page) {
  return Number(await page.locator('#btn-undo').getAttribute('data-history'));
}

async function waitToast(page, needle) {
  await page.waitForFunction((expected) => {
    const toast = document.querySelector('[data-testid="toast"]');
    return !!(toast && !toast.hidden && (toast.textContent || '').includes(expected));
  }, needle);
}

async function assertToastClearsSaveChip(page) {
  const problem = await page.evaluate(() => {
    const toast = document.querySelector('[data-testid="toast"]');
    const chip = document.querySelector('#save-chip');
    if (!toast || toast.hidden || !chip) return 'toast or save chip missing';
    const a = toast.getBoundingClientRect();
    const b = chip.getBoundingClientRect();
    const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    if (overlap) return 'toast covers save chip';
    const bar = document.querySelector('#topbar');
    if (!bar) return 'top bar missing';
    const top = bar.getBoundingClientRect();
    if (a.top < top.bottom - 1) return 'toast overlaps top bar';
    return null;
  });
  if (problem) fail(problem);
}

async function ensureDetails(page, touch, testid) {
  const field = page.locator(`#inspector [data-testid="${testid}"]`);
  if (await field.count() && await field.first().isVisible()) return field;
  const show = page.getByRole('button', { name: 'Show details', exact: true });
  await press(show, touch);
  await field.first().waitFor({ state: 'visible' });
  return field;
}

async function foldDetails(page, touch) {
  const hide = page.getByRole('button', { name: 'Hide details', exact: true });
  if (await hide.count() && await hide.first().isVisible()) await press(hide.first(), touch);
}

async function downloadFromMenu(page, touch, label) {
  await press(page.getByRole('button', { name: 'Menu', exact: true }), touch);
  const item = page.locator('#modal-root').getByRole('button', { name: label, exact: true });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    press(item, touch),
  ]);
  return fs.readFileSync(await download.path(), 'utf8');
}

function routeById(job, id) {
  const route = ((job.floor && job.floor.routes) || []).find((r) => r.id === id);
  if (!route) fail(`backup has no ${id}`);
  return route;
}

async function createJob(page, touch) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.jobsBoot === 'ready');
  await press(await onlyVisible(page, 'start-blank'), touch);
  await (await onlyVisible(page, 'newjob-name')).fill(JOB);
  await (await onlyVisible(page, 'room-widthM')).fill('9');
  await (await onlyVisible(page, 'room-depthM')).fill('6');
  await (await onlyVisible(page, 'room-heightM')).fill('2.7');
  await press(await onlyVisible(page, 'room-save'), touch);
  await page.waitForFunction((name) => {
    const app = document.querySelector('#app');
    const button = document.querySelector('#btn-job-name');
    return app && !app.hidden && button && button.textContent === name;
  }, JOB);
  await page.waitForFunction(() => {
    const chip = String((document.querySelector('[data-testid="save-chip"]') || {}).textContent || '').trim();
    return chip === 'Saved on this device' || chip.startsWith('Saved on this device · ');
  });
}

async function lineEnds(page, testid, index) {
  return page.locator(`[data-testid="${testid}"] line`).nth(index).evaluate((el) => ({
    x1: Number(el.getAttribute('x1')),
    y1: Number(el.getAttribute('y1')),
    x2: Number(el.getAttribute('x2')),
    y2: Number(el.getAttribute('y2')),
    stroke: el.getAttribute('stroke'),
    dash: el.getAttribute('stroke-dasharray'),
  }));
}

async function runProfile(browserHandle, prof) {
  const dir = path.join(EV, prof.key);
  fs.mkdirSync(dir, { recursive: true });
  const context = await browserHandle.newContext({
    viewport: { width: prof.width, height: prof.height },
    hasTouch: prof.touch,
    isMobile: prof.mobile,
    acceptDownloads: true,
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const consoleErrors = [];
  const external = [];
  const steps = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('request', (req) => {
    let url;
    try { url = new URL(req.url()); } catch { return; }
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1') external.push(req.url());
  });
  const record = { key: prof.key, pass: false, steps };
  try {
    await createJob(page, prof.touch);
    const quoteBefore = await page.locator('#quote-summary').innerText();
    if (!quoteBefore.includes('No fittings yet')) fail(`quote before routes ${JSON.stringify(quoteBefore)}`);
    const rail = await page.locator('#mode-rail .mode-btn').evaluateAll((els) => els.map((el) => el.dataset.mode || el.id));
    const drawAt = rail.indexOf('draw');
    const buildAt = rail.indexOf('build');
    if (drawAt < 0 || buildAt !== drawAt + 1) fail(`Build is not immediately after Draw: ${rail.join(',')}`);
    const tops = await page.locator('#mode-rail .mode-btn').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    if (prof.width < 600 && !tops.every((top) => Math.abs(top - tops[0]) <= 2)) fail(`mode buttons are not one row: ${tops.join(',')}`);
    await assertNoOverflow(page, 'blank job');
    steps.push('job-and-rail');
    await shot(page, dir, '01-job.png');

    await press(await onlyVisible(page, 'mode-build'), prof.touch);
    await press(await onlyVisible(page, 'build-add-wall'), prof.touch);
    await press(await onlyVisible(page, 'build-enter-sizes'), prof.touch);
    await page.locator('#modal-root [data-testid="wall-axis"]').waitFor({ state: 'visible' });
    await page.locator('#modal-root [data-testid="wall-line"]').fill('3000');
    await page.locator('#modal-root [data-testid="wall-start"]').fill('2000');
    await page.locator('#modal-root [data-testid="wall-end"]').fill('7000');
    await press(await onlyVisible(page, 'wall-add'), prof.touch);
    await waitToast(page, 'Added W1, 5.00 m long. Undo removes it.');
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    await page.locator('[data-testid="wall-W1"]').waitFor({ state: 'attached' });
    if (prof.width < 600) {
      const row = page.locator('#view-tabs .face-row.faces-scroll');
      if (await row.count() !== 1) fail('phone did not put the faces in one scrolling row');
    }
    steps.push('numeric-wall');

    await press(page.locator('[data-testid="tab-W1.N"]'), prof.touch);
    if (prof.width < 600) {
      const active = await page.locator('[data-testid="tab-W1.N"]').boundingBox();
      if (!active || active.x < -1 || active.x + active.width > prof.width + 1) fail('active face tab is off screen');
    }
    const northCaption = await page.locator('[data-testid="wall-caption"]').textContent();
    if (!northCaption || !northCaption.includes('W1 north side')) fail(`north caption ${JSON.stringify(northCaption)}`);
    await reachable(await onlyVisible(page, 'build-add-trunking'), 'Add trunking');
    await reachable(await onlyVisible(page, 'build-add-conduit'), 'Add conduit');
    const beforePoint = await historyCount(page);
    const viewBox = await page.locator('#canvas').getAttribute('viewBox');
    await press(await onlyVisible(page, 'build-add-trunking'), prof.touch);
    const spot = JSON.stringify(await canvasSpot(page));
    await planClick(page, 1000, 1500);
    if (JSON.stringify(await canvasSpot(page)) !== spot) fail(`first tap moved the drawing on screen ${spot} -> ${JSON.stringify(await canvasSpot(page))}`);
    if (await historyCount(page) !== beforePoint) fail('first trunking tap changed history');
    if (await page.locator('[data-testid="route-R1"]').count() !== 0) fail('first tap stored a run');
    if (await page.locator('#canvas').getAttribute('viewBox') !== viewBox) fail('first tap moved the drawing');
    await page.keyboard.press('Escape');
    await planClick(page, 2500, 1500);
    if (await page.locator('[data-testid="route-R1"]').count() !== 0) fail('Escape kept a first point that became a run');
    await page.keyboard.press('Escape');
    await planClick(page, 1000, 1500);
    if (await page.locator('#canvas').getAttribute('viewBox') !== viewBox) fail('drawing moved between taps');
    if (JSON.stringify(await canvasSpot(page)) !== spot) fail('drawing moved on screen between taps');
    await planClick(page, 2500, 1500);
    await waitToast(page, 'Added T1. Undo removes it.');
    await page.locator('[data-testid="route-R1"]').waitFor({ state: 'attached' });
    const faceLine = await lineEnds(page, 'route-R1', 1);
    if (faceLine.stroke !== '#7a5200' || faceLine.y1 !== 1500 || faceLine.y2 !== 1500) fail(`face trunking ${JSON.stringify(faceLine)}`);
    const xs = [faceLine.x1, faceLine.x2].sort((a, b) => a - b);
    if (xs[0] !== 1000 || xs[1] !== 2500) fail(`face trunking span ${JSON.stringify(faceLine)}`);
    steps.push('two-tap-trunking');
    await shot(page, dir, '02-trunking.png');

    await press(page.locator('[data-testid="tab-W1.S"]'), prof.touch);
    await press(await onlyVisible(page, 'build-enter-sizes'), prof.touch);
    await page.locator('#modal-root [data-testid="route-type"]').waitFor({ state: 'visible' });
    if (await page.locator('#modal-root [data-testid="wall-axis"]').count()) fail('Enter sizes opened the wall form on a face');
    await page.locator('#modal-root [data-testid="route-type"]').selectOption('conduit');
    await page.locator('#modal-root [data-testid="route-start"]').fill('500');
    await page.locator('#modal-root [data-testid="route-end"]').fill('2000');
    await page.locator('#modal-root [data-testid="route-height"]').fill('450');
    await page.locator('#modal-root [data-testid="route-notes"]').fill('South run');
    await press(page.locator('#modal-root [data-testid="route-add"]'), prof.touch);
    await waitToast(page, 'Added C2. Undo removes it.');
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    const quoteAfter = await page.locator('#quote-summary').innerText();
    if (quoteAfter !== quoteBefore) fail(`routes changed the quote from ${JSON.stringify(quoteBefore)} to ${JSON.stringify(quoteAfter)}`);
    await press(page.locator('[data-testid="tab-PLAN"]'), prof.touch);
    const northPlan = await lineEnds(page, 'route-R1', 1);
    const southPlan = await lineEnds(page, 'route-R2', 1);
    const northXs = [northPlan.x1, northPlan.x2].sort((a, b) => a - b);
    const southXs = [southPlan.x1, southPlan.x2].sort((a, b) => a - b);
    if (northXs[0] !== 4500 || northXs[1] !== 6000 || northPlan.y1 !== 2880 || northPlan.y2 !== 2880) fail(`plan north ${JSON.stringify(northPlan)}`);
    if (southPlan.stroke !== '#1d5fa8' || southPlan.dash !== '90 50') fail(`plan south style ${JSON.stringify(southPlan)}`);
    if (southXs[0] !== 2500 || southXs[1] !== 4000 || southPlan.y1 !== 3120 || southPlan.y2 !== 3120) fail(`plan south ${JSON.stringify(southPlan)}`);
    steps.push('numeric-conduit-and-plan');
    await shot(page, dir, '03-both-faces.png');

    await press(await onlyVisible(page, 'mode-select'), prof.touch);
    await press(page.locator('[data-testid="tab-W1.N"]'), prof.touch);
    await planClick(page, 1750, 1500);
    const type = await ensureDetails(page, prof.touch, 'route-type');
    await type.selectOption('conduit');
    await press(page.locator('#inspector [data-testid="route-apply"]'), prof.touch);
    await waitToast(page, 'Updated C1.');
    const warning = await page.locator('#inspector [data-testid="containment-warning"]').innerText();
    if (warning !== WARNING) fail(`inspector warning ${JSON.stringify(warning)}`);
    if ((await page.locator('#inspector h2').innerText()) !== 'C1') fail('type switch changed the displayed number');
    await press(visible(page, 'undo'), prof.touch);
    await press(visible(page, 'redo'), prof.touch);
    await planClick(page, 1750, 1500);
    if (prof.width < 600) await foldDetails(page, prof.touch);
    const handle = page.locator('[data-testid="route-handle-end"]');
    await handle.waitFor({ state: 'attached' });
    await page.waitForFunction(() => {
      const r = document.querySelector('[data-testid="route-handle-end"]')?.getBoundingClientRect();
      return r && r.width >= 43 && r.height >= 43;
    });
    const handleBox = await handle.boundingBox();
    if (!handleBox || handleBox.width < 43 || handleBox.height < 43) fail(`handle is ${handleBox ? Math.round(handleBox.width) : 0} px`);
    const beforeDrag = await historyCount(page);
    const from = await handle.boundingBox();
    const to = await svgClient(page, 3000, 1500);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction((n) => Number(document.querySelector('#btn-undo')?.getAttribute('data-history')) === n, beforeDrag + 1);
    if (await historyCount(page) !== beforeDrag + 1) fail('handle drag did not add one history step');
    steps.push('type-undo-redo-drag');

    const beforeShort = await historyCount(page);
    const end = await ensureDetails(page, prof.touch, 'route-end');
    const storedEnd = await end.inputValue();
    await end.fill('1020');
    await press(page.locator('#inspector [data-testid="route-apply"]'), prof.touch);
    await waitToast(page, 'A run must be at least 50 mm long.');
    if (prof.key.startsWith('phone') || prof.key.startsWith('narrow')) await assertToastClearsSaveChip(page);
    if (await historyCount(page) !== beforeShort) fail('short edit added a history frame');
    if ((await page.locator('#inspector [data-testid="route-end"]').inputValue()) !== storedEnd) fail('short edit kept the refused end');

    await press(page.locator('[data-testid="tab-PLAN"]'), prof.touch);
    await press(await onlyVisible(page, 'mode-build'), prof.touch);
    await press(await onlyVisible(page, 'build-add-zone'), prof.touch);
    await press(await onlyVisible(page, 'build-enter-sizes'), prof.touch);
    await page.locator('#modal-root [data-testid="zone-name"]').fill('Bay');
    await page.locator('#modal-root [data-testid="zone-x0"]').fill('3000');
    await page.locator('#modal-root [data-testid="zone-y0"]').fill('0');
    await page.locator('#modal-root [data-testid="zone-width"]').fill('3000');
    await page.locator('#modal-root [data-testid="zone-depth"]').fill('6000');
    await press(page.locator('#modal-root [data-testid="zone-apply"]'), prof.touch);
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    await press(page.locator('[data-testid="tab-W1.N"]'), prof.touch);
    const clipCaption = await page.locator('[data-testid="wall-caption"]').textContent();
    if (!clipCaption || !clipCaption.includes('1.00 to 4.00 m')) fail(`clip caption ${JSON.stringify(clipCaption)}`);
    await press(await onlyVisible(page, 'mode-select'), prof.touch);
    await planClick(page, 1750, 1500);
    const beforeClip = await historyCount(page);
    const clipEnd = await ensureDetails(page, prof.touch, 'route-end');
    const clipStored = await clipEnd.inputValue();
    await clipEnd.fill('4500');
    await press(page.locator('#inspector [data-testid="route-apply"]'), prof.touch);
    await waitToast(page, 'Keep both ends inside the part of the wall that belongs to this zone.');
    if (await historyCount(page) !== beforeClip) fail('out-of-clip edit added a history frame');
    if ((await page.locator('#inspector [data-testid="route-end"]').inputValue()) !== clipStored) fail('out-of-clip edit kept the refused end');
    steps.push('refused-short-and-clip');
    await shot(page, dir, '04-refused.png');

    await page.locator('[data-testid="zone-select"]').selectOption({ label: 'Whole floor' });
    await press(page.locator('[data-testid="tab-PLAN"]'), prof.touch);
    await planClick(page, 6900, 3000);
    const beforeStrand = await historyCount(page);
    const wallEnd = await ensureDetails(page, prof.touch, 'wall-end');
    await wallEnd.fill('3200');
    await press(page.locator('#inspector [data-testid="wall-apply"]'), prof.touch);
    await page.locator('#modal-root h2', { hasText: 'Keep the wall longer' }).waitFor();
    const strandBody = await page.locator('#modal-root p').innerText();
    if (!strandBody.includes('route')) fail(`shorten body ${JSON.stringify(strandBody)}`);
    await press(await onlyVisible(page, 'wall-remove-close'), prof.touch);
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    if (await historyCount(page) !== beforeStrand) fail('refused shorten added a history frame');
    if ((await page.locator('#inspector [data-testid="wall-end"]').inputValue()) !== '7000') fail('refused shorten left the end field changed');
    const extend = await ensureDetails(page, prof.touch, 'wall-end');
    await extend.fill('7500');
    await press(page.locator('#inspector [data-testid="wall-apply"]'), prof.touch);
    await waitToast(page, 'Updated W1.');
    const extended = JSON.parse(await downloadFromMenu(page, prof.touch, 'Download backup (JSON)'));
    const north = routeById(extended, 'R1');
    const south = routeById(extended, 'R2');
    if (north.face !== 'N' || north.type !== 'conduit' || north.startMm !== 1500 || north.endMm !== 3500 || north.id !== 'R1') fail(`extended north ${JSON.stringify(north)}`);
    if (south.face !== 'S' || south.startMm !== 500 || south.endMm !== 2000 || south.notes !== 'South run') fail(`extended south ${JSON.stringify(south)}`);
    if (extended.floor.nextRouteNo !== 3) fail(`nextRouteNo ${extended.floor.nextRouteNo}`);
    const beforeRemove = await historyCount(page);
    await press(page.locator('#inspector [data-testid="wall-remove"]'), prof.touch);
    await page.locator('#modal-root h2', { hasText: 'W1 can\u2019t be removed yet' }).waitFor();
    const removeBody = await page.locator('#modal-root p').innerText();
    if (!removeBody.includes('route')) fail(`remove body ${JSON.stringify(removeBody)}`);
    await press(await onlyVisible(page, 'wall-remove-close'), prof.touch);
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    if (await historyCount(page) !== beforeRemove) fail('refused remove added a history frame');
    if (await page.locator('[data-testid="wall-W1"]').count() !== 1) fail('refused remove dropped W1');
    steps.push('remap-and-remove');

    const quoteMid = await page.locator('#quote-summary').innerText();
    await press(page.locator('#btn-layers'), prof.touch);
    const layerWarning = await page.locator('#layers-panel [data-testid="containment-warning"]').innerText();
    if (layerWarning !== WARNING) fail(`layers warning ${JSON.stringify(layerWarning)}`);
    const trunkCount = await page.locator('[data-testid="containment-trunking"]').locator('xpath=..').innerText();
    const conduitCount = await page.locator('[data-testid="containment-conduit"]').locator('xpath=..').innerText();
    if (!trunkCount.includes('Trunking (0)') || !conduitCount.includes('Conduit (2)')) fail(`layer counts ${trunkCount} / ${conduitCount}`);
    await page.locator('[data-testid="containment-conduit"]').uncheck();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="route-R1"], [data-testid="route-R2"]').length === 0);
    if ((await page.locator('#quote-summary').innerText()) !== quoteMid) fail('hiding containment changed the quote');
    if (await page.locator('#inspector [data-testid="route-type"]').count() !== 0) fail('hidden run stayed selected');
    await page.locator('[data-testid="containment-conduit"]').check();
    await page.locator('[data-testid="route-R1"]').waitFor({ state: 'attached' });
    await press(page.locator('#btn-layers'), prof.touch);
    steps.push('visibility');

    await press(page.locator('[data-testid="tab-W1.S"]'), prof.touch);
    await planClick(page, 1250, 2250);
    await press(await ensureDetails(page, prof.touch, 'route-remove'), prof.touch);
    await waitToast(page, 'Removed C2. Undo brings it back.');
    await press(visible(page, 'undo'), prof.touch);
    await page.locator('[data-testid="route-R2"]').waitFor({ state: 'attached' });
    await press(visible(page, 'redo'), prof.touch);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="route-R2"]').length === 0);
    await press(page.locator('[data-testid="tab-W1.N"]'), prof.touch);
    await press(await onlyVisible(page, 'mode-build'), prof.touch);
    await press(await onlyVisible(page, 'build-enter-sizes'), prof.touch);
    await page.locator('#modal-root [data-testid="route-start"]').fill('100');
    await page.locator('#modal-root [data-testid="route-end"]').fill('600');
    await page.locator('#modal-root [data-testid="route-height"]').fill('200');
    await press(page.locator('#modal-root [data-testid="route-add"]'), prof.touch);
    await waitToast(page, 'Added T3. Undo removes it.');
    steps.push('remove-undo-redo-id');

    await page.waitForFunction(() => {
      const chip = String((document.querySelector('[data-testid="save-chip"]') || {}).textContent || '').trim();
      const saved = chip === 'Saved on this device' || chip.startsWith('Saved on this device · ');
      if (!saved) return false;
      const keys = Object.keys(localStorage).filter((key) => key.startsWith('surface.jobs.v2.job.'));
      if (keys.length !== 1) return false;
      const env = JSON.parse(localStorage.getItem(keys[0]));
      const routes = env && env.job && env.job.floor && env.job.floor.routes;
      return Array.isArray(routes) && routes.some((route) => route.id === 'R1') && routes.some((route) => route.id === 'R3')
        && env.writeRev >= 1 && env.job.revision >= 1;
    });
    const saved = JSON.parse(await downloadFromMenu(page, prof.touch, 'Download backup (JSON)'));
    fs.writeFileSync(path.join(dir, 'backup-saved.json'), JSON.stringify(saved, null, 2));
    if (!saved.floor || saved.schemaVersion !== 2) fail('backup is not one schema 2 job');
    const savedFloor = JSON.stringify(saved.floor);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.jobsBoot === 'ready');
    await page.waitForFunction((name) => document.querySelector('#btn-job-name')?.textContent === name, JOB);
    await page.waitForFunction(() => {
      const chip = String((document.querySelector('[data-testid="save-chip"]') || {}).textContent || '').trim();
      return chip === 'Saved on this device' || chip.startsWith('Saved on this device · ');
    });
    await page.locator('[data-testid="route-R1"]').waitFor({ state: 'attached' });
    const reopened = JSON.parse(await downloadFromMenu(page, prof.touch, 'Download backup (JSON)'));
    fs.writeFileSync(path.join(dir, 'backup-reopened.json'), JSON.stringify(reopened, null, 2));
    if (JSON.stringify(reopened.floor) !== savedFloor) fail('reopen did not keep the floor routes');
    const archive = JSON.parse(await downloadFromMenu(page, prof.touch, 'Download all jobs'));
    if (!archive.entries || archive.entries.length !== 1) fail(`archive entries ${archive.entries && archive.entries.length}`);
    if (JSON.stringify(archive.entries[0].job.floor.routes) !== JSON.stringify(saved.floor.routes)) fail('archive dropped routes');
    const csv = await downloadFromMenu(page, prof.touch, 'Download CSV');
    if (/trunking|conduit|\bR1\b|\bR2\b|\bR3\b/i.test(csv)) fail(`csv mentioned containment ${csv.slice(0, 240)}`);
    await assertNoOverflow(page, 'journey end');
    await press(await onlyVisible(page, 'mode-build'), prof.touch);
    await reachable(await onlyVisible(page, 'build-add-wall'), 'Add wall');
    steps.push('save-reopen-backup-archive');
    await shot(page, dir, '05-reopened.png');

    if (consoleErrors.length) fail(`console errors: ${consoleErrors.join(' | ')}`);
    if (external.length) fail(`external requests: ${external.join(' | ')}`);
    record.pass = true;
    console.log(`ok - ${prof.key}`);
  } catch (err) {
    record.pass = false;
    record.error = String(err && err.stack ? err.stack : err);
    try { await shot(page, dir, 'failure.png'); } catch { /* page may already be gone */ }
    console.error(`FAIL - ${prof.key}: ${record.error}`);
  } finally {
    record.consoleErrors = consoleErrors;
    record.external = external;
    record.source = sourceHash;
    fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify(record, null, 2));
    await context.close();
  }
  return record;
}

try {
  browser = await chromium.launch();
  const only = process.env.ROUTE_PROFILE;
  for (const prof of PROFILES.filter((p) => !only || p.key === only)) summary.push(await runProfile(browser, prof));
  fs.writeFileSync(path.join(EV, 'summary.json'), JSON.stringify({ profiles: summary, source: sourceHash }, null, 2));
  if (summary.some((row) => !row.pass)) exitCode = 1;
} catch (err) {
  console.error(`FAIL - ${err && err.message ? err.message : err}`);
  exitCode = 1;
} finally {
  clearTimeout(hard);
  try { if (browser) await browser.close(); } catch { /* already closed */ }
  await new Promise((resolve) => server.close(resolve));
  process.exit(exitCode);
}
