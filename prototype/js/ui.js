// Browser UI for the Surface drawing-to-labour prototype.
// Plain ES modules, no dependencies, no outbound requests.
import * as C from './core.js';

const STORAGE_KEY = 'surface.job.v1';
const NS = 'http://www.w3.org/2000/svg';

// ---- State ---------------------------------------------------------------
let job = null;
let mode = 'select';            // select | place | draw | notes
let view = 'PLAN';              // PLAN | A | B | C | D
let selectedId = null;
let placeType = 'surface';
let history = [];               // JSON snapshots (undo), limit 50
let redoStack = [];
let penSeen = false;
let zoom = { s: 1, tx: 0, ty: 0 };
// Must match the phone media queries in style.css.
const PHONE = window.matchMedia('(max-width: 600px), (max-height: 500px)');
let inspectorCollapsed = PHONE.matches; // phones start with details closed so the drawing gets the screen
let pendingRoom = null;         // room values awaiting shrink decision

const $ = (sel) => document.querySelector(sel);
const svgEl = (name, attrs = {}, parent = null) => {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
};
const el = (tag, attrs = {}, text = null) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k === 'class') e.className = v; else e.setAttribute(k, v);
  if (text !== null) e.textContent = text;   // plain text only — never HTML from user data
  return e;
};

// ---- Toast ---------------------------------------------------------------
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---- History (undo/redo) ---------------------------------------------------
function snapshot() { return JSON.stringify(job); }
function commit(mutate) {
  // Exception-safe: a mutation that throws (e.g. item cap) changes nothing and
  // leaves no empty undo frame.
  const pre = snapshot();
  try { mutate(); }
  catch (err) { toast(`Change not applied — ${err.message}`); renderAll(); return; }
  history.push(pre);
  if (history.length > C.LIMITS.historyLimit) history.shift();
  redoStack = [];
  job.revision += 1;
  renderAll();
  scheduleSave();
}
function undo() {
  if (!history.length) return;
  const prevRevision = job.revision;
  redoStack.push(snapshot());
  job = C.normaliseJob(JSON.parse(history.pop()));
  selectedId = job.items.some(i => i.id === selectedId) ? selectedId : null;
  job.revision = Math.max(job.revision, prevRevision) + 1; // never reuse a revision number
  renderAll(); scheduleSave();
}
function redo() {
  if (!redoStack.length) return;
  const prevRevision = job.revision;
  history.push(snapshot());
  job = C.normaliseJob(JSON.parse(redoStack.pop()));
  selectedId = job.items.some(i => i.id === selectedId) ? selectedId : null;
  job.revision = Math.max(job.revision, prevRevision) + 1;
  renderAll(); scheduleSave();
}

// ---- Storage (honest failures) ---------------------------------------------
let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
function saveNow() {
  const chip = $('#save-chip');
  chip.className = 'chip';
  chip.textContent = 'Saving…';
  let text;
  try {
    text = C.serialiseJob({ ...job, savedAt: new Date().toISOString() });
  } catch (err) {
    // The record itself failed validation — say that, never "storage full".
    if (String(err.message).includes('room')) {
      chip.className = 'chip warn';
      chip.textContent = 'Not saved yet — set the room size first';
    } else {
      chip.className = 'chip err';
      chip.textContent = `Not saved — job record problem (${String(err.message).slice(0, 60)}…). Keep this screen open.`;
    }
    chip.onclick = null;
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, text);
    job.savedAt = JSON.parse(text).savedAt; // in step with what was actually saved
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    chip.className = 'chip ok';
    chip.textContent = `Saved on this device · ${time}`;
    chip.onclick = null;
  } catch (err) {
    // Genuine storage failure: job stays on screen; offer a backup download.
    chip.className = 'chip err';
    chip.textContent = 'Not saved — storage full or blocked. Tap to download a backup.';
    chip.onclick = () => downloadBackup();
    toast('This device’s storage is full or blocked. Your job is still on screen — download a backup.');
  }
}
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const r = C.parseBackup(raw);
    return r.ok ? r.job : null;
  } catch { return null; }
}

// ---- Modal helpers ----------------------------------------------------------
function closeModal() { $('#modal-root').innerHTML = ''; }
function modal(title, bodyNodes, actions = []) {
  const overlay = el('div', { class: 'overlay' });
  const box = el('div', { class: 'modal' });
  box.appendChild(el('h2', {}, title));
  for (const n of bodyNodes) box.appendChild(n);
  const actRow = el('div', { class: 'actions' });
  for (const a of actions) {
    const b = el('button', { 'data-testid': a.testid || '' }, a.label);
    if (a.class) b.className = a.class;
    b.addEventListener('click', () => a.fn(box));
    actRow.appendChild(b);
  }
  box.appendChild(actRow);
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  $('#modal-root').innerHTML = '';
  $('#modal-root').appendChild(overlay);
  return box;
}

// ---- Coordinate geometry ----------------------------------------------------
// Oracle: walls are viewed from INSIDE the room, fromLeft 0 at the viewer's
// left. A: offset = x; B: offset = y; C: offset = W−x; D: offset = D−y.
function roomMm() {
  if (!job || !job.room) return { W: 0, D: 0, H: 0 };
  return { W: Math.round((job.room.widthM || 0) * 1000), D: Math.round((job.room.depthM || 0) * 1000), H: Math.round((job.room.heightM || 0) * 1000) };
}
// Wall letter → plan-space mapping (plan: x right, y down; A top, B right, C bottom, D left).
function planPos(item) {
  const { W, D } = roomMm();
  const f = item.fromLeftMm;
  switch (item.wall) {
    case 'A': return { x: f, y: 0 };
    case 'B': return { x: W, y: f };
    case 'C': return { x: W - f, y: D };
    case 'D': return { x: 0, y: D - f };
    default: return { x: item.fromLeftMm, y: item.heightMm }; // ceiling: (x across width, y across depth)
  }
}
// Inverse: plan point + chosen wall → fromLeft. Returns null if not near that wall.
function wallParamsFromPlan(x, y, wall) {
  const { W, D } = roomMm();
  const NEAR = Math.max(300, Math.round(Math.min(W, D) * 0.12));
  switch (wall) {
    case 'A': return y <= NEAR ? { fromLeft: Math.round(x), height: null } : null;
    case 'B': return x >= W - NEAR ? { fromLeft: Math.round(y), height: null } : null;
    case 'C': return y >= D - NEAR ? { fromLeft: Math.round(W - x), height: null } : null;
    case 'D': return x <= NEAR ? { fromLeft: Math.round(D - y), height: null } : null;
  }
  return null;
}
function nearestWallFromPlan(x, y) {
  const { W, D } = roomMm();
  // Absolute perpendicular distances: a tap beyond a wall's end (e.g. past the
  // right end of A) must stay nearest to that wall and clamp, not flip to the
  // perpendicular wall via a negative distance.
  const dists = { A: Math.abs(y), B: Math.abs(W - x), C: Math.abs(D - y), D: Math.abs(x) };
  return Object.keys(dists).reduce((a, b) => dists[a] <= dists[b] ? a : b);
}

// ---- Drawing: plan and wall views --------------------------------------------
const TYPE_COLOURS = { existing: '#777', unknown: '#b26a00' };

function fittingGlyph(item, x, y, labelBelow = true) {
  const g = svgEl('g', { class: 'fitting', 'data-id': item.id, transform: `translate(${x},${y})` });
  const t = C.TYPES[item.type];
  const isCeil = item.wall === C.CEILING;
  const col = TYPE_COLOURS[item.type] || '#1a1a1a';
  // distinct black-and-white-safe shapes per type
  if (isCeil) {
    // transparent fill (not 'none') so the whole disc is grabbable for dragging
    svgEl('circle', { cx: 0, cy: 0, r: 90, fill: 'transparent', stroke: col, 'stroke-dasharray': '40 30', 'stroke-width': 25 }, g);
  } else if (item.type === 'unknown') {
    svgEl('rect', { x: -110, y: -110, width: 220, height: 220, fill: '#fff3cd', stroke: col, 'stroke-width': 25, transform: 'rotate(45)' }, g);
  } else if (item.type === 'existing') {
    svgEl('rect', { x: -110, y: -110, width: 220, height: 220, fill: '#e8e8e8', stroke: col, 'stroke-width': 20, 'stroke-dasharray': '50 35' }, g);
    svgEl('line', { x1: -110, y1: -110, x2: 110, y2: 110, stroke: col, 'stroke-width': 12, 'stroke-dasharray': '30 30' }, g);
  } else if (item.type === 'switch') {
    svgEl('circle', { cx: 0, cy: 0, r: 110, fill: '#fff', stroke: col, 'stroke-width': 25 }, g);
  } else if (item.type === 'recessed') {
    svgEl('rect', { x: -110, y: -110, width: 220, height: 220, fill: '#fff', stroke: col, 'stroke-width': 25 }, g);
    svgEl('rect', { x: -50, y: -50, width: 100, height: 100, fill: 'none', stroke: col, 'stroke-width': 20 }, g);
  } else if (item.type === 'replacement') {
    svgEl('rect', { x: -110, y: -110, width: 220, height: 220, fill: '#fff', stroke: col, 'stroke-width': 25 }, g);
    svgEl('line', { x1: -110, y1: -110, x2: 110, y2: 110, stroke: col, 'stroke-width': 18 }, g);
    svgEl('line', { x1: 110, y1: -110, x2: -110, y2: 110, stroke: col, 'stroke-width': 18 }, g);
  } else {
    svgEl('rect', { x: -110, y: -110, width: 220, height: 220, fill: '#fff', stroke: col, 'stroke-width': 25 }, g);
  }
  const label = svgEl('text', { x: 0, y: labelBelow ? 250 : -350, 'text-anchor': 'middle', 'font-size': 150, fill: '#1a1a1a', 'font-family': 'inherit' }, g);
  label.textContent = `${item.id}·${t.symbol}`;
  return g;
}

function renderPlan(content, { W, D }) {
  svgEl('rect', { x: 0, y: 0, width: W, height: D, fill: '#fff', stroke: '#1a1a1a', 'stroke-width': 25 }, content);
  // wall labels: one label per wall, each with its length
  const dims = [
    { x: W / 2, y: -260, text: `Wall A · ${job.room.widthM.toFixed(2)} m`, wall: 'A' },
    { x: W / 2, y: D + 420, text: `Wall C · ${job.room.widthM.toFixed(2)} m`, wall: 'C' },
    { x: -420, y: D / 2, text: `Wall D · ${job.room.depthM.toFixed(2)} m`, wall: 'D', rot: true },
    { x: W + 420, y: D / 2, text: `Wall B · ${job.room.depthM.toFixed(2)} m`, wall: 'B', rot: true },
  ];
  for (const d of dims) {
    const t = svgEl('text', {
      x: d.x, y: d.y, 'text-anchor': 'middle', 'font-size': 240,
      fill: '#23324d', 'font-family': 'inherit',
      transform: d.rot ? `rotate(-90 ${d.x} ${d.y})` : '', class: 'wall-letter', 'data-wall': d.wall,
    }, content);
    t.textContent = d.text;
  }
  // label-side bookkeeping so nearby fittings keep readable, separate labels
  const placedLabels = [];
  const labelFits = (x, gy, below) => !placedLabels.some(q =>
    q.below === below && Math.abs(q.x - x) < 900 && Math.abs(q.gy - gy) < 600);
  for (const item of job.items) {
    if (item.wall === C.CEILING) {
      const g = fittingGlyph(item, item.fromLeftMm, item.heightMm, true);
      g.setAttribute('opacity', '0.75');
      content.appendChild(g);
      continue;
    }
    const p = planPos(item);
    // sit just inside the wall line
    const inset = { A: [0, 260], B: [-260, 0], C: [0, -260], D: [260, 0] }[item.wall];
    const gx = p.x + inset[0], gy = p.y + inset[1];
    // default: label on the room side of the wall line (A: below, C: above)
    let below = item.wall !== 'C';
    if (!labelFits(gx, gy, below) && labelFits(gx, gy, !below)) below = !below;
    placedLabels.push({ x: gx, gy, below });
    content.appendChild(fittingGlyph(item, gx, gy, below));
  }
  for (const s of (job.annotations.PLAN || [])) {
    const pl = svgEl('polyline', { points: s.points.map(pt => pt.join(',')).join(' '), fill: 'none', stroke: '#2266cc', 'stroke-width': 25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, content);
    pl.setAttribute('class', 'stroke');
  }
  return { margin: 500 };
}

function renderWall(content, wall, { W, D, H }, forPrint = false) {
  const L = (wall === 'A' || wall === 'C') ? W : D;
  svgEl('line', { x1: 0, y1: H, x2: L, y2: H, stroke: '#1a1a1a', 'stroke-width': 40 }, content); // floor line
  const hT = svgEl('text', { x: L + 380, y: H / 2, 'font-size': 240, fill: '#555', 'font-family': 'inherit', 'text-anchor': 'middle', transform: `rotate(-90 ${L + 380} ${H / 2})` }, content);
  hT.textContent = `${job.room.heightM.toFixed(2)} m`;
  const lT = svgEl('text', { x: L / 2, y: H + 420, 'font-size': 260, fill: '#23324d', 'text-anchor': 'middle', 'font-family': 'inherit' }, content);
  lT.textContent = `Wall ${wall} · ${(L / 1000).toFixed(2)} m — viewed from inside`;
  for (const item of job.items) {
    if (item.wall === C.CEILING) {
      // Printed wall drawings omit the projection ticks: the small grey labels
      // collide at print scale, and the ceiling table on the same page already
      // lists them. Live wall views keep the ticks.
      if (forPrint) continue;
      // Ceiling fittings are drawn only as clearly labelled projection ticks on
      // the ceiling line — they are never wall mounted. Position along each
      // wall follows the same "viewed from inside" oracle as wall fittings:
      // A: x; B: y; C: W−x; D: D−y.
      const along = {
        A: item.fromLeftMm,
        B: item.heightMm,
        C: W - item.fromLeftMm,
        D: D - item.heightMm,
      }[wall];
      svgEl('line', { x1: along, y1: 0, x2: along, y2: 120, stroke: '#999', 'stroke-width': 25, 'stroke-dasharray': '60 40' }, content);
      const t = svgEl('text', { x: along, y: -140, 'font-size': 150, fill: '#777', 'text-anchor': 'middle', 'font-family': 'inherit' }, content);
      t.textContent = `${item.id}·DL (ceiling)`;
      continue;
    }
    if (item.wall !== wall) continue;
    content.appendChild(fittingGlyph(item, item.fromLeftMm, H - item.heightMm));
    if (item.id === selectedId) {
      svgEl('line', { x1: 0, y1: H - item.heightMm, x2: item.fromLeftMm, y2: H - item.heightMm, stroke: '#b26a00', 'stroke-width': 18, 'stroke-dasharray': '80 50' }, content);
      svgEl('line', { x1: item.fromLeftMm, y1: H, x2: item.fromLeftMm, y2: H - item.heightMm, stroke: '#b26a00', 'stroke-width': 18, 'stroke-dasharray': '80 50' }, content);
    }
  }
  for (const s of job.annotations[wall] || []) {
    const pl = svgEl('polyline', { points: s.points.map(pt => pt.join(',')).join(' '), fill: 'none', stroke: '#2266cc', 'stroke-width': 25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'stroke' }, content);
    pl.setAttribute('data-index', job.annotations[wall].indexOf(s));
  }
  return { L, H };
}

function renderCanvas() {
  const svg = $('#canvas');
  svg.innerHTML = '';
  if (!job || !job.room || !job.room.widthM) { svg.setAttribute('viewBox', '0 0 100 100'); return; }
  const dims = roomMm();
  let vbW, vbH;
  if (view === 'PLAN') { vbW = dims.W + 1800; vbH = dims.D + 1800; }
  else { const L = (view === 'A' || view === 'C') ? dims.W : dims.D; vbW = L + 1800; vbH = dims.H + 1800; }
  svg.setAttribute('viewBox', `${-900} ${-900} ${vbW} ${vbH}`);
  const world = svgEl('g', { id: 'world', transform: `translate(${zoom.tx} ${zoom.ty}) scale(${zoom.s})` }, svg);
  const content = svgEl('g', {}, world);
  if (view === 'PLAN') renderPlan(content, dims);
  else renderWall(content, view, dims);
  // note pins
  const pins = (job.notePins || []).filter(p => p.view === view);
  for (const p of pins) {
    const g = svgEl('g', { transform: `translate(${p.x},${p.y})`, class: 'note-pin', 'data-id': p.id }, content);
    svgEl('circle', { cx: 0, cy: 0, r: 160, fill: '#fff3cd', stroke: '#8a7a2a', 'stroke-width': 20 }, g);
    const t = svgEl('text', { x: 0, y: 60, 'font-size': 200, 'text-anchor': 'middle' }, g);
    t.textContent = 'N';
    const lb = svgEl('text', { x: 0, y: 340, 'font-size': 150, 'text-anchor': 'middle', fill: '#444' }, g);
    lb.textContent = p.text.slice(0, 40);
  }
  if (selectedId) {
    const sel = svg.querySelector(`.fitting[data-id="${selectedId}"]`);
    if (sel) { const r = svgEl('rect', { x: -180, y: -180, width: 360, height: 360, fill: 'none', stroke: '#2266cc', 'stroke-width': 40 }); sel.insertBefore(r, sel.firstChild); }
  }
  $('#hint').textContent = {
    select: 'Tap a fitting to select it. Drag to move.',
    place: C.TYPES[placeType].label + (placeType === 'downlight' ? ' — tap the ceiling in the plan view.' : ' — tap on the wall where the fitting goes.'),
    draw: 'Sketches are notes only. They are never priced.',
    notes: 'Tap to add a note.',
  }[mode];
}

// ---- Tabs, quote bar, inspector ----------------------------------------------
function renderTabs() {
  const tabs = $('#view-tabs');
  tabs.innerHTML = '';
  if (!job) return;
  const ceilN = job.items.filter(i => i.wall === C.CEILING).length;
  const defs = ['PLAN', 'A', 'B', 'C', 'D'].map(v => {
    // wall tabs count fittings mounted on that wall only; downlights are
    // ceiling fittings (shown in plan and as projection ticks on wall views)
    const n = v === 'PLAN'
      ? job.items.length
      : job.items.filter(i => i.wall === v).length;
    return { v, label: v === 'PLAN' ? `Plan (${n})` : `Wall ${v} (${n})`, n };
  });
  if (ceilN) defs.push({ v: null, label: `Ceiling fittings: ${ceilN} (plan only)`, n: ceilN, info: true });
  for (const d of defs) {
    if (d.info) {
      tabs.appendChild(el('span', { class: 'tabs-info', style: 'align-self:center;font-size:13px;color:#555;padding:0 6px' }, d.label));
      continue;
    }
    const b = el('button', { 'data-view': d.v, 'data-testid': `tab-${d.v}`, class: view === d.v ? 'active' : '' }, d.label);
    b.addEventListener('click', () => { view = d.v; renderAll(); });
    tabs.appendChild(b);
  }
}

function renderQuote() {
  const bd = C.breakdown(job);
  const bar = $('#quote-bar');
  bar.classList.toggle('incomplete', !bd.complete);
  const sum = $('#quote-summary');
  sum.innerHTML = '';
  if (!job.items.length) { sum.textContent = 'No fittings yet.'; return; }
  const pricedQty = bd.rows.filter(r => r.status === 'priced').reduce((s, r) => s + r.qty, 0);
  // Phones hide the q-count/q-priced/q-existing/q-detail/q-long parts (see
  // style.css) so the bar stays short; the text content is the same everywhere.
  const chip = (txt, cls) => { const s = el('span', { class: `q-chip ${cls}` }, txt); s.style.whiteSpace = 'nowrap'; return s; };
  sum.append(
    chip(`${job.items.length} fittings`, 'q-count'),
    chip(`${pricedQty} priced`, 'q-priced'),
  );
  if (bd.unpricedCount) {
    // name exactly what needs a price: unpriced work types and unknown fitting IDs
    const missing = [
      ...bd.rows.filter(r => r.status === 'unpriced').map(r => r.label.toLowerCase()),
      ...job.items.filter(i => i.type === 'unknown').map(i => i.id),
    ];
    const warn = chip(null, 'q-warn');
    warn.append(
      el('span', { 'aria-hidden': 'true' }, '⚠ '),
      `${bd.unpricedCount} ${bd.unpricedCount === 1 ? 'needs' : 'need'} a price`,
      el('span', { class: 'q-detail' }, ` (${missing.join(', ')})`),
    );
    sum.append(warn);
  }
  const total = chip(bd.complete ? `Total ${C.formatPence(bd.totalPence)}` : `${C.formatPence(bd.totalPence)} so far`, 'q-total');
  if (!bd.complete) total.append(el('span', { class: 'q-long' }, ' — total incomplete'));
  sum.append(total);
  if (bd.existingQty) sum.append(chip(`${bd.existingQty} existing not counted`, 'q-existing'));
}

// Phones: a bottom sheet that shrinks to its header. Tablet and desktop: a right
// drawer that shrinks to a narrow strip holding only this button (style.css).
function inspectorToggle() {
  const toggle = el('button', { id: 'btn-inspector-toggle', class: 'inspector-toggle', 'aria-expanded': String(!inspectorCollapsed) }, inspectorCollapsed ? 'Show details' : 'Hide details');
  toggle.addEventListener('click', () => {
    inspectorCollapsed = !inspectorCollapsed;
    renderAll();
    $('#inspector').scrollTop = 0;
    // the panel is rebuilt, so hand focus to the new toggle
    const next = $('#btn-inspector-toggle');
    if (next) next.focus({ preventScroll: true });
  });
  return toggle;
}

function inspectorRoomPanel() {
  const box = $('#inspector');
  box.innerHTML = '';
  const title = el('h2', {}, 'Room');
  const toggle = inspectorToggle();
  const head = el('div', { class: 'inspector-head' });
  head.append(title, toggle);
  box.appendChild(head);
  if (inspectorCollapsed) return;
  box.appendChild(el('p', { class: 'job-title' }, `${job.name}`));
  if (job.room && job.room.widthM) {
    box.appendChild(el('p', {}, `${job.room.widthM.toFixed(2)} × ${job.room.depthM.toFixed(2)} × ${job.room.heightM.toFixed(2)} m (w × d × h)`));
  }
  const sizeBtn = el('button', { 'data-testid': 'room-size', class: 'btn-primary' }, 'Room size');
  sizeBtn.addEventListener('click', openRoomForm);
  box.appendChild(sizeBtn);
  box.appendChild(el('label', {}, 'Job notes'));
  const ta = el('textarea', { 'data-testid': 'job-notes' });
  ta.value = job.jobNotes;
  box.appendChild(ta);
  ta.addEventListener('change', () => commit(() => { job.jobNotes = ta.value.slice(0, 5000); }));
  const bd = C.breakdown(job);
  const pricedQty = bd.rows.filter(r => r.status === 'priced').reduce((s, r) => s + r.qty, 0);
  const counts = el('p', { class: 'count-line' });
  const cnt = (t) => { const s = el('span', { class: 'q-chip' }, t); s.style.whiteSpace = 'nowrap'; return s; };
  counts.append(cnt(`${job.items.length} fittings`), cnt(`${pricedQty} priced`), cnt(`${bd.unpricedCount} ${bd.unpricedCount === 1 ? 'needs' : 'need'} a price`), cnt(`${bd.existingQty} existing not counted`));
  box.appendChild(counts);
  const ratesBtn = el('button', { 'data-testid': 'rates-open' }, 'Rates for this job');
  ratesBtn.addEventListener('click', openRates);
  box.appendChild(ratesBtn);
  // symbol legend so every ID label on the drawings is readable
  box.appendChild(el('label', {}, 'Fitting symbols'));
  const legend = el('ul', { class: 'legend' });
  for (const t of Object.values(C.TYPES)) {
    legend.appendChild(el('li', {}, `${t.symbol} = ${t.label}`));
  }
  legend.appendChild(el('li', {}, 'F1, F2… are fitting numbers. The letters after the dot are the fitting type.'));
  legend.appendChild(el('li', {}, 'Dashed circles are ceiling fittings (plan view only)'));
  box.appendChild(legend);
}

function renderInspector() {
  document.body.classList.toggle('inspector-collapsed', inspectorCollapsed);
  const item = job.items.find(i => i.id === selectedId);
  if (!item) { inspectorRoomPanel(); return; }
  const box = $('#inspector');
  box.innerHTML = '';
  const toggle = inspectorToggle();
  const done = el('button', { class: 'inspector-toggle inspector-done' }, 'Done');
  done.addEventListener('click', () => { selectedId = null; renderAll(); });
  const head = el('div', { class: 'inspector-head' });
  head.append(el('h2', {}, `${item.id} · ${C.TYPES[item.type].label}`), toggle, done);
  box.appendChild(head);
  if (inspectorCollapsed) return;

  const label = (txt) => box.appendChild(el('label', {}, txt));
  const typeSel = el('select', { 'data-testid': 'ins-type' });
  for (const [k, t] of Object.entries(C.TYPES)) typeSel.appendChild(el('option', { value: k }, t.label));
  typeSel.value = item.type;
  label('Type');
  box.appendChild(typeSel);
  typeSel.addEventListener('change', () => commit(() => {
    item.type = typeSel.value;
    if (item.wall === C.CEILING && typeSel.value !== 'downlight') item.wall = 'A';
    if (typeSel.value === 'downlight') item.wall = C.CEILING;
    C.clampItem(job, item);
  }));

  const wallSel = el('select', { 'data-testid': 'ins-wall' });
  if (item.type === 'downlight') {
    wallSel.appendChild(el('option', { value: C.CEILING }, 'Ceiling'));
  } else {
    for (const w of C.WALLS) wallSel.appendChild(el('option', { value: w }, `Wall ${w}`));
  }
  wallSel.value = item.wall;
  label('Wall');
  box.appendChild(wallSel);
  wallSel.addEventListener('change', () => commit(() => { item.wall = wallSel.value; C.clampItem(job, item); }));

  const mkNum = (idAttr, text, key) => {
    label(text);
    const row = el('div', { class: 'field-row' });
    const input = el('input', { type: 'number', inputmode: 'numeric', 'data-testid': idAttr, step: '10' });
    input.value = item[key];
    const minus = el('button', {}, '−50');
    const plus = el('button', {}, '+50');
    const errP = el('p', { class: 'field-err' }); errP.hidden = true;
    const apply = (v) => {
      const max = key === 'fromLeftMm' ? C.maxFromLeft(job, item) : C.maxHeight(job, item);
      if (!Number.isFinite(v) || v < 0 || v > max) {
        errP.textContent = key === 'fromLeftMm'
          ? `Enter 0–${max.toLocaleString('en-GB')} mm along this wall.`
          : `Enter 0–${max.toLocaleString('en-GB')} mm.`;
        errP.hidden = false; input.value = item[key]; return;
      }
      errP.hidden = true;
      commit(() => { item[key] = Math.round(v); });
    };
    input.addEventListener('change', () => apply(Number(input.value)));
    minus.addEventListener('click', () => apply(item[key] - 50));
    plus.addEventListener('click', () => apply(item[key] + 50));
    row.append(input, minus, plus);
    box.append(row, errP);
  };
  const ceiling = item.wall === C.CEILING;
  mkNum('ins-fromleft', ceiling ? 'Across width (mm)' : 'From left end of wall (mm)', 'fromLeftMm');
  mkNum('ins-height', ceiling ? 'Across depth (mm)' : 'Height to centre (mm)', 'heightMm');

  label('Notes');
  const ta = el('textarea', { 'data-testid': 'ins-notes' });
  ta.value = item.notes;
  box.appendChild(ta);
  ta.addEventListener('change', () => commit(() => { item.notes = ta.value.slice(0, C.LIMITS.maxTextLen); }));

  const price = el('p', { class: 'price-line', 'data-testid': 'price-line' });
  if (item.type === 'existing') price.textContent = 'Existing — no work, not counted';
  else if (item.type === 'unknown') price.textContent = 'Unknown — needs a price before quoting';
  else {
    const rate = C.rateFor(job, item.type);
    price.textContent = rate === null ? '⚠ No rate set — shown as unpriced' : `Priced as ${C.TYPES[item.type].label} · ${C.formatPence(rate)}`;
  }
  box.appendChild(price);

  const del = el('button', { class: 'btn-danger', 'data-testid': 'delete-fitting' }, 'Delete fitting');
  del.addEventListener('click', () => {
    const id = item.id;
    commit(() => { job.items = job.items.filter(i => i.id !== id); });
    selectedId = null;
    toast(`${id} deleted · Undo`);
  });
  box.appendChild(del);
}

function renderAll() {
  if (!job) return;
  $('#btn-undo').disabled = !history.length;
  $('#btn-redo').disabled = !redoStack.length;
  $('#sample-chip').hidden = !job.sample;
  $('#btn-job-name').textContent = job.name;
  renderTabs(); renderCanvas(); renderInspector(); renderQuote();
  syncFooterHeight();
}

// Portrait layout: the quote bar (total + breakdown) must stay visible ABOVE the
// inspector bottom sheet. Its height varies when the chips wrap, so measure it
// and expose the real height to CSS for the sheet's scroll clearance.
function syncFooterHeight() {
  const bar = $('#quote-bar');
  if (bar) document.documentElement.style.setProperty('--footer-h', (bar.offsetHeight + 2) + 'px');
}
window.addEventListener('resize', syncFooterHeight);
// Crossing the phone breakpoint (resize, or a small tablet rotating) resets the
// details panel to that layout's default: closed on phones, open elsewhere.
const onPhoneChange = () => { inspectorCollapsed = PHONE.matches; renderAll(); };
if (PHONE.addEventListener) PHONE.addEventListener('change', onPhoneChange);
else PHONE.addListener(onPhoneChange);

// ---- Room size form -----------------------------------------------------------
function openRoomForm() {
  const box = el('div');
  const fields = {};
  const mk = (key, labelTxt, max) => {
    box.appendChild(el('label', {}, labelTxt));
    const i = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0.1', max: String(max), 'data-testid': `room-${key}` });
    i.value = job.room[key] ?? '';
    box.appendChild(i);
    fields[key] = { input: i, max };
  };
  mk('widthM', 'Width (m)', C.LIMITS.maxWallM);
  mk('depthM', 'Depth (m)', C.LIMITS.maxWallM);
  mk('heightM', 'Height (m)', C.LIMITS.maxHeightM);
  const errP = el('p', { class: 'field-err' }); errP.hidden = true; box.appendChild(errP);
  modal('Room size', [box], [
    { label: 'Cancel', fn: closeModal },
    {
      label: 'Save', class: 'btn-primary', testid: 'room-save', fn: () => {
        const vals = {};
        for (const k of ['widthM', 'depthM', 'heightM']) {
          const v = Number(fields[k].input.value);
          const max = k === 'heightM' ? C.LIMITS.maxHeightM : C.LIMITS.maxWallM;
          if (!(v >= 0.1 && v <= max)) {
            errP.hidden = false;
            errP.textContent = `Enter a ${k === 'heightM' ? 'height' : k.replace('M', '')} between 0.10 m and ${max} m.`;
            return;
          }
          vals[k] = Math.round(v * 100) / 100;
        }
        const outside = C.itemsOutside(job, vals.widthM, vals.depthM, vals.heightM);
        if (outside.length) { closeModal(); askShrink(vals, outside); return; }
        commit(() => { job.room = vals; });
        closeModal();
      },
    },
  ]);
}
function askShrink(vals, outside) {
  modal(`${outside.length} fitting${outside.length > 1 ? 's' : ''} would sit outside the new size`,
    [el('p', {}, `${outside.map(i => i.id).join(', ')} fall outside a ${vals.widthM.toFixed(2)} × ${vals.depthM.toFixed(2)} × ${vals.heightM.toFixed(2)} m room.`)],
    [
      { label: 'Cancel', fn: closeModal },
      {
        label: 'Move them to the nearest edge', class: 'btn-primary', testid: 'shrink-move', fn: () => {
          commit(() => { job.room = vals; C.moveOutsideItemsToEdge(job, vals.widthM, vals.depthM, vals.heightM); });
          closeModal(); toast('Kept inside the room');
        },
      },
    ]);
}

// ---- Rates -----------------------------------------------------------------
function openRates() {
  const box = el('div');
  box.appendChild(el('p', {}, 'These rates are saved with this job. Changing them reprices this job only.'));
  const inputs = {};
  for (const k of C.RATE_KEYS) {
    const row = el('div', { class: 'rate-input-row' });
    row.appendChild(el('span', {}, C.TYPES[k].label));
    const i = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0.01', 'data-testid': `rate-${k}` });
    i.value = C.rateFor(job, k) === null ? '' : (C.rateFor(job, k) / 100).toFixed(2);
    i.placeholder = 'unpriced';
    row.appendChild(i);
    inputs[k] = i;
    box.appendChild(row);
  }
  const errP = el('p', { class: 'field-err' }); errP.hidden = true; box.appendChild(errP);
  box.appendChild(el('p', { class: 'field-err' }, 'Leave blank to mark a type unpriced. Enter a price above £0, or leave blank.'));
  modal('Rates for this job', [box], [
    { label: 'Cancel', fn: closeModal },
    {
      label: 'Save rates', class: 'btn-primary', testid: 'rates-save', fn: () => {
        const next = { ...job.rates };
        for (const k of C.RATE_KEYS) {
          const raw = inputs[k].value.trim();
          if (raw === '') { next[k] = null; continue; }
          const p = Math.round(Number(raw) * 100);
          if (!Number.isFinite(p) || p <= 0) {
            errP.hidden = false;
            errP.textContent = `${C.TYPES[k].label}: enter a price above £0, or leave blank to mark unpriced.`;
            return;
          }
          next[k] = p;
        }
        commit(() => { job.rates = next; });
        closeModal();
      },
    },
  ]);
}

// ---- Breakdown drawer ---------------------------------------------------------
function openBreakdown() {
  const bd = C.breakdown(job);
  const box = el('div');
  const table = el('table');
  const head = el('tr');
  for (const h of ['Work type', 'Qty', 'Rate', 'Line total']) head.appendChild(el('th', {}, h));
  table.appendChild(head);
  for (const r of bd.rows) {
    const tr = el('tr', { class: r.status === 'unpriced' ? 'unpriced' : '' });
    tr.append(
      el('td', {}, r.label), el('td', {}, String(r.qty)),
      el('td', {}, r.ratePence === null ? '—' : C.formatPence(r.ratePence)),
      el('td', {}, r.linePence === null ? '⚠ No rate — not included in total' : C.formatPence(r.linePence)),
    );
    table.appendChild(tr);
  }
  if (bd.unknownQty) {
    const tr = el('tr', { class: 'unpriced' });
    tr.append(el('td', {}, C.TYPES.unknown.label), el('td', {}, String(bd.unknownQty)), el('td', {}, '—'), el('td', {}, '⚠ Unknown — needs a price'));
    table.appendChild(tr);
  }
  if (bd.existingQty) {
    const tr = el('tr');
    tr.append(el('td', {}, C.TYPES.existing.label), el('td', {}, String(bd.existingQty)), el('td', {}, '—'), el('td', {}, 'No work, not counted'));
    table.appendChild(tr);
  }
  box.appendChild(table);
  box.appendChild(el('p', {}, bd.complete ? `Total ${C.formatPence(bd.totalPence)}` : `Total so far ${C.formatPence(bd.totalPence)} — incomplete, ${bd.unpricedCount} type${bd.unpricedCount > 1 ? 's' : ''} unpriced`));
  box.appendChild(el('p', { style: 'font-size:13px' }, 'Example labour rates only. Not a quotation or installation advice.'));
  modal('Labour breakdown', [box], [
    { label: 'Edit rates', testid: 'breakdown-edit-rates', fn: () => { closeModal(); openRates(); } },
    { label: 'Close', class: 'btn-primary', fn: closeModal },
  ]);
}

// ---- Exports ------------------------------------------------------------------
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function jobSlug() { return job.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'job'; }
function stamp() { const d = new Date(); return `${d.toISOString().slice(0, 10)}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`; }
function downloadBackup() {
  try {
    const text = C.serialiseJob({ ...job, savedAt: new Date().toISOString() });
    download(`${jobSlug()}-${stamp()}.json`, text, 'application/json');
    toast('Backup downloaded. Keep it somewhere safe — this app doesn’t sync anywhere.');
    return true;
  } catch (err) {
    toast(String(err.message).includes('room')
      ? 'Can’t back up yet — set the room size first.'
      : `Can’t back up yet — ${err.message}`);
    return false;
  }
}
function downloadCsv() { download(`${jobSlug()}-labour.csv`, C.jobCsv(job), 'text/csv'); }

// ---- Print pack -----------------------------------------------------------------
function buildPrintPack(includeInk = true) {
  const pack = $('#print-pack');
  pack.innerHTML = '';
  const dims = roomMm();
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const savedStr = job.savedAt ? `saved ${new Date(job.savedAt).toLocaleString('en-GB')}` : 'not yet saved';
  const mkPage = () => {
    const p = el('div', { class: 'page' });
    const h = el('div', { class: 'print-header' });
    h.append(el('strong', {}, `${job.name} — prototype, example rates`), el('span', {}, `revision ${job.revision} · ${savedStr} · printed ${dateStr}`));
    p.appendChild(h);
    pack.appendChild(p);
    return p;
  };
  const svgFor = (viewName) => {
    const svg = document.createElementNS(NS, 'svg');
    let vbW, vbH;
    const tmpWorld = svgEl('g');
    if (viewName === 'PLAN') {
      vbW = dims.W + 1600; vbH = dims.D + 1600;
      svg.setAttribute('viewBox', `-800 -800 ${vbW} ${vbH}`);
      if (!includeInk) job.annotations.PLAN.forEach(() => { });
      const saved = job.annotations.PLAN; if (!includeInk) job.annotations.PLAN = [];
      renderPlan(tmpWorld, dims);
      if (!includeInk) job.annotations.PLAN = saved;
    } else {
      const L = (viewName === 'A' || viewName === 'C') ? dims.W : dims.D;
      vbW = L + 1600; vbH = dims.H + 1600;
      svg.setAttribute('viewBox', `-800 -800 ${vbW} ${vbH}`);
      const saved = job.annotations[viewName]; if (!includeInk) job.annotations[viewName] = [];
      renderWall(tmpWorld, viewName, dims, true);
      if (!includeInk) job.annotations[viewName] = saved;
    }
    while (tmpWorld.firstChild) svg.appendChild(tmpWorld.firstChild);
    return svg;
  };
  const itemTable = (items, ceilingCoords = false) => {
    const t = el('table');
    const head = el('tr');
    // ceiling fittings store plan x/y, not a mounting height
    const cols = ceilingCoords ? ['ID', 'Type', 'x (mm)', 'y (mm)', 'Notes'] : ['ID', 'Type', 'From left (mm)', 'Height (mm)', 'Notes'];
    for (const h of cols) head.appendChild(el('th', {}, h));
    t.appendChild(head);
    for (const it of items) {
      const tr = el('tr');
      tr.append(el('td', {}, it.id), el('td', {}, C.TYPES[it.type].label),
        el('td', {}, it.wall === C.CEILING ? `x ${it.fromLeftMm}` : String(it.fromLeftMm)),
        el('td', {}, it.wall === C.CEILING ? `y ${it.heightMm}` : String(it.heightMm)),
        el('td', {}, it.notes || ''));
      t.appendChild(tr);
    }
    return t;
  };

  // Page 1: plan, legend, room, notes
  const p1 = mkPage();
  p1.appendChild(el('h2', {}, 'Floor plan'));
  p1.appendChild(svgFor('PLAN'));
  const legend = el('p', { style: 'font-size:9.5pt' });
  legend.textContent = Object.values(C.TYPES).map(t => `${t.symbol} = ${t.label}`).join(' · ') + ' · downlights shown dashed on the ceiling';
  p1.appendChild(legend);
  p1.appendChild(el('h2', {}, 'Room and job notes'));
  p1.appendChild(el('p', {}, `${job.room.widthM.toFixed(2)} × ${job.room.depthM.toFixed(2)} × ${job.room.heightM.toFixed(2)} m (w × d × h)`));
  p1.appendChild(el('p', {}, job.jobNotes || '(no job notes)'));

  // Pages 2–3: two walls per page
  let page = null;
  C.WALLS.forEach((w, idx) => {
    if (idx % 2 === 0) page = mkPage();
    page.appendChild(el('h2', {}, `Wall ${w}`));
    page.appendChild(svgFor(w));
    page.appendChild(itemTable(job.items.filter(i => i.wall === w)));
  });
  // ceiling items table appended to wall D page
  const ceil = job.items.filter(i => i.wall === C.CEILING);
  if (ceil.length) {
    page.appendChild(el('h2', {}, 'Ceiling fittings'));
    page.appendChild(itemTable(ceil, true));
  }

  // Last page: labour breakdown
  const pL = mkPage();
  pL.appendChild(el('h2', {}, 'Labour breakdown'));
  const bd = C.breakdown(job);
  const t = el('table');
  const head = el('tr');
  for (const h of ['Work type', 'Qty', 'Rate', 'Line total', 'Status']) head.appendChild(el('th', {}, h));
  t.appendChild(head);
  for (const r of bd.rows) {
    const tr = el('tr');
    tr.append(el('td', {}, r.label), el('td', {}, String(r.qty)),
      el('td', {}, r.ratePence === null ? '—' : C.formatPence(r.ratePence)),
      el('td', {}, r.linePence === null ? '—' : C.formatPence(r.linePence)),
      el('td', {}, r.status));
    t.appendChild(tr);
  }
  if (bd.unknownQty) {
    const tr = el('tr');
    tr.append(el('td', {}, C.TYPES.unknown.label), el('td', {}, String(bd.unknownQty)), el('td', {}, '—'), el('td', {}, '—'), el('td', {}, 'unpriced'));
    t.appendChild(tr);
  }
  if (bd.existingQty) {
    const tr = el('tr');
    tr.append(el('td', {}, C.TYPES.existing.label), el('td', {}, String(bd.existingQty)), el('td', {}, '—'), el('td', {}, '—'), el('td', {}, 'excluded — no work'));
    t.appendChild(tr);
  }
  pL.appendChild(t);
  pL.appendChild(el('p', {}, bd.complete ? `Total ${C.formatPence(bd.totalPence)}` : `Total so far ${C.formatPence(bd.totalPence)} — incomplete, ${bd.unpricedCount} unpriced`));
  pL.appendChild(el('p', { class: 'disclaimer' }, 'Prototype with example labour rates only. Not a quotation, electrical design or installation advice. Cable and material costs are not included.'));
  pL.appendChild(el('p', { class: 'disclaimer' }, 'Tested with simulated pen and touch. Not yet tried on a real Surface; palm rejection unverified.'));

  // page footers
  const pages = pack.querySelectorAll('.page');
  pages.forEach((p, i) => p.appendChild(el('p', { style: 'font-size:9pt;text-align:right' }, `Page ${i + 1} of ${pages.length}`)));
}

function openPrint() {
  modal('Print', [el('p', {}, 'Prints the plan, all four wall views with fittings, and the labour breakdown.')], [
    { label: 'Cancel', fn: closeModal },
    { label: 'Print', class: 'btn-primary', testid: 'print-go', fn: () => {
      closeModal();
      // wait for the debounced save first, so the header shows a real saved
      // time (bounded: never blocks printing for more than 2 s)
      const t0 = Date.now();
      const go = () => { buildPrintPack(true); setTimeout(() => window.print(), 50); };
      const tick = () => (job.savedAt || Date.now() - t0 > 2000) ? go() : setTimeout(tick, 100);
      tick();
    } },
  ]);
}

// ---- Menu / start flows -----------------------------------------------------------
function openMenu() {
  const box = el('div');
  // Phones can scroll the status chips out of sight, so repeat them here.
  const status = [$('#save-chip').textContent, $('#offline-chip').textContent, job.sample ? 'Sample job with example data' : 'Example rates only'];
  box.appendChild(el('p', { class: 'menu-status', 'data-testid': 'menu-status', style: 'font-size:14px;margin:0 0 8px' }, status.join(' · ')));
  const items = [
    ['New job', () => { closeModal(); confirmNewJob(); }],
    ['Room size', () => { closeModal(); openRoomForm(); }],
    ['Rates for this job', () => { closeModal(); openRates(); }],
    ['Download backup (JSON)', () => { closeModal(); downloadBackup(); }],
    ['Import backup', () => { closeModal(); $('#file-input').click(); }],
    ['Download CSV', () => { closeModal(); downloadCsv(); }],
    ['Print', () => { closeModal(); openPrint(); }],
    ['About this prototype', () => { closeModal(); openAbout(); }],
  ];
  for (const [label, fn] of items) {
    const b = el('button', { style: 'width:100%;margin:4px 0' }, label);
    b.addEventListener('click', fn);
    box.appendChild(b);
  }
  const check = el('div', { class: 'drawing-check', 'data-testid': 'drawing-check', style: 'font-size:13px;margin-top:12px;border-top:1px solid #ccc;padding-top:8px' });
  check.appendChild(el('p', { style: 'margin:0 0 4px;font-weight:600' }, 'Drawing check (for support)'));
  for (const line of drawingCheckLines()) check.appendChild(el('p', { style: 'margin:0' }, line));
  box.appendChild(check);
  modal('Menu', [box], [{ label: 'Close', class: 'btn-primary', fn: closeModal }]);
}

function openAbout() {
  modal('About this prototype', [
    el('p', {}, 'Your job is saved in this browser on this device only. It isn’t sent anywhere and doesn’t sync. Clearing browser data deletes it, so download a backup to keep a copy.'),
    el('p', {}, 'Example labour rates only. Not a quotation, electrical design or compliance tool.'),
    el('p', {}, 'Tested with simulated pen and touch. Not yet tried on a real Surface, and palm rejection is unverified.'),
  ], [{ label: 'Close', class: 'btn-primary', fn: closeModal }]);
}

function confirmNewJob() {
  modal('Start a new job', [el('p', {}, 'This replaces your current job. Download a backup first?')], [
    { label: 'Cancel', fn: closeModal },
    { label: 'Continue without backup', testid: 'newjob-nobackup', fn: () => { closeModal(); showStart(); } },
    { label: 'Download and continue', class: 'btn-primary', fn: () => { downloadBackup(); closeModal(); showStart(); } },
  ]);
}

function showStart() {
  const saved = loadSaved();
  $('#start').hidden = false;
  $('#app').hidden = true;
  $('#start-continue').hidden = !saved;
}
function beginJob(j) {
  job = C.normaliseJob(j); history = []; redoStack = []; selectedId = null; view = 'PLAN'; zoom = { s: 1, tx: 0, ty: 0 };
  $('#start').hidden = true; $('#app').hidden = false;
  renderAll();
  if (!job.room.widthM) openRoomForm();
  scheduleSave();
}

// ---- Import ------------------------------------------------------------------------
$('#file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  file.text().then((text) => {
    let r;
    try { r = C.parseBackup(text); }
    catch (err) { r = { ok: false, errors: [String(err && err.message || err)] }; }
    if (!r.ok) {
      modal('Import failed', [
        el('p', {}, `This file isn’t a valid job backup (${r.errors[0]}). Nothing has changed.`),
      ], [{ label: 'Close', class: 'btn-primary', fn: closeModal }]);
      return;
    }
    const s = C.summariseBackup(r.job);
    const checkbox = el('input', { type: 'checkbox' }); checkbox.checked = true;
    const lbl = el('label', {}, 'Download current job first'); lbl.prepend(checkbox);
    modal('Import backup', [
      el('p', {}, `“${s.name}” · ${s.size} · ${s.items} fittings · saved ${new Date(s.savedAt).toLocaleString('en-GB')}${s.complete ? '' : ' · contains unpriced items'}`),
      el('p', {}, 'Replace your current job?'),
      lbl,
    ], [
      { label: 'Cancel', fn: closeModal },
      {
        label: 'Replace job', class: 'btn-primary', testid: 'import-confirm', fn: () => {
          // If the user asked to keep a backup first and that backup failed,
          // stop here: nothing has been replaced.
          if (checkbox.checked && job && !downloadBackup()) {
            toast('Import stopped — the backup of your current job didn’t download. Nothing has changed.');
            return;
          }
          const imported = r.job;
          beginJob(imported);
          history = []; // import is a fresh start; cannot partially undo into old job
          renderAll();
          closeModal();
          toast('Job imported');
        },
      },
    ]);
  });
});

// ---- Pointer interaction --------------------------------------------------------------
const pointers = new Map(); // pointerId → {x,y,type}
let dragFitting = null, drawingStroke = null, panning = null, pinch = null;
let owner = null;               // pointerId that started the current drag, stroke or pan
// Palm protection: fingers only pan while a pen is touching, hovering (where the
// hardware reports hover) or was lifted less than this long ago.
const PEN_GRACE_MS = 1000;
let lastPenAt = -Infinity;
let fingerDraws = false;        // user's choice, offered once a pen has been seen
let fingerToastAt = -Infinity, wideToastAt = -Infinity;

const penNear = () => performance.now() - lastPenAt < PEN_GRACE_MS
  || [...pointers.values()].some(q => q.type === 'pen');
// Last input outcome, readable by QA on the element; no effect on behaviour.
function noteInput(e, outcome) {
  $('#canvas').dataset.lastInput = `${e.pointerType}:${outcome}`;
  if (e.pointerId === lastDown.id) lastDown.outcome = outcome;
}

// Local-only drawing check shown in the Menu for support calls. Holds pointer
// facts only, never job content, and is never sent anywhere.
const BUILD_LABEL = 'iPad finger update 2';
let downCount = 0;
let lastDown = { id: null };
function startDiag(e) {
  downCount += 1;
  lastDown = { id: e.pointerId, type: e.pointerType, width: e.width, tool: mode, outcome: '', moves: 0, end: '', capture: '' };
}
function endDiag(e, how) {
  if (e.pointerId === lastDown.id && !lastDown.end) lastDown.end = how; // first ending wins
}
const TOOL_LABEL = { select: 'Select', place: 'Place', draw: 'Draw', notes: 'Notes' };
const DEVICE_LABEL = { touch: 'finger', pen: 'pen', mouse: 'mouse' };
function outcomeText(o) {
  if (!o) return 'nothing happened yet';
  if (o.startsWith('ignored-wide-')) return `ignored as a palm (contact ${o.slice(13)} px wide)`;
  return {
    'draw': 'started a sketch line',
    'ignored-pen-down': 'ignored because the pen was touching',
    'pinch': 'two fingers, so it zoomed',
    'no-drawing': 'ignored because the room size isn’t set',
    'sketch-limit': 'ignored because this view has too many sketches',
    'select': 'picked up a fitting',
    'pan': 'moved the drawing',
    'pan-pen-mode': 'moved the drawing (a pen was used, so fingers only move it)',
    'place': 'placed a fitting',
    'note': 'opened a note',
  }[o] || o;
}
const END_TEXT = { up: 'lifted normally', cancel: 'cancelled by the browser', 'capture-lost': 'the page lost track of it before it lifted' };
function drawingCheckLines() {
  const lines = [`Build: ${BUILD_LABEL}`, `Tool now: ${TOOL_LABEL[mode] || mode}`];
  if (typeof window.PointerEvent === 'undefined') {
    lines.push('This browser doesn’t support pointer events, so the drawing can’t respond to touch.');
    return lines;
  }
  if (!downCount) {
    lines.push('No finger, pen or mouse has reached the drawing since this page opened.');
    return lines;
  }
  const d = lastDown;
  lines.push(
    `Last touch: ${DEVICE_LABEL[d.type] || d.type || 'unknown'} in ${TOOL_LABEL[d.tool] || d.tool}, ${outcomeText(d.outcome)}`,
    `Contact width: ${typeof d.width === 'number' && d.width > 0 ? Math.round(d.width) + ' px' : 'not reported'}`,
    `Movement events: ${d.moves}`,
    `Ended: ${END_TEXT[d.end] || 'still down or not reported'}`,
  );
  if (d.capture === 'failed') lines.push('Pointer capture: failed');
  return lines;
}

function renderFingerMode() {
  const b = $('#btn-finger-draw');
  b.hidden = !penSeen;
  b.setAttribute('aria-pressed', String(fingerDraws));
  b.innerHTML = '';
  b.append(el('span', { 'aria-hidden': 'true' }, '✋ '), fingerDraws ? 'Finger drawing: on' : 'Finger drawing: off');
  b.title = fingerDraws
    ? 'Fingers draw and place too. They still only move the drawing while the pen is in use.'
    : 'A pen was used, so fingers only move and zoom the drawing. Tap to let fingers draw too.';
}
function explainFingerPan() {
  if (fingerDraws || performance.now() - fingerToastAt < 8000) return;
  fingerToastAt = performance.now();
  toast('A pen was used here, so fingers only move and zoom the drawing. Tap “Finger drawing: off” to let fingers draw too.', 5000);
}
function explainWideTouch(width) {
  if (performance.now() - wideToastAt < 8000) return;
  wideToastAt = performance.now();
  toast(`Touch ignored: the contact was ${Math.round(width)} px wide, so it was treated as a palm. Try a fingertip.`, 4000);
}

// Drop whatever is in progress without saving any part of it.
function cancelInteraction() {
  const drag = dragFitting;
  pinch = null; drawingStroke = null; panning = null; dragFitting = null; owner = null;
  if (drag) { job = C.normaliseJob(JSON.parse(drag.pre)); renderAll(); }
  else renderCanvas();
}
// Stop tracking every pointer of one type, cancelling what they had started.
function dropPointers(type) {
  let hit = false;
  for (const [id, q] of pointers) {
    if (q.type !== type) continue;
    pointers.delete(id);
    if (id === owner || pinch) hit = true;
  }
  if (hit) cancelInteraction();
}

function svgPoint(e) {
  const svg = $('#canvas');
  const world = svg.querySelector('#world');
  if (!world || !job || !job.room || !job.room.widthM) return null; // no drawing yet
  const ctm = world.getScreenCTM();
  if (!ctm) return null; // not laid out yet (e.g. hidden canvas)
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(ctm.inverse());
}
function startPinch() {
  cancelInteraction(); // a half-finished drag is reverted, not left moved without an undo step
  const [a, b] = [...pointers.values()];
  pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: zoom.s };
}
function doPinch() {
  const [a, b] = [...pointers.values()];
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (pinch && pinch.d > 0) {
    zoom.s = Math.min(4, Math.max(0.5, pinch.s * (d / pinch.d)));
    renderCanvas();
  }
}

$('#canvas').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const canvas = $('#canvas');
  startDiag(e);
  // A primary pointer means the browser has no other contact of this kind down,
  // so any we still track of that kind lost its pointerup. Forget it, or every
  // later single touch would start a pinch.
  if (e.isPrimary) dropPointers(e.pointerType);
  if (e.pointerType === 'pen') {
    penSeen = true;
    lastPenAt = performance.now();
    // The pen wins over fingers already down (usually a resting palm): drop them
    // and anything they started, so the pen is neither ignored nor made a pinch.
    dropPointers('touch');
    renderFingerMode();
  } else if (e.pointerType === 'touch') {
    // stray-tap / palm guard: very wide touches, or touch while pen is down
    const penDown = [...pointers.values()].some(q => q.type === 'pen');
    // A fingertip can be reported wider than 40 px. A finger that is
    // about to draw (Draw tool, no pen in use, fingers allowed to draw) skips the
    // width check; every other tool, and any touch near pen use, keeps it.
    const fingerWillDraw = mode === 'draw' && !penNear() && (!penSeen || fingerDraws);
    if (penDown || (e.width > 40 && !fingerWillDraw)) {
      noteInput(e, penDown ? 'ignored-pen-down' : `ignored-wide-${Math.round(e.width)}`);
      if (!penDown && !penNear()) explainWideTouch(e.width);
      return;
    }
  }
  try { canvas.setPointerCapture(e.pointerId); lastDown.capture = 'ok'; }
  catch { lastDown.capture = 'failed'; /* synthetic/untracked pointer: events still arrive */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  if (pointers.size === 2) { startPinch(); noteInput(e, 'pinch'); return; }
  if (pinch) return;

  // Once a pen has been seen, fingers only pan and zoom unless the user turns
  // finger drawing on; even then, not while the pen is in use.
  const fingerOnly = e.pointerType === 'touch' && penSeen && (!fingerDraws || penNear());
  const p = svgPoint(e);
  if (!p) { noteInput(e, 'no-drawing'); return; } // room not set yet (e.g. blank job, room form dismissed)
  const hitFitting = e.target.closest ? e.target.closest('.fitting') : null;
  if (fingerOnly && (mode !== 'select' || hitFitting)) explainFingerPan();

  if (mode === 'select' && !fingerOnly) {
    if (hitFitting) {
      selectedId = hitFitting.getAttribute('data-id');
      dragFitting = { id: selectedId, moved: false, pre: snapshot() };
    } else {
      selectedId = null;
      panning = { sx: e.clientX, sy: e.clientY, tx: zoom.tx, ty: zoom.ty };
    }
    owner = e.pointerId;
    noteInput(e, hitFitting ? 'select' : 'pan');
    renderAll();
    return;
  }
  if (mode === 'place' && !fingerOnly) { noteInput(e, 'place'); placeAt(p); return; }
  if (mode === 'draw' && !fingerOnly) {
    if ((job.annotations[view] || []).length >= C.LIMITS.maxStrokesPerView) {
      noteInput(e, 'sketch-limit');
      toast(`Sketch limit reached on this view (${C.LIMITS.maxStrokesPerView}) — clear sketches to add more.`);
      return;
    }
    drawingStroke = { points: [[Math.round(p.x), Math.round(p.y)]] };
    owner = e.pointerId;
    noteInput(e, 'draw');
    return;
  }
  if (mode === 'notes' && !fingerOnly) {
    // The prompt below can swallow this pointer's pointerup; stop tracking it now.
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    noteInput(e, 'note');
    if ((job.notePins || []).length >= 100) {
      toast('Note limit reached (100) — delete a note before adding another.');
      return;
    }
    const text = window.prompt('Note text (plain text, notes are never priced):', '');
    if (text && text.trim()) {
      commit(() => {
        job.notePins.push({ id: 'N' + (job.notePins.length + 1) + '-' + Date.now().toString(36), view, x: Math.round(p.x), y: Math.round(p.y), text: text.slice(0, 200) });
      });
    }
    return;
  }
  // finger (or empty-area touch) pans
  panning = { sx: e.clientX, sy: e.clientY, tx: zoom.tx, ty: zoom.ty };
  owner = e.pointerId;
  noteInput(e, fingerOnly ? 'pan-pen-mode' : 'pan');
});

function placeAt(p) {
  if (!p || !job.room || !job.room.widthM) { toast('Set the room size first.'); return; }
  const dims = roomMm();
  let wall, fromLeft, height;
  if (placeType === 'downlight') {
    if (view !== 'PLAN') { toast('Downlights go on the ceiling — switch to the plan view.'); return; }
    wall = C.CEILING;
    fromLeft = Math.max(0, Math.min(dims.W, Math.round(p.x)));
    height = Math.max(0, Math.min(dims.D, Math.round(p.y)));
  } else if (view !== 'PLAN') {
    wall = view;
    fromLeft = Math.max(0, Math.min(Math.round(p.x), C.wallLengthMm(job.room, view)));
    height = Math.max(0, Math.min(dims.H - Math.round(p.y), dims.H));
  } else {
    wall = nearestWallFromPlan(p.x, p.y);
    const wp = wallParamsFromPlan(p.x, p.y, wall);
    if (!wp) {
      toast('That’s in the open floor. Tap close to a wall, or open that wall’s view and tap there.');
      return;
    }
    const maxL = C.wallLengthMm(job.room, wall);
    fromLeft = Math.max(0, Math.min(wp.fromLeft, maxL)); // clamp taps beyond the wall ends
    height = C.TYPES[placeType].defaultHeightMm ?? 450;
  }
  fromLeft = Math.max(0, fromLeft);
  let id;
  commit(() => { id = C.placeItem(job, placeType, wall, fromLeft, height); });
  if (!id) return; // commit failed (e.g. item cap); job untouched
  selectedId = id;
  toast(`${id} placed on ${wall === C.CEILING ? 'ceiling' : 'Wall ' + wall}`);
  renderAll();
}

$('#canvas').addEventListener('pointermove', (e) => {
  if (e.pointerType === 'pen') lastPenAt = performance.now(); // includes hover
  if (e.pointerId === lastDown.id && !lastDown.end) lastDown.moves += 1;
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, down: true });
  if (pinch && pointers.size === 2) { doPinch(); return; }
  if (e.pointerId !== owner) return; // only the pointer that started a drag, stroke or pan moves it
  const p = svgPoint(e);
  if (!p) return; // nothing drawable yet
  if (dragFitting) {
    const item = job.items.find(i => i.id === dragFitting.id);
    if (!item) { dragFitting = null; return; }
    const p2 = svgPoint(e);
    if (!p2) return;
    let changedToClamp = false;
    let newL = item.fromLeftMm, newH = item.heightMm;
    if (view === 'PLAN') {
      if (item.wall === C.CEILING) {
        const dims = roomMm();
        newL = Math.max(0, Math.min(dims.W, Math.round(p2.x)));
        newH = Math.max(0, Math.min(dims.D, Math.round(p2.y)));
      } else {
        // slide along the item's own wall only
        const wp = wallParamsFromPlan(p2.x, p2.y, item.wall);
        if (wp) {
          const maxL = C.maxFromLeft(job, item);
          if (wp.fromLeft > maxL) { wp.fromLeft = maxL; changedToClamp = true; }
          newL = Math.max(0, wp.fromLeft);
        }
      }
    } else {
      const maxL = C.maxFromLeft(job, item);
      const maxH = C.maxHeight(job, item);
      newL = Math.max(0, Math.min(maxL, Math.round(p2.x)));
      if (item.wall !== C.CEILING) newH = Math.max(0, Math.min(maxH, roomMm().H - Math.round(p2.y)));
      if (Math.round(p2.x) > maxL || (roomMm().H - Math.round(p2.y)) > maxH) changedToClamp = true;
    }
    if (newL !== item.fromLeftMm || newH !== item.heightMm) dragFitting.moved = true; // no empty undo steps
    item.fromLeftMm = newL;
    item.heightMm = newH;
    if (changedToClamp && !dragFitting.warned) { toast(`Kept inside ${item.wall === C.CEILING ? 'the ceiling' : 'Wall ' + item.wall}`); dragFitting.warned = true; }
    renderCanvas(); renderInspector(); renderTabs();
    return;
  }
  if (drawingStroke) {
    const last = drawingStroke.points[drawingStroke.points.length - 1];
    const q = [Math.round(p.x), Math.round(p.y)];
    if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 15 && drawingStroke.points.length < C.LIMITS.maxPointsPerStroke) {
      drawingStroke.points.push(q);
      // live preview
      renderCanvas();
      const world = $('#canvas').querySelector('#world');
      svgEl('polyline', { points: drawingStroke.points.map(pt => pt.join(',')).join(' '), fill: 'none', stroke: '#2266cc', 'stroke-width': 25 }, world);
    }
    return;
  }
  if (panning) {
    zoom.tx = panning.tx + (e.clientX - panning.sx);
    zoom.ty = panning.ty + (e.clientY - panning.sy);
    renderCanvas();
  }
});

function endPointer(e) {
  // Ignored contacts (a palm, or a finger dropped for the pen) must not end the
  // pen's stroke or drag.
  endDiag(e, 'up');
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (e.pointerType === 'pen') lastPenAt = performance.now();
  if (pointers.size < 2) pinch = null;
  if (e.pointerId !== owner) return;
  owner = null;
  if (dragFitting) {
    if (dragFitting.moved) {
      // one history entry for the whole drag (snapshot taken before it started)
      history.push(dragFitting.pre);
      if (history.length > C.LIMITS.historyLimit) history.shift();
      redoStack = [];
      job.revision += 1;
      scheduleSave();
    }
    dragFitting = null;
    renderAll();
  }
  if (drawingStroke) {
    const stroke = drawingStroke; drawingStroke = null;
    if (stroke.points.length > 1) {
      const target = job.annotations[view] = job.annotations[view] || [];
      commit(() => { target.push(stroke); });
    } else renderCanvas();
  }
  panning = null;
}
function cancelPointer(e) {
  // A cancelled palm is ignored; a cancelled owner drops the interaction
  // entirely (drag reverted to its pre-drag snapshot, no partial stroke saved).
  endDiag(e, 'cancel');
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (e.pointerType === 'pen') lastPenAt = performance.now();
  if (e.pointerId === owner || pinch) cancelInteraction();
}
// Window listeners catch a pointerup or cancel that lands off the canvas when
// capture failed. Each handler is a no-op for a pointer already handled.
for (const target of [$('#canvas'), window]) {
  target.addEventListener('pointerup', endPointer);
  target.addEventListener('pointercancel', cancelPointer);
}
// Recorded for the Menu check only. A normal pointerup or the Notes tool's own
// release has already stopped tracking the pointer, so neither counts as lost.
$('#canvas').addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) endDiag(e, 'capture-lost'); });
$('#btn-finger-draw').addEventListener('click', () => {
  fingerDraws = !fingerDraws;
  renderFingerMode();
  toast(fingerDraws
    ? 'Fingers can draw and place now. While the pen is in use they still only move the drawing.'
    : 'Fingers only move and zoom the drawing. The pen draws.');
});

// Wheel zoom (desktop convenience)
$('#canvas').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoom.s = Math.min(4, Math.max(0.5, zoom.s * (e.deltaY < 0 ? 1.1 : 0.9)));
  renderCanvas();
}, { passive: false });

// ---- Modes / palette ------------------------------------------------------------
const MODES = ['select', 'place', 'draw', 'notes'];
function setMode(m) {
  if (!MODES.includes(m)) return;
  mode = m;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  $('#place-palette').hidden = m !== 'place';
  renderCanvas();
}
document.querySelectorAll('.mode-btn[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

function buildPalette() {
  const pal = $('#place-palette');
  pal.innerHTML = '';
  pal.appendChild(el('p', { class: 'palette-title' }, 'Pick a fitting'));
  for (const [k, t] of Object.entries(C.TYPES)) {
    const b = el('button', { class: 'pal-btn' + (k === placeType ? ' active' : ''), 'data-type': k, 'data-testid': `pal-${k}` });
    b.append(el('span', { class: 'sym' }, t.symbol), el('span', {}, t.label));
    b.addEventListener('click', () => {
      placeType = k;
      pal.querySelectorAll('.pal-btn').forEach(x => x.classList.toggle('active', x.dataset.type === k));
      setMode('place');
      renderCanvas();
    });
    pal.appendChild(b);
  }
}

$('#btn-clear-ink').addEventListener('click', () => {
  const strokes = job.annotations[view] || [];
  if (!strokes.length) { toast('No sketches on this view'); return; }
  modal('Clear sketches', [el('p', {}, `Remove ${strokes.length} sketch(es) from this view? This can be undone.`)], [
    { label: 'Cancel', fn: closeModal },
    { label: 'Clear sketches', class: 'btn-danger', fn: () => { commit(() => { job.annotations[view] = []; }); closeModal(); } },
  ]);
});

// ---- Top bar wiring --------------------------------------------------------------
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);
$('#btn-menu').addEventListener('click', openMenu);
$('#btn-breakdown').addEventListener('click', openBreakdown);
$('#btn-job-name').addEventListener('click', () => {
  const box = el('div');
  const nameI = el('input', { 'data-testid': 'job-name-input' }); nameI.value = job.name;
  box.append(el('label', {}, 'Job name'), nameI);
  const save = () => commit(() => { job.name = nameI.value.trim().slice(0, C.LIMITS.maxTextLen) || 'Untitled room'; });
  modal('Job details', [box], [
    { label: 'Cancel', fn: closeModal },
    { label: 'Save', class: 'btn-primary', fn: () => { save(); closeModal(); } },
  ]);
});
$('#btn-zoom-in').addEventListener('click', () => { zoom.s = Math.min(4, zoom.s * 1.25); renderCanvas(); });
$('#btn-zoom-out').addEventListener('click', () => { zoom.s = Math.max(0.5, zoom.s / 1.25); renderCanvas(); });
$('#btn-zoom-fit').addEventListener('click', () => { zoom = { s: 1, tx: 0, ty: 0 }; renderCanvas(); });

document.addEventListener('keydown', (e) => {
  const inField = e.target.matches('input, textarea, select');
  if (e.key === 'Escape' && inField) {
    // In a dialog: close it (nothing typed there is kept without Save).
    // In the details panel: blur, which commits the field through its change handler.
    if (e.target.closest('#modal-root')) closeModal(); else e.target.blur();
    return;
  }
  if (inField) return;
  if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); redo(); }
  else if (e.key === 'Delete' && selectedId) { commit(() => { job.items = job.items.filter(i => i.id !== selectedId); }); toast(`${selectedId} deleted · Undo`); selectedId = null; renderAll(); }
  else if (e.key === 'Escape') {
    if (PHONE.matches && !$('#modal-root').firstChild) inspectorCollapsed = true;
    selectedId = null; closeModal(); renderAll();
  }
  else if (e.key.toLowerCase() === 'v') setMode('select');
  else if (e.key.toLowerCase() === 'p') setMode('place');
  else if (e.key.toLowerCase() === 'd') setMode('draw');
  else if (e.key.toLowerCase() === 'n') setMode('notes');
});

// ---- Start buttons -----------------------------------------------------------------
$('#start-blank').addEventListener('click', () => beginJob(C.blankJob('Untitled room')));
$('#start-sample').addEventListener('click', () => beginJob(C.sampleJob()));
$('#start-continue').addEventListener('click', () => {
  const saved = loadSaved();
  if (saved) { beginJob(saved); history = []; renderAll(); }
  else showStart();
});
$('#start-import').addEventListener('click', () => $('#file-input').click());

// ---- Offline / online chips ----------------------------------------------------------
let offlineTimers = [];
function updateOfflineChip() {
  const chip = $('#offline-chip');
  if (!('serviceWorker' in navigator)) { chip.className = 'chip warn'; chip.textContent = 'Not yet available offline — this browser doesn’t support it'; return; }
  chip.className = 'chip warn';
  chip.textContent = navigator.onLine ? 'Getting ready for offline…' : 'Offline — working from this device';
  offlineTimers.forEach(clearTimeout); offlineTimers = [];
  // Bounded readiness: if the worker never settles, say so instead of hanging on "getting ready".
  offlineTimers.push(setTimeout(() => {
    if (!navigator.serviceWorker.controller && chip.textContent.includes('Getting ready')) {
      chip.className = 'chip warn';
      chip.textContent = 'Not yet available offline — open once while online';
    }
  }, 8000));
  navigator.serviceWorker.ready.then(() => {
    offlineTimers.forEach(clearTimeout); offlineTimers = [];
    if (navigator.onLine) { chip.className = 'chip ok'; chip.textContent = 'Ready to use offline'; }
    else { chip.className = 'chip'; chip.textContent = 'Offline — working from this device'; }
  }).catch(() => {
    chip.className = 'chip warn';
    chip.textContent = 'Not yet available offline — open once while online';
  });
}
window.addEventListener('online', updateOfflineChip);
window.addEventListener('offline', updateOfflineChip);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(updateOfflineChip).catch(() => updateOfflineChip());
} else updateOfflineChip();

// ---- Boot ------------------------------------------------------------------------------
buildPalette();
setMode('select');
renderFingerMode();
const savedJob = loadSaved();
if (savedJob) beginJob(savedJob); else showStart();
