// EP-FLOOR-02 zone UI red journey. NOT RUN by the author.
// Serves prototype/ only. One public journey at three viewports.
// Expected red on the current baseline: mode-build is missing.
// Run: node tests/floor-zone-browser.mjs
// Playwright: PLAYWRIGHT_MODULE or the Office path below.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const playwrightPath = process.env.PLAYWRIGHT_MODULE
  || '/home/agent/.nvm/versions/node/v22.23.1/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightPath);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVE = path.join(ROOT, 'prototype');
const EV = path.join(ROOT, '.worker-output', 'zone-ui-evidence');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const JOB = 'Barber refit';
const CREATED = { name: 'Cutting floor', x0: 2500, y0: 0, width: 3500, depth: 6000 };
const EDITED = { id: 'Z1', name: 'Cutting area', x0: 2000, y0: 0, x1: 6000, y1: 6000 };
const PROFILES = [
  { key: 'desktop-1280x800', width: 1280, height: 800, touch: false, mobile: false },
  { key: 'tablet-768x1024', width: 768, height: 1024, touch: true, mobile: false },
  { key: 'phone-390x844', width: 390, height: 844, touch: true, mobile: true },
];

fs.mkdirSync(EV, { recursive: true });

function fail(message) {
  const err = new Error(message);
  err.expectedRed = true;
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
}, 180000);

function visible(page, testid) {
  return page.locator(`[data-testid="${testid}"]:visible`);
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

async function chooseZone(page, name) {
  const sel = await onlyVisible(page, 'zone-select');
  const labels = (await sel.locator('option').allTextContents()).map((text) => text.trim());
  if (!labels.includes(name)) fail(`zone-select has no ${name}; options: ${labels.join(' | ')}`);
  await sel.selectOption({ label: name });
  await waitSelected(page, name);
}

async function selectedZone(page) {
  return visible(page, 'zone-select').evaluate((el) => {
    const opt = el.options[el.selectedIndex];
    return opt ? opt.textContent.trim() : '';
  });
}

async function waitSelected(page, name) {
  await page.waitForFunction((expected) => {
    const el = [...document.querySelectorAll('[data-testid="zone-select"]')].find((node) => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!el) return false;
    const text = el.options[el.selectedIndex]?.textContent.trim() || '';
    return text.includes(expected);
  }, name);
}

async function waitZoneListed(page, name, present) {
  await page.waitForFunction(([expected, want]) => {
    const el = [...document.querySelectorAll('[data-testid="zone-select"]')].find((node) => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!el) return false;
    const listed = [...el.options].some((opt) => opt.textContent.includes(expected));
    return listed === want;
  }, [name, present]);
}

async function armSaveWatch(page) {
  await page.evaluate(() => {
    const chip = document.querySelector('[data-testid="save-chip"]');
    window.__zoneSave = 'idle';
    if (window.__zoneSaveObs) window.__zoneSaveObs.disconnect();
    const note = () => {
      const text = chip.textContent || '';
      if (/Saving|Unsaved changes|typing/.test(text)) window.__zoneSave = 'dirty';
      else if (window.__zoneSave === 'dirty' && /Saved on this device/.test(text)) window.__zoneSave = 'saved';
    };
    const obs = new MutationObserver(note);
    obs.observe(chip, { childList: true, characterData: true, subtree: true });
    window.__zoneSaveObs = obs;
  });
}

async function waitSaved(page) {
  await page.waitForFunction(() => window.__zoneSave === 'saved');
}

async function readMm(page, testid) {
  const raw = (await (await onlyVisible(page, testid)).inputValue()).trim();
  if (!/^-?\d+$/.test(raw)) fail(`${testid}: expected whole millimetres, got ${raw}`);
  return Number(raw);
}

async function ensureZoneFields(page, touch) {
  if (await visible(page, 'zone-name').count() === 1) return;
  const show = page.getByRole('button', { name: 'Show details', exact: true });
  await press(show, touch);
  await onlyVisible(page, 'zone-name');
}

async function fillZone(page, touch, fields) {
  const name = await onlyVisible(page, 'zone-name');
  await name.fill(fields.name);
  await (await onlyVisible(page, 'zone-x0')).fill(String(fields.x0));
  await (await onlyVisible(page, 'zone-y0')).fill(String(fields.y0));
  await (await onlyVisible(page, 'zone-width')).fill(String(fields.width));
  await (await onlyVisible(page, 'zone-depth')).fill(String(fields.depth));
  for (const id of ['zone-name', 'zone-x0', 'zone-y0', 'zone-width', 'zone-depth', 'zone-apply']) {
    await reachable(await onlyVisible(page, id), id);
  }
  await armSaveWatch(page);
  await press(await onlyVisible(page, 'zone-apply'), touch);
}

function assertBackup(job, zonePresent) {
  const problems = [];
  if (job.schema !== 'surface-job') problems.push(`schema ${job.schema}`);
  if (job.schemaVersion !== 2) problems.push(`schemaVersion ${job.schemaVersion}`);
  if (job.name !== JOB) problems.push(`name ${job.name}`);
  const room = job.room || {};
  if (room.widthM !== 9 || room.depthM !== 6 || room.heightM !== 2.7) problems.push(`room ${JSON.stringify(room)}`);
  const floor = job.floor;
  if (!floor || !Array.isArray(floor.zones) || !Array.isArray(floor.walls) || !Array.isArray(floor.routes)) {
    problems.push('floor shape');
  } else {
    if (floor.walls.length || floor.routes.length) problems.push('unexpected walls or routes');
    if (floor.nextZoneNo !== 2) problems.push(`nextZoneNo ${floor.nextZoneNo}`);
    if (zonePresent) {
      const z = floor.zones[0];
      const keys = z ? Object.keys(z).sort().join(',') : '';
      if (floor.zones.length !== 1 || keys !== 'id,name,x0,x1,y0,y1') problems.push(`zones ${JSON.stringify(floor.zones)}`);
      else {
        for (const key of Object.keys(EDITED)) {
          if (z[key] !== EDITED[key]) problems.push(`zone.${key} ${z[key]}`);
        }
      }
    } else if (floor.zones.length !== 0) {
      problems.push(`zones after redo ${JSON.stringify(floor.zones)}`);
    }
  }
  if (problems.length) fail(problems.join('; '));
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

async function openDetails(page, touch) {
  const show = page.getByRole('button', { name: 'Show details', exact: true });
  if (await show.count() && await show.first().isVisible()) await press(show.first(), touch);
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
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  const consoleErrors = [];
  const external = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('request', (req) => {
    let url;
    try { url = new URL(req.url()); } catch { return; }
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1') external.push(req.url());
  });
  const record = { key: prof.key, pass: false };
  try {
    await createJob(page, prof.touch);
    await assertNoOverflow(page, 'blank job');
    await reachable(page.getByRole('button', { name: 'Menu', exact: true }), 'Menu');
    await reachable(visible(page, 'undo'), 'undo');
    await reachable(visible(page, 'redo'), 'redo');
    if (consoleErrors.length) fail(`console errors before zone controls: ${consoleErrors.join(' | ')}`);
    if (external.length) fail(`external requests before zone controls: ${external.join(' | ')}`);
    await shot(page, dir, '01-job.png');

    await press(await onlyVisible(page, 'mode-build'), prof.touch);
    await press(await onlyVisible(page, 'build-add-zone'), prof.touch);
    await press(await onlyVisible(page, 'build-enter-sizes'), prof.touch);
    await fillZone(page, prof.touch, CREATED);
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    await waitSelected(page, CREATED.name);
    await ensureZoneFields(page, prof.touch);
    if (await (await onlyVisible(page, 'zone-name')).inputValue() !== CREATED.name) fail('inspector name is not Cutting floor');
    if (await readMm(page, 'zone-x0') !== CREATED.x0) fail('inspector west is not 2500');
    if (await readMm(page, 'zone-y0') !== CREATED.y0) fail('inspector north is not 0');
    if (await readMm(page, 'zone-width') !== CREATED.width) fail('inspector width is not 3500');
    if (await readMm(page, 'zone-depth') !== CREATED.depth) fail('inspector depth is not 6000');
    await assertNoOverflow(page, 'zone created');
    await shot(page, dir, '02-zone-created.png');

    await (await onlyVisible(page, 'zone-name')).fill(EDITED.name);
    await (await onlyVisible(page, 'zone-x0')).fill(String(EDITED.x0));
    await (await onlyVisible(page, 'zone-width')).fill('4000');
    if (await readMm(page, 'zone-y0') !== 0 || await readMm(page, 'zone-depth') !== 6000) {
      fail('north or depth changed before apply');
    }
    await armSaveWatch(page);
    await press(await onlyVisible(page, 'zone-apply'), prof.touch);
    await waitSelected(page, EDITED.name);
    await waitSaved(page);
    await ensureZoneFields(page, prof.touch);
    if (await readMm(page, 'zone-x0') !== EDITED.x0 || await readMm(page, 'zone-width') !== 4000) {
      fail('inspector did not keep the edited west and width');
    }
    if (await readMm(page, 'zone-y0') !== 0 || await readMm(page, 'zone-depth') !== 6000) {
      fail('inspector changed north or depth');
    }
    await shot(page, dir, '03-zone-edited.png');
    const edited = await downloadBackup(page, prof.touch);
    fs.writeFileSync(path.join(dir, 'backup-edited.json'), JSON.stringify(edited, null, 2));
    assertBackup(edited, true);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.jobsBoot === 'ready');
    await page.waitForFunction((name) => document.querySelector('#btn-job-name')?.textContent === name, JOB);
    await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('[data-testid="save-chip"]')?.textContent || ''));
    await chooseZone(page, EDITED.name);
    await ensureZoneFields(page, prof.touch);
    if (await (await onlyVisible(page, 'zone-name')).inputValue() !== EDITED.name) fail('reloaded name mismatch');
    if (await readMm(page, 'zone-x0') !== 2000 || await readMm(page, 'zone-y0') !== 0) fail('reloaded origin mismatch');
    if (await readMm(page, 'zone-width') !== 4000 || await readMm(page, 'zone-depth') !== 6000) fail('reloaded size mismatch');
    await assertNoOverflow(page, 'reloaded');
    await shot(page, dir, '04-reloaded.png');

    await press(await onlyVisible(page, 'zone-remove'), prof.touch);
    await waitZoneListed(page, EDITED.name, false);
    await press(visible(page, 'undo'), prof.touch);
    await waitZoneListed(page, EDITED.name, true);
    const restored = await downloadBackup(page, prof.touch);
    fs.writeFileSync(path.join(dir, 'backup-undo.json'), JSON.stringify(restored, null, 2));
    assertBackup(restored, true);
    await shot(page, dir, '05-undo.png');

    await press(visible(page, 'redo'), prof.touch);
    await waitZoneListed(page, EDITED.name, false);
    const removed = await downloadBackup(page, prof.touch);
    fs.writeFileSync(path.join(dir, 'backup-redo.json'), JSON.stringify(removed, null, 2));
    assertBackup(removed, false);
    await assertNoOverflow(page, 'redo');
    await shot(page, dir, '06-redo.png');

    // The new zone is selected even when a fitting inside it was selected first.
    // A later scope change keeps that fitting when it is still visible.
    await press(page.locator('#mode-rail [data-mode="place"]'), prof.touch);
    await press(await onlyVisible(page, 'pal-surface'), prof.touch);
    // a surface socket on wall A inside Bay; at 3.5 m it is clear of the floating Layers and zoom
    // buttons, which sit over the top wall on phone while details are open
    await planClick(page, 3500, 80);
    await page.locator('#canvas .fitting[data-id="F1"]').waitFor({ state: 'attached' });
    await openDetails(page, prof.touch);
    const fittingHead = (await page.locator('#inspector h2').first().innerText()).trim();
    if (!fittingHead.includes('F1')) fail(`socket was not selected: ${JSON.stringify(fittingHead)}`);
    if (await page.locator('#inspector [data-testid="ins-type"]').count() !== 1) fail('fitting inspector did not open');
    await press(await onlyVisible(page, 'mode-build'), prof.touch);
    await press(await onlyVisible(page, 'build-add-zone'), prof.touch);
    await press(await onlyVisible(page, 'build-enter-sizes'), prof.touch);
    await fillZone(page, prof.touch, { name: 'Bay', x0: 0, y0: 0, width: 4000, depth: 4000 });
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    await waitSelected(page, 'Bay');
    await ensureZoneFields(page, prof.touch);
    if (await (await onlyVisible(page, 'zone-name')).inputValue() !== 'Bay') fail('new zone was not selected');
    if (await page.locator('#inspector [data-testid="ins-type"]').count()) fail('fitting stayed selected after the zone was created');
    await chooseZone(page, 'Whole floor');
    await press(page.locator('#mode-rail [data-mode="select"]'), prof.touch);
    await planClick(page, 3500, 260);
    await openDetails(page, prof.touch);
    const wholeHead = (await page.locator('#inspector h2').first().innerText()).trim();
    if (!wholeHead.includes('F1')) fail(`whole floor did not keep the fitting: ${JSON.stringify(wholeHead)}`);
    await chooseZone(page, 'Bay');
    await openDetails(page, prof.touch);
    const scopedHead = (await page.locator('#inspector h2').first().innerText()).trim();
    if (!scopedHead.includes('F1')) fail(`zone scope cleared a visible fitting: ${JSON.stringify(scopedHead)}`);
    if (await page.locator('#inspector [data-testid="zone-name"]').count()) fail('zone panel replaced a visible fitting');
    await chooseZone(page, 'Whole floor');
    await openDetails(page, prof.touch);
    const backHead = (await page.locator('#inspector h2').first().innerText()).trim();
    if (!backHead.includes('F1')) fail(`leaving the zone cleared a visible fitting: ${JSON.stringify(backHead)}`);
    await shot(page, dir, '07-zone-selected.png');

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
    fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify(record, null, 2));
    await context.close();
  }
  return record;
}

try {
  browser = await chromium.launch();
  for (const prof of PROFILES) summary.push(await runProfile(browser, prof));
  fs.writeFileSync(path.join(EV, 'summary.json'), JSON.stringify({ profiles: summary }, null, 2));
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
