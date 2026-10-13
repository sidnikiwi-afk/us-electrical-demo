// EP-FLOOR-03 wall and fitting UI journey. NOT RUN by the file-only author.
// Serves prototype/ only. One saved job at four viewports.
// Run: node tests/floor-wall-browser.mjs
// Playwright: PLAYWRIGHT_MODULE or the Office path below. No install.
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
const EV = path.join(ROOT, '.worker-output', 'wall-ui-evidence');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const JOB = 'Barber refit';
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
  'prototype/js/floor-zones.js': hashFile('prototype/js/floor-zones.js'),
  'prototype/js/floor-walls.js': hashFile('prototype/js/floor-walls.js'),
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
}, 240000);

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

async function historyCount(page) {
  return Number(await page.locator('#btn-undo').getAttribute('data-history'));
}

async function waitToast(page, needle) {
  await page.waitForFunction((expected) => {
    const toast = document.querySelector('[data-testid="toast"]');
    return !!(toast && !toast.hidden && (toast.textContent || '').includes(expected));
  }, needle);
}

async function assertFaceTextClear(page, label) {
  const problem = await page.evaluate(() => {
    const texts = [];
    const take = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { kind: el.getAttribute('data-testid'), x: r.left, y: r.top, r: r.right, b: r.bottom };
    };
    document.querySelectorAll('[data-testid="wall-caption"], [data-testid="wall-ruler"], [data-testid="wall-continues"]').forEach((el) => {
      const box = take(el);
      if (box) texts.push(box);
    });
    if (!texts.some((box) => box.kind === 'wall-caption')) return 'caption missing';
    if (!texts.some((box) => box.kind === 'wall-ruler')) return 'dimension labels missing';
    const controls = [];
    for (const sel of ['#layers-control', '#zoom-controls']) {
      const el = document.querySelector(sel);
      if (!el) return `${sel} missing`;
      const box = take(el);
      if (!box) return `${sel} not shown`;
      box.kind = sel;
      controls.push(box);
    }
    const hit = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        if (hit(texts[i], texts[j])) return `${texts[i].kind} overlaps ${texts[j].kind}`;
      }
      for (const control of controls) {
        if (hit(texts[i], control)) return `${texts[i].kind} overlaps ${control.kind}`;
      }
    }
    return null;
  });
  if (problem) fail(`${label}: ${problem}`);
}

async function tabIds(page) {
  return page.locator('#view-tabs button').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
}

async function ensureDetails(page, touch, testid) {
  const field = page.locator(`#inspector [data-testid="${testid}"]`);
  if (await field.count() && await field.first().isVisible()) return field;
  const show = page.getByRole('button', { name: 'Show details', exact: true });
  await press(show, touch);
  await field.first().waitFor({ state: 'visible' });
  return field;
}

async function downloadBackup(page, touch) {
  await press(page.getByRole('button', { name: 'Menu', exact: true }), touch);
  const item = page.locator('#modal-root').getByRole('button', { name: 'Download backup (JSON)', exact: true });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    press(item, touch),
  ]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  return JSON.parse(text);
}

function kept(job) {
  return {
    rates: job.rates,
    items: job.items,
    floor: job.floor,
    annotations: job.annotations || null,
    notePins: job.notePins || null,
  };
}

function itemById(job, id) {
  const item = (job.items || []).find((it) => it.id === id);
  if (!item) fail(`backup has no ${id}`);
  return item;
}

function wallById(job, id) {
  const wall = ((job.floor && job.floor.walls) || []).find((w) => w.id === id);
  if (!wall) fail(`backup has no ${id}`);
  return wall;
}

function planY(wall, item) {
  if (item.face === 'W') return wall.y1 + item.fromLeftMm;
  if (item.face === 'E') return wall.y2 - item.fromLeftMm;
  fail(`${item.id} face ${item.face} is not E or W`);
  return null;
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
  await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('[data-testid="save-chip"]')?.textContent || ''));
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
    const axis = page.locator('#modal-root [data-testid="wall-axis"]');
    await axis.waitFor({ state: 'visible' });
    await axis.selectOption('vertical');
    await page.locator('#modal-root [data-testid="wall-line"]').fill('6000');
    await page.locator('#modal-root [data-testid="wall-start"]').fill('0');
    await page.locator('#modal-root [data-testid="wall-end"]').fill('6000');
    await press(await onlyVisible(page, 'wall-add'), prof.touch);
    await waitToast(page, 'Added W1, 6.00 m long. Undo removes it.');
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    await page.locator('[data-testid="wall-W1"]').waitFor({ state: 'attached' });
    const wholeTabs = await tabIds(page);
    if (!wholeTabs.includes('tab-W1.E') || !wholeTabs.includes('tab-W1.W')) fail(`whole floor tabs ${wholeTabs.join(',')}`);
    if (prof.width <= 600) {
      const row = page.locator('#view-tabs .face-row.faces-scroll');
      if (await row.count() !== 1) fail('phone did not put more than 5 faces in one scrolling row');
      await press(page.locator('[data-testid="tab-W1.W"]'), prof.touch);
      const active = await page.locator('[data-testid="tab-W1.W"]').boundingBox();
      if (!active || active.x < -1 || active.x + active.width > prof.width + 1) fail('active face tab is off screen');
      const caption = await page.locator('[data-testid="wall-caption"]').textContent();
      if (!caption || !caption.includes('W1 west side')) fail(`whole-floor caption ${JSON.stringify(caption)}`);
      await press(page.locator('[data-testid="tab-PLAN"]'), prof.touch);
    }
    steps.push('numeric-wall');
    await shot(page, dir, '02-wall-created.png');

    await press(await onlyVisible(page, 'mode-place'), prof.touch);
    await press(await onlyVisible(page, 'pal-surface'), prof.touch);
    await planClick(page, 5800, 1000);
    await waitToast(page, 'F1 placed on W1 west side');
    await planClick(page, 6200, 1000);
    await waitToast(page, 'F2 placed on W1 east side');
    const placed = await downloadBackup(page, prof.touch);
    fs.writeFileSync(path.join(dir, 'backup-placed.json'), JSON.stringify(placed, null, 2));
    const w1 = wallById(placed, 'W1');
    if (w1.x1 !== 6000 || w1.x2 !== 6000 || w1.y1 !== 0 || w1.y2 !== 6000) fail(`W1 geometry ${JSON.stringify(w1)}`);
    const west = itemById(placed, 'F1');
    const east = itemById(placed, 'F2');
    if (west.wall !== 'W1' || west.face !== 'W' || west.fromLeftMm !== 1000) fail(`west fitting ${JSON.stringify(west)}`);
    if (east.wall !== 'W1' || east.face !== 'E' || east.fromLeftMm !== 5000) fail(`east fitting ${JSON.stringify(east)}`);
    if (Object.prototype.hasOwnProperty.call(west, 'face') === false) fail('west fitting stored no face');
    steps.push('mirrored-faces');
    await shot(page, dir, '03-fittings.png');

    await press(await onlyVisible(page, 'mode-select'), prof.touch);
    await planClick(page, 6000, 3000);
    await page.locator('[data-testid="wall-handle-start"]').waitFor({ state: 'attached' });
    const start = await ensureDetails(page, prof.touch, 'wall-start');
    await start.fill('500');
    await press(page.locator('#inspector [data-testid="wall-apply"]'), prof.touch);
    await waitToast(page, 'Updated W1.');
    const extended = await downloadBackup(page, prof.touch);
    fs.writeFileSync(path.join(dir, 'backup-extended.json'), JSON.stringify(extended, null, 2));
    const moved = wallById(extended, 'W1');
    const west2 = itemById(extended, 'F1');
    const east2 = itemById(extended, 'F2');
    if (moved.y1 !== 500 || moved.y2 !== 6000 || moved.x1 !== 6000) fail(`extended wall ${JSON.stringify(moved)}`);
    if (west2.face !== 'W' || west2.fromLeftMm !== 500) fail(`west after extend ${JSON.stringify(west2)}`);
    if (east2.face !== 'E' || east2.fromLeftMm !== 5000) fail(`east after extend ${JSON.stringify(east2)}`);
    if (planY(moved, west2) !== 1000 || planY(moved, east2) !== 1000) fail('extend did not keep plan y 1000');
    steps.push('extend-keeps-plan');

    const beforeRefuse = await historyCount(page);
    const beforeCanon = JSON.stringify(kept(extended));
    const end = await ensureDetails(page, prof.touch, 'wall-end');
    await end.fill('800');
    await press(page.locator('#inspector [data-testid="wall-apply"]'), prof.touch);
    await page.locator('#modal-root h2', { hasText: 'Keep the wall longer' }).waitFor();
    const shortenBody = await page.locator('#modal-root p').innerText();
    if (!shortenBody.includes('F1') || !shortenBody.includes('F2')) fail(`shorten body ${JSON.stringify(shortenBody)}`);
    await press(await onlyVisible(page, 'wall-remove-close'), prof.touch);
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    if (await historyCount(page) !== beforeRefuse) fail('refused shorten added a history frame');
    if ((await page.locator('#inspector [data-testid="wall-end"]').inputValue()) !== '6000') fail('refused shorten left the end field changed');
    const afterShort = await downloadBackup(page, prof.touch);
    if (JSON.stringify(kept(afterShort)) !== beforeCanon) fail('refused shorten changed the job');

    await press(page.locator('#inspector [data-testid="wall-remove"]'), prof.touch);
    await page.locator('#modal-root h2', { hasText: 'W1 can\u2019t be removed yet' }).waitFor();
    const removeBody = await page.locator('#modal-root p').innerText();
    if (!/fitting/.test(removeBody)) fail(`remove body ${JSON.stringify(removeBody)}`);
    await press(await onlyVisible(page, 'wall-remove-close'), prof.touch);
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    if (await historyCount(page) !== beforeRefuse) fail('refused remove added a history frame');
    const afterRemove = await downloadBackup(page, prof.touch);
    if (JSON.stringify(kept(afterRemove)) !== beforeCanon) fail('refused remove changed the job');
    if (await page.locator('[data-testid="wall-W1"]').count() !== 1) fail('refused remove dropped W1');
    steps.push('refused-shorten-and-remove');
    await shot(page, dir, '04-refused.png');

    await press(visible(page, 'undo'), prof.touch);
    const undone = await downloadBackup(page, prof.touch);
    const back = wallById(undone, 'W1');
    const uWest = itemById(undone, 'F1');
    const uEast = itemById(undone, 'F2');
    if (back.y1 !== 0 || back.y2 !== 6000 || back.id !== 'W1') fail(`undo wall ${JSON.stringify(back)}`);
    if (uWest.fromLeftMm !== 1000 || uWest.face !== 'W') fail(`undo west ${JSON.stringify(uWest)}`);
    if (uEast.fromLeftMm !== 5000 || uEast.face !== 'E') fail(`undo east ${JSON.stringify(uEast)}`);
    if (undone.floor.nextWallNo !== 2) fail(`undo reused or dropped nextWallNo ${undone.floor.nextWallNo}`);
    await press(visible(page, 'redo'), prof.touch);
    const redone = await downloadBackup(page, prof.touch);
    const again = wallById(redone, 'W1');
    if (again.y1 !== 500 || itemById(redone, 'F1').fromLeftMm !== 500 || itemById(redone, 'F2').fromLeftMm !== 5000) {
      fail(`redo did not restore the extended wall ${JSON.stringify(again)}`);
    }
    if (redone.floor.walls.some((w) => w.id !== 'W1')) fail('redo invented a wall id');
    steps.push('undo-redo-wall');

    await press(await onlyVisible(page, 'mode-place'), prof.touch);
    await press(await onlyVisible(page, 'pal-downlight'), prof.touch);
    await planClick(page, 4500, 3000);
    await waitToast(page, 'F3 placed on ceiling');
    const withLight = await downloadBackup(page, prof.touch);
    const light = itemById(withLight, 'F3');
    if (light.wall !== 'CEIL' || Object.prototype.hasOwnProperty.call(light, 'face')) fail(`downlight ${JSON.stringify(light)}`);
    steps.push('ceiling-has-no-face');

    await press(await onlyVisible(page, 'mode-build'), prof.touch);
    await press(await onlyVisible(page, 'build-add-zone'), prof.touch);
    await press(await onlyVisible(page, 'build-enter-sizes'), prof.touch);
    await page.locator('#modal-root [data-testid="zone-name"]').waitFor({ state: 'visible' });
    if (await page.locator('#modal-root [data-testid="wall-axis"]').count()) fail('Enter sizes opened the wall form while Add zone was the tool');
    await page.locator('#modal-root [data-testid="zone-name"]').fill('Cutting floor');
    await page.locator('#modal-root [data-testid="zone-x0"]').fill('2500');
    await page.locator('#modal-root [data-testid="zone-y0"]').fill('0');
    await page.locator('#modal-root [data-testid="zone-width"]').fill('3500');
    await page.locator('#modal-root [data-testid="zone-depth"]').fill('6000');
    await press(page.locator('#modal-root [data-testid="zone-apply"]'), prof.touch);
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="zone-select"]');
      return el && el.options[el.selectedIndex] && el.options[el.selectedIndex].textContent.includes('Cutting floor');
    });
    const zoneTabs = await tabIds(page);
    if (!zoneTabs.includes('tab-A') || !zoneTabs.includes('tab-W1.W') || !zoneTabs.includes('tab-C')) fail(`zone tabs ${zoneTabs.join(',')}`);
    if (zoneTabs.includes('tab-W1.E') || zoneTabs.includes('tab-B') || zoneTabs.includes('tab-D')) fail(`zone listed a face it does not use ${zoneTabs.join(',')}`);
    const notes = await page.locator('[data-testid="zone-notes"]').innerText();
    if (!notes.includes('West edge: no wall')) fail(`edge notes ${JSON.stringify(notes)}`);
    if (notes.includes('Every edge of this zone meets an outside wall')) fail('fake full-coverage warning is back');
    const eastLabel = await page.locator('[data-testid="tab-W1.W"]').innerText();
    if (!eastLabel.includes('East wall (W1)')) fail(`W1 west tab label ${JSON.stringify(eastLabel)}`);
    await press(page.locator('[data-testid="tab-W1.W"]'), prof.touch);
    const clipCaption = await page.locator('[data-testid="wall-caption"]').textContent();
    if (!clipCaption || !clipCaption.includes('Cutting floor') || !clipCaption.includes('W1 west side') || !clipCaption.includes('0.00 to 5.50 m of 5.50 m')) {
      fail(`clip caption ${JSON.stringify(clipCaption)}`);
    }
    await assertFaceTextClear(page, 'W1 clip');
    const drawn = await page.locator('#canvas .fitting').evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
    if (drawn.join(',') !== 'F1') fail(`west face drew ${drawn.join(',')}`);
    await press(page.locator('[data-testid="tab-A"]'), prof.touch);
    const wallA = await page.locator('[data-testid="wall-caption"]').textContent();
    if (!wallA || !wallA.includes('Cutting floor · Wall A · 2.50 to 6.00 m of 9.00 m')) fail(`Wall A caption ${JSON.stringify(wallA)}`);
    await assertFaceTextClear(page, 'Wall A clip');
    await press(page.locator('[data-testid="tab-PLAN"]'), prof.touch);
    steps.push('zone-clip');
    await shot(page, dir, '05-zone-clip.png');

    const totalBefore = await page.locator('#quote-summary .q-total').innerText();
    const zoneBefore = await page.locator('[data-testid="zone-select"]').inputValue();
    await press(page.locator('#btn-layers'), prof.touch);
    const lighting = page.locator('[data-testid="layer-lighting"]');
    await lighting.waitFor({ state: 'visible' });
    await lighting.uncheck();
    await page.waitForFunction(() => {
      const btn = document.querySelector('#btn-layers');
      return btn && !/Layers: All/.test(btn.textContent || '');
    });
    const totalAfter = await page.locator('#quote-summary .q-total').innerText();
    if (totalAfter !== totalBefore) fail(`layer hide changed the total from ${JSON.stringify(totalBefore)} to ${JSON.stringify(totalAfter)}`);
    if (await page.locator('[data-testid="zone-select"]').inputValue() !== zoneBefore) fail('layer hide changed the zone');
    if (await page.locator('#canvas [data-id="F3"]').count() !== 0) fail('hidden downlight is still drawn');
    if (await page.locator('#canvas [data-id="F1"]').count() !== 1) fail('power fitting disappeared with the lighting layer');
    const scope = await page.locator('#quote-summary').evaluate((el) => el.textContent || '');
    if (!scope.includes('Quote covers all layers')) fail('quote did not say it still covers every layer');
    await press(page.locator('#btn-layers'), prof.touch);
    steps.push('layers-prices');

    const saved = await downloadBackup(page, prof.touch);
    fs.writeFileSync(path.join(dir, 'backup-saved.json'), JSON.stringify(saved, null, 2));
    const savedCanon = JSON.stringify(kept(saved));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.jobsBoot === 'ready');
    await page.waitForFunction((name) => document.querySelector('#btn-job-name')?.textContent === name, JOB);
    await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('[data-testid="save-chip"]')?.textContent || ''));
    await page.locator('[data-testid="wall-W1"]').waitFor({ state: 'attached' });
    await page.locator('[data-testid="zone-select"]').selectOption({ label: 'Cutting floor' });
    await page.locator('[data-testid="tab-W1.W"]').waitFor({ state: 'visible' });
    if ((await tabIds(page)).includes('tab-W1.E')) fail('reopened zone lists the east face');
    const reopened = await downloadBackup(page, prof.touch);
    fs.writeFileSync(path.join(dir, 'backup-reopened.json'), JSON.stringify(reopened, null, 2));
    if (JSON.stringify(kept(reopened)) !== savedCanon) fail('reopen did not keep walls, faces, zone and rates');
    await page.locator('[data-testid="zone-select"]').selectOption({ label: 'Whole floor' });
    steps.push('save-reopen');
    await shot(page, dir, '06-reopened.png');

    await press(await onlyVisible(page, 'mode-build'), prof.touch);
    await press(await onlyVisible(page, 'build-add-wall'), prof.touch);
    const beforeTap = await historyCount(page);
    await planClick(page, 3000, 1500);
    await press(await onlyVisible(page, 'build-cancel'), prof.touch);
    if (await page.locator('[data-testid="wall-W2"]').count() !== 0) fail('cancel stored a wall');
    if (await historyCount(page) !== beforeTap) fail('cancel added a history frame');
    await press(await onlyVisible(page, 'build-add-wall'), prof.touch);
    await planClick(page, 3000, 1500);
    await planClick(page, 3000, 4500);
    await waitToast(page, 'Added W2, 3.00 m long. Undo removes it.');
    await page.locator('[data-testid="wall-W2"]').waitFor({ state: 'attached' });
    const made = await downloadBackup(page, prof.touch);
    const w2 = wallById(made, 'W2');
    if (w2.x1 !== 3000 || w2.x2 !== 3000 || w2.y1 !== 1500 || w2.y2 !== 4500) fail(`two-tap wall ${JSON.stringify(w2)}`);
    if (made.floor.nextWallNo !== 3) fail(`nextWallNo after W2 is ${made.floor.nextWallNo}`);
    await press(visible(page, 'undo'), prof.touch);
    const dropped = await downloadBackup(page, prof.touch);
    if ((dropped.floor.walls || []).some((w) => w.id === 'W2')) fail('undo left W2');
    if (dropped.floor.nextWallNo !== 3) fail(`undo reused nextWallNo ${dropped.floor.nextWallNo}`);
    await press(visible(page, 'redo'), prof.touch);
    const restored = await downloadBackup(page, prof.touch);
    const backW2 = wallById(restored, 'W2');
    if (backW2.x1 !== 3000 || restored.floor.walls.some((w) => w.id === 'W3')) fail('redo did not restore W2');
    if (restored.floor.nextWallNo !== 3) fail(`redo nextWallNo ${restored.floor.nextWallNo}`);
    steps.push('two-tap-undo-redo');
    await shot(page, dir, '07-second-wall.png');

    await press(await onlyVisible(page, 'mode-select'), prof.touch);
    await planClick(page, 3000, 3000); // redo restores the wall; select it before checking handles
    const handle = page.locator('[data-testid="wall-handle-start"]');
    await handle.waitFor({ state: 'attached' });
    await page.waitForFunction(() => { const r = document.querySelector('[data-testid="wall-handle-start"]')?.getBoundingClientRect(); return r && r.width >= 43 && r.height >= 43; }, null, { timeout: 2000 });
    const box = await handle.boundingBox();
    if (!box || box.width < 43 || box.height < 43) fail(`handle is ${box ? Math.round(box.width) : 0} px`);
    await reachable(handle, 'wall-handle-start');
    await reachable(page.locator('[data-testid="wall-handle-end"]'), 'wall-handle-end');
    await planClick(page, 1500, 0);
    await ensureDetails(page, prof.touch, 'wall-open-exterior');
    const exterior = await page.locator('#inspector').innerText();
    if (!exterior.includes('Exterior wall. Change its length in Menu → Floor size.')) fail(`exterior copy ${JSON.stringify(exterior)}`);
    await assertNoOverflow(page, 'journey end');
    await reachable(await onlyVisible(page, 'mode-build'), 'Build');
    await press(await onlyVisible(page, 'mode-build'), prof.touch);
    await reachable(await onlyVisible(page, 'build-add-wall'), 'Add wall');
    steps.push('reachable');
    await shot(page, dir, '08-handles.png');

    if (consoleErrors.length) fail(`console errors: ${consoleErrors.join(' | ')}`);
    if (external.length) fail(`external requests: ${external.join(' | ')}`);
    record.pass = true;
    console.log(`ok - ${prof.key}`);
  } catch (err) {
    record.pass = false;
    record.error = String(err && err.message ? err.message : err);
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
  for (const prof of PROFILES.filter(p => !process.env.WALL_PROFILE || p.key === process.env.WALL_PROFILE)) summary.push(await runProfile(browser, prof));
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
