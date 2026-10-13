// EP-FLOOR-05 print pack journey. NOT RUN by the file-only author.
// Serves prototype/ only. One zoned job and one plain job at four viewports.
// Run: node tests/floor-print-browser.mjs
// Playwright: PLAYWRIGHT_MODULE or the Office path below. No install.
// A PDF is written only when this file is executed, under
// .worker-output/print-evidence/<profile>/page.pdf.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../prototype/js/core.js';

const playwrightPath = process.env.PLAYWRIGHT_MODULE
  || '/home/agent/.nvm/versions/node/v22.23.1/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightPath);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVE = path.join(ROOT, 'prototype');
const EV = path.join(ROOT, '.worker-output', 'print-evidence');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const WARNING = "Containment isn't priced or measured in this version.";
const LABOUR = 'Labour breakdown — whole job, all layers';
const PROFILES = [
  { key: 'desktop-1280x800', width: 1280, height: 800, touch: false, mobile: false },
  { key: 'tablet-768x1024', width: 768, height: 1024, touch: true, mobile: false },
  { key: 'phone-390x844', width: 390, height: 844, touch: true, mobile: true },
  { key: 'narrow-360x740', width: 360, height: 740, touch: true, mobile: true },
];

fs.mkdirSync(EV, { recursive: true });

function fail(message) {
  throw new Error(message);
}

function zonedJob() {
  const job = C.blankJobV2('Synthetic print');
  job.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  C.addZone(job, { name: 'Cutting floor', x0: 0, y0: 0, x1: 3000, y1: 4000 });
  C.addZone(job, { name: 'Waiting and till', x0: 3000, y0: 0, x1: 6000, y1: 4000 });
  const wall = C.addWall(job, { x1: 500, y1: 2000, x2: 2500, y2: 2000 });
  C.placeItem(job, 'surface', wall, 400, 450, 'North socket', 'N');
  C.placeItem(job, 'surface', wall, 400, 450, 'South socket', 'S');
  C.placeItem(job, 'switch', 'A', 500, 1200, 'Entry switch');
  C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 100, endMm: 1500, heightMm: 1200, notes: '' });
  C.addRoute(job, { type: 'conduit', wall, face: 'S', startMm: 200, endMm: 1800, heightMm: 300, notes: '' });
  return job;
}

function plainJob() {
  const job = C.blankJobV2('Plain print');
  job.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  C.placeItem(job, 'surface', 'A', 800, 450, 'Plain socket');
  return job;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-print-pack-'));
const zonedPath = path.join(tmp, 'zoned.json');
const plainPath = path.join(tmp, 'plain.json');
const zoned = zonedJob();
fs.writeFileSync(zonedPath, C.serialiseJob(zoned));
fs.writeFileSync(plainPath, C.serialiseJob(plainJob()));
const priceBefore = JSON.stringify(C.breakdown(zoned));

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

async function press(locator, touch) {
  await locator.scrollIntoViewIfNeeded();
  if (touch) await locator.tap();
  else await locator.click();
}

async function reachable(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const problem = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) return `hit target ${Math.round(r.width)}x${Math.round(r.height)}`;
    if (r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) {
      return `clipped ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} in ${innerWidth}x${innerHeight}`;
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && (hit === el || el.contains(hit) || (hit.closest && hit.closest('label') === el.closest('label')))) return null;
    const id = hit ? hit.tagName.toLowerCase() + (hit.id ? `#${hit.id}` : '') : 'nothing';
    return `covered by ${id}`;
  });
  if (problem) fail(`${label}: ${problem}`);
}

async function importJob(page, touch, file) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.jobsBoot === 'ready');
  await page.setInputFiles('#file-input', file);
  await press(page.locator('[data-testid="import-confirm"]'), touch);
  await page.waitForFunction(() => /^Saved on this device/.test(String((document.querySelector('[data-testid="save-chip"]') || {}).textContent || '').trim()));
}

async function openPrint(page, touch) {
  await press(page.getByRole('button', { name: 'Menu', exact: true }), touch);
  await press(page.locator('#modal-root').getByRole('button', { name: 'Print', exact: true }), touch);
  const sheets = page.locator('#modal-root').getByRole('group', { name: 'Wall sheets' });
  await sheets.waitFor({ state: 'visible' });
  return sheets;
}

async function cancelPrint(page, touch) {
  await press(page.locator('#modal-root').getByRole('button', { name: 'Cancel', exact: true }), touch);
  await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
}

async function goPrint(page, touch) {
  const before = await page.evaluate(() => window.__printed || 0);
  await press(page.locator('[data-testid="print-go"]'), touch);
  await page.waitForFunction((n) => window.__printed === n, before + 1);
}

// every numbered page must fit one sheet of paper, or "Page n of N" lies
async function pdfFitsPages(page, file) {
  const pdf = await page.pdf({ path: file, format: 'A4', landscape: true, printBackground: true });
  const paper = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const logical = await page.locator('#print-pack .page').count();
  if (paper !== logical) fail(`PDF has ${paper} sheets for ${logical} numbered pages`);
}

async function storedJob(page) {
  return page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
}

async function screenState(page) {
  return page.evaluate(() => ({
    history: document.querySelector('#btn-undo').dataset.history,
    redo: document.querySelector('#btn-redo').dataset.history,
    layers: document.querySelector('#btn-layers').textContent,
    zone: document.querySelector('[data-testid="zone-select"]').value,
    quote: document.querySelector('#quote-summary').textContent,
  }));
}

async function sheetText(page, wall, face) {
  const sheet = page.locator(`#print-pack .wall-sheet[data-wall="${wall}"][data-face="${face}"]`);
  if (await sheet.count() !== 1) fail(`${wall} ${face}: expected 1 sheet, found ${await sheet.count()}`);
  return sheet;
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
  const pageErrors = [];
  const external = [];
  const steps = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('request', (req) => {
    let url;
    try { url = new URL(req.url()); } catch { return; }
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1') external.push(req.url());
  });
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const record = { key: prof.key, pass: false, steps };
  try {
    await importJob(page, prof.touch, zonedPath);
    const sheets = await openPrint(page, prof.touch);
    const orderOk = await page.locator('#modal-root .modal').evaluate((modal) => {
      const note = modal.querySelector('[data-testid="print-breakdown-note"]');
      const group = modal.querySelector('fieldset');
      const layers = modal.querySelector('[data-testid="print-scope-all"]');
      return !!(note && group && layers && (layers.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING) && (note.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    if (!orderOk) fail('Wall sheets is not under the layer choices and the breakdown note');
    const whole = sheets.getByRole('checkbox', { name: 'Whole floor (every wall, full length)' });
    const cutting = sheets.getByRole('checkbox', { name: 'Cutting floor' });
    const waiting = sheets.getByRole('checkbox', { name: 'Waiting and till' });
    if (!(await whole.isChecked())) fail('Whole floor scope did not tick Whole floor');
    if (await cutting.isChecked() || await waiting.isChecked()) fail('zone boxes were ticked in Whole floor scope');
    if (!/\b6 sheets\b/.test(await sheets.innerText())) fail(`whole floor count ${JSON.stringify(await sheets.innerText())}`);
    await reachable(whole, 'Whole floor checkbox');
    await reachable(cutting, 'Cutting floor checkbox');
    await reachable(waiting, 'Waiting and till checkbox');
    await reachable(page.locator('[data-testid="print-go"]'), 'Print');
    await reachable(page.locator('#modal-root').getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
    await page.screenshot({ path: path.join(dir, 'dialog.png') });
    await cancelPrint(page, prof.touch);
    if ((await page.evaluate(() => window.__printed || 0)) !== 0) fail('Cancel printed');
    steps.push('dialog-whole-floor');

    await page.locator('[data-testid="zone-select"]').selectOption({ label: 'Cutting floor' });
    const zoneDialog = await openPrint(page, prof.touch);
    if (await zoneDialog.getByRole('checkbox', { name: 'Whole floor (every wall, full length)' }).isChecked()) fail('zone scope ticked Whole floor');
    if (!(await zoneDialog.getByRole('checkbox', { name: 'Cutting floor' }).isChecked())) fail('zone scope did not tick Cutting floor');
    if (await zoneDialog.getByRole('checkbox', { name: 'Waiting and till' }).isChecked()) fail('zone scope ticked the other zone');
    const zoneCount = await zoneDialog.innerText();
    if (!/\b4 sheets\b/.test(zoneCount) || zoneCount.includes('shared by the ticked zones')) fail(`zone default count ${JSON.stringify(zoneCount)}`);
    await cancelPrint(page, prof.touch);
    await page.locator('[data-testid="zone-select"]').selectOption({ value: '' });
    steps.push('dialog-zone-scope');

    const again = await openPrint(page, prof.touch);
    await again.getByRole('checkbox', { name: 'Whole floor (every wall, full length)' }).uncheck();
    await again.getByRole('checkbox', { name: 'Cutting floor' }).check();
    await again.getByRole('checkbox', { name: 'Waiting and till' }).check();
    const both = await again.innerText();
    if (!/\b4 sheets\b/.test(both) || !both.includes('1 wall is shared by the ticked zones and prints once.')) fail(`shared count ${JSON.stringify(both)}`);
    const stored = await storedJob(page);
    const state = await screenState(page);
    await goPrint(page, prof.touch);
    const heads = await page.locator('#print-pack .page h2').allInnerTexts();
    const a = heads.indexOf('Cutting floor, Waiting and till · North wall (A)');
    const d = heads.indexOf('Cutting floor · West wall (D)');
    const n = heads.indexOf('Cutting floor · W1 north side');
    const s = heads.indexOf('Cutting floor · W1 south side');
    if (!(a > 0 && a < d && d < n && n < s && s === heads.length - 2 && heads[heads.length - 1] === LABOUR)) fail(`sheet order ${JSON.stringify(heads)}`);
    if (heads.some((h) => /\((B|C)\)$/.test(h) || h.includes('Waiting and till · West') || h.includes('Waiting and till · W1'))) fail(`unticked walls printed ${JSON.stringify(heads)}`);
    const packText = await page.locator('#print-pack').innerText();
    if (!packText.includes('Looking north · 0.00 to 6.00 m of 9.00 m · key plan shows this wall in red')) fail('A subtitle missing the hull range');
    if (!packText.includes('Looking west · 2.00 to 6.00 m of 6.00 m · key plan shows this wall in red')) fail('D subtitle');
    if (!packText.includes('Looking south · 0.00 to 2.00 m of 2.00 m · key plan shows this wall in red')) fail('W1 north subtitle');
    if (!packText.includes('Looking north · 0.00 to 2.00 m of 2.00 m · key plan shows this wall in red')) fail('W1 south subtitle');
    if (!packText.includes(WARNING)) fail('containment warning missing');
    const pages = await page.locator('#print-pack .page').count();
    if (!packText.includes(`Page ${pages} of ${pages}`) || !packText.includes('Page 1 of')) fail('page footers');
    const north = await sheetText(page, 'W1', 'N');
    const south = await sheetText(page, 'W1', 'S');
    const northFit = await north.locator('[data-testid="print-key-fitting"]').evaluate((el) => ({ x: el.getAttribute('data-plan-x'), y: el.getAttribute('data-plan-y'), from: el.getAttribute('data-from-left') }));
    const southFit = await south.locator('[data-testid="print-key-fitting"]').evaluate((el) => ({ x: el.getAttribute('data-plan-x'), y: el.getAttribute('data-plan-y'), from: el.getAttribute('data-from-left') }));
    if (northFit.x !== '2100' || northFit.y !== '2000' || northFit.from !== '400') fail(`W1 north plan ${JSON.stringify(northFit)}`);
    if (southFit.x !== '900' || southFit.y !== '2000' || southFit.from !== '400') fail(`W1 south plan ${JSON.stringify(southFit)}`);
    if (await north.locator('[data-testid="print-elevation-fitting"]').getAttribute('data-from-left') !== '400') fail('W1 north elevation');
    if (await south.locator('[data-testid="print-elevation-fitting"]').getAttribute('data-from-left') !== '400') fail('W1 south elevation');
    const northRun = await north.locator('[data-testid="print-key-route"]').evaluate((el) => ({ x1: el.getAttribute('data-plan-x1'), x2: el.getAttribute('data-plan-x2'), type: el.getAttribute('data-type') }));
    const southRun = await south.locator('[data-testid="print-key-route"]').evaluate((el) => ({ x1: el.getAttribute('data-plan-x1'), x2: el.getAttribute('data-plan-x2'), type: el.getAttribute('data-type') }));
    if (northRun.type !== 'trunking' || northRun.x1 !== '2400' || northRun.x2 !== '1000') fail(`W1 north route ${JSON.stringify(northRun)}`);
    if (southRun.type !== 'conduit' || southRun.x1 !== '700' || southRun.x2 !== '2300') fail(`W1 south route ${JSON.stringify(southRun)}`);
    const boundary = await (await sheetText(page, 'A', 'S')).locator('[data-testid="print-zone-boundary"]').evaluate((el) => ({
      at: el.getAttribute('data-at'),
      dash: el.getAttribute('stroke-dasharray'),
    }));
    if (boundary.at !== '3000' || boundary.dash !== '70 40') fail(`A boundary ${JSON.stringify(boundary)}`);
    const boundaryLabel = await (await sheetText(page, 'A', 'S')).locator('[data-testid="print-zone-boundary-label"]').textContent();
    if (!boundaryLabel.includes('Cutting floor') || !boundaryLabel.includes('Waiting and till')) fail(`boundary label ${JSON.stringify(boundaryLabel)}`);
    if (await page.locator('[data-testid="print-zones"]').evaluate((el) => el.tagName) !== 'OL') fail('zones are not a numbered list');
    if (await page.locator('[data-testid="print-routes"]').evaluate((el) => el.tagName) !== 'OL') fail('routes are not a numbered list');
    if ((await storedJob(page)) !== stored) fail('printing changed stored data');
    if (JSON.stringify(await screenState(page)) !== JSON.stringify(state)) fail('printing changed history, layers, scope or the quote');
    if (JSON.stringify(C.breakdown(zoned)) !== priceBefore) fail('price changed in the fixture');
    await pdfFitsPages(page, path.join(dir, 'page.pdf'));
    steps.push('dedup-order-mirror-boundary');

    await press(page.locator('#btn-layers'), prof.touch);
    const lighting = page.locator('[data-testid="layer-lighting"]');
    await lighting.waitFor({ state: 'visible' });
    if (await lighting.isChecked()) await press(lighting, prof.touch);
    await press(page.locator('#btn-layers'), prof.touch);
    const filtered = await screenState(page);
    if (filtered.layers === 'Layers: All') fail('lighting layer did not hide');
    const filteredStored = await storedJob(page);
    const shownDialog = await openPrint(page, prof.touch);
    const shownRadio = page.locator('[data-testid="print-scope-shown"]');
    if (await shownRadio.isDisabled()) fail('shown-layers choice stayed disabled');
    await press(shownRadio, prof.touch);
    if (!/\b6 sheets\b/.test(await shownDialog.innerText())) fail('shown layers changed the sheet count');
    await goPrint(page, prof.touch);
    const shownPack = await page.locator('#print-pack').innerText();
    if (!shownPack.includes('Not drawn: Lighting')) fail('shown-layers note missing');
    if (await (await sheetText(page, 'A', 'S')).locator('[data-testid="print-elevation-fitting"]').count() !== 0) fail('hidden switch was drawn');
    if (await (await sheetText(page, 'W1', 'N')).locator('[data-testid="print-elevation-fitting"]').count() !== 1) fail('shown socket was omitted');
    const labour = await page.locator('[data-testid="print-labour"]').innerText();
    if (!labour.includes('Switch') || !labour.includes('New surface socket') || !labour.includes(LABOUR)) fail('breakdown dropped a hidden or shown fitting');
    if ((await storedJob(page)) !== filteredStored) fail('shown-layers print wrote storage');
    const afterFilter = await screenState(page);
    if (afterFilter.layers !== filtered.layers || afterFilter.history !== filtered.history || afterFilter.quote !== filtered.quote) fail('shown-layers print changed the screen');
    steps.push('shown-layers');

    const emptyDialog = await openPrint(page, prof.touch);
    const emptyWhole = emptyDialog.getByRole('checkbox', { name: 'Whole floor (every wall, full length)' });
    if (await emptyWhole.isChecked()) await emptyWhole.uncheck();
    if (await emptyDialog.getByRole('checkbox', { name: 'Cutting floor' }).isChecked()) await emptyDialog.getByRole('checkbox', { name: 'Cutting floor' }).uncheck();
    if (await emptyDialog.getByRole('checkbox', { name: 'Waiting and till' }).isChecked()) await emptyDialog.getByRole('checkbox', { name: 'Waiting and till' }).uncheck();
    if (!/^0 sheets$/.test((await page.locator('[data-testid="print-sheet-count"]').innerText()).trim())) fail(`empty count ${JSON.stringify(await page.locator('[data-testid="print-sheet-count"]').innerText())}`);
    await goPrint(page, prof.touch);
    const emptyHeads = await page.locator('#print-pack .page h2').allInnerTexts();
    if (JSON.stringify(emptyHeads) !== JSON.stringify(['Floor overview', LABOUR])) fail(`no-wall pack ${JSON.stringify(emptyHeads)}`);
    if (await page.locator('#print-pack .wall-sheet').count() !== 0) fail('no-wall pack still had a wall sheet');
    await pdfFitsPages(page, path.join(dir, 'no-wall.pdf'));
    steps.push('no-wall');

    await page.evaluate(() => {
      window.dispatchEvent(new Event('afterprint'));
      window.dispatchEvent(new Event('beforeprint'));
    });
    const menuHeads = await page.locator('#print-pack .page h2').allInnerTexts();
    if (!menuHeads.includes('Whole floor · North wall (A)') || !menuHeads.some((h) => h.endsWith('(B)')) || !menuHeads.some((h) => h.endsWith('(C)')) || !menuHeads.some((h) => h.endsWith('(D)'))) {
      fail(`browser menu pack ${JSON.stringify(menuHeads)}`);
    }
    const menuPack = await page.locator('#print-pack').innerText();
    if (!menuPack.includes('All layers') || menuPack.includes('Not drawn:')) fail('browser menu did not print all layers');
    if (await (await sheetText(page, 'A', 'S')).locator('[data-testid="print-elevation-fitting"]').count() !== 1) fail('browser menu dropped the hidden switch');
    if ((await screenState(page)).layers !== filtered.layers) fail('browser menu changed layer visibility');
    steps.push('browser-menu');

    await press(page.getByRole('button', { name: 'Menu', exact: true }), prof.touch);
    const csvItem = page.locator('#modal-root').getByRole('button', { name: 'Download CSV', exact: true });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      press(csvItem, prof.touch),
    ]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    if (/trunking|conduit|\bT1\b|\bC1\b/i.test(csv)) fail(`csv mentioned containment ${csv.slice(0, 240)}`);
    if (!csv.includes('New surface socket') || !csv.includes('Switch')) fail('csv dropped fittings');
    steps.push('csv');

    await page.setInputFiles('#file-input', plainPath);
    await press(page.locator('[data-testid="import-confirm"]'), prof.touch);
    // the chip already reads Saved from the previous job, so wait for the imported record itself
    await page.waitForFunction(() => Object.values(localStorage).some((v) => v.includes('"name":"Plain print"')));
    await page.waitForFunction(() => /^Saved on this device/.test(String((document.querySelector('[data-testid="save-chip"]') || {}).textContent || '').trim()));
    const plainStored = await storedJob(page);
    const plainState = await screenState(page);
    const plainDialog = await openPrint(page, prof.touch);
    if (!(await plainDialog.getByRole('checkbox', { name: 'Whole floor (every wall, full length)' }).isChecked())) fail('plain job did not default to Whole floor');
    if (await plainDialog.getByRole('checkbox', { name: 'Cutting floor' }).count()) fail('plain job listed a zone');
    if (!/\b4 sheets\b/.test(await plainDialog.innerText())) fail(`plain count ${JSON.stringify(await plainDialog.innerText())}`);
    await goPrint(page, prof.touch);
    if (await page.locator('#print-pack .page').count() !== 4) fail(`legacy page count ${await page.locator('#print-pack .page').count()}`);
    const legacyPages = page.locator('#print-pack .page.legacy-walls');
    if (await legacyPages.count() !== 2) fail('legacy pack did not pair the walls');
    const perPage = await legacyPages.evaluateAll((els) => els.map((el) => [...el.querySelectorAll('h2')].map((h) => h.textContent)));
    if (JSON.stringify(perPage) !== JSON.stringify([['Wall A', 'Wall B'], ['Wall C', 'Wall D']])) fail(`legacy walls ${JSON.stringify(perPage)}`);
    if (await page.locator('#print-pack .wall-sheet').count() !== 0) fail('plain job used the zone pack');
    const legacyHeads = await page.locator('#print-pack .page h2').allInnerTexts();
    if (legacyHeads[0] !== 'Floor plan — all layers' || legacyHeads[legacyHeads.length - 1] !== LABOUR) fail(`legacy heads ${JSON.stringify(legacyHeads)}`);
    if ((await storedJob(page)) !== plainStored) fail('legacy print changed stored data');
    if (JSON.stringify(await screenState(page)) !== JSON.stringify(plainState)) fail('legacy print changed the screen');
    await pdfFitsPages(page, path.join(dir, 'legacy.pdf'));
    steps.push('legacy-four-page');

    if (pageErrors.length) fail(`page errors ${pageErrors.join(' | ')}`);
    if (external.length) fail(`external requests: ${external.join(' | ')}`);
    record.pass = true;
    console.log(`ok - ${prof.key}`);
  } catch (err) {
    record.pass = false;
    record.error = String(err && err.stack ? err.stack : err);
    try { await page.screenshot({ path: path.join(dir, 'failure.png') }); } catch { /* page may already be gone */ }
    console.error(`FAIL - ${prof.key}: ${record.error}`);
  } finally {
    record.pageErrors = pageErrors;
    record.external = external;
    fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify(record, null, 2));
    await context.close();
  }
  return record;
}

try {
  browser = await chromium.launch();
  const only = process.env.PRINT_PROFILE;
  for (const prof of PROFILES.filter((p) => !only || p.key === only)) summary.push(await runProfile(browser, prof));
  fs.writeFileSync(path.join(EV, 'summary.json'), JSON.stringify({ profiles: summary }, null, 2));
  if (summary.some((row) => !row.pass)) exitCode = 1;
} catch (err) {
  console.error(`FAIL - ${err && err.message ? err.message : err}`);
  exitCode = 1;
} finally {
  clearTimeout(hard);
  try { if (browser) await browser.close(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
  process.exit(exitCode);
}
