'use strict';
// Design preview: floor, zones, wall views and containment for an invented barber shop.
// All data lives in this file and in memory. Nothing is stored, sent or loaded.
(function () {
  const FLOOR = { w: 9000, h: 6000, ceiling: 2700 };
  const GRID = 250;
  const MAX_ADDED = 3;
  const FIRST_ADDED_NO = 7;
  const THICK = { exterior: 300, interior: 100 };
  const SIDE_VEC = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  // Standing on side X of a wall, you look the opposite way.
  const LOOK = { S: 'north', N: 'south', E: 'west', W: 'east' };
  const SIDE_NAME = { N: 'north', S: 'south', E: 'east', W: 'west' };
  const LOOK_ORDER = { north: 0, east: 1, south: 2, west: 3 };
  const ROUTE_TYPES = {
    trunking: { name: 'Trunking', prefix: 'T' },
    conduit: { name: 'Conduit', prefix: 'C' },
  };
  const FITTING_TYPES = {
    socket: 'Double socket',
    switch: 'Light switch',
    light: 'Ceiling light (plan only)',
    spur: 'Fused spur',
    data: 'Data outlet',
    db: 'Distribution board',
  };
  const PLAN_VB = '-700 -950 10400 7850';

  // Sample job. Plan coordinates in mm, north is up, y grows southwards.
  const BASE_WALLS = [
    { id: 'W1', x1: 0, y1: 0, x2: 9000, y2: 0, kind: 'exterior' },
    { id: 'W2', x1: 9000, y1: 0, x2: 9000, y2: 6000, kind: 'exterior' },
    { id: 'W3', x1: 0, y1: 6000, x2: 9000, y2: 6000, kind: 'exterior' },
    { id: 'W4', x1: 0, y1: 0, x2: 0, y2: 6000, kind: 'exterior' },
    { id: 'W5', x1: 6000, y1: 0, x2: 6000, y2: 6000, kind: 'interior' },
    { id: 'W6', x1: 6000, y1: 3000, x2: 9000, y2: 3000, kind: 'interior' },
  ];
  const ZONES = [
    { id: 'Z1', name: 'Waiting and till', x0: 0, y0: 0, x1: 2500, y1: 6000, colour: '#3b7dd8', purpose: 'Front of the shop by the entrance: waiting bench and till counter.' },
    { id: 'Z2', name: 'Cutting floor', x0: 2500, y0: 0, x1: 6000, y1: 6000, colour: '#d9822b', purpose: 'Three cutting chairs facing mirrors on the north wall.' },
    { id: 'Z3', name: 'Staff and kit room', x0: 6000, y0: 0, x1: 9000, y1: 3000, colour: '#2f9455', purpose: 'Kettle, towel washer and staff lockers.' },
    { id: 'Z4', name: 'Store and wash-up', x0: 6000, y0: 3000, x1: 9000, y1: 6000, colour: '#8e44ad', purpose: 'Stock shelving, sink with water heater, and the distribution board.' },
  ];
  // from/to/at are mm along the wall from its first point. side is where the item sits.
  const OPENINGS = [
    { wall: 'W3', from: 1200, to: 2200, kind: 'door', label: 'Entrance', swing: 'N', sill: 0, head: 2100 },
    { wall: 'W3', from: 2700, to: 5700, kind: 'window', label: 'Shop window', sill: 600, head: 2400 },
    { wall: 'W3', from: 7000, to: 8000, kind: 'window', label: 'Window', sill: 1200, head: 2000 },
    { wall: 'W2', from: 800, to: 2200, kind: 'window', label: 'Window', sill: 1000, head: 2100 },
    { wall: 'W5', from: 1800, to: 2600, kind: 'door', label: 'Door', swing: 'E', sill: 0, head: 2100 },
    { wall: 'W5', from: 3600, to: 4400, kind: 'door', label: 'Door', swing: 'E', sill: 0, head: 2100 },
  ];
  const FITTINGS = [
    { id: 'F1', type: 'socket', wall: 'W4', side: 'E', at: 1000, h: 450 },
    { id: 'F2', type: 'socket', wall: 'W4', side: 'E', at: 4100, h: 1100 },
    { id: 'F3', type: 'data', wall: 'W4', side: 'E', at: 4500, h: 1100 },
    { id: 'F4', type: 'switch', wall: 'W3', side: 'N', at: 2400, h: 1200 },
    { id: 'F5', type: 'light', x: 1250, y: 1800 },
    { id: 'F6', type: 'light', x: 1250, y: 4600 },
    { id: 'F7', type: 'socket', wall: 'W1', side: 'S', at: 3000, h: 1100 },
    { id: 'F8', type: 'socket', wall: 'W1', side: 'S', at: 4200, h: 1100 },
    { id: 'F9', type: 'socket', wall: 'W1', side: 'S', at: 5400, h: 1100 },
    { id: 'F10', type: 'socket', wall: 'W5', side: 'W', at: 5200, h: 450 },
    { id: 'F11', type: 'switch', wall: 'W5', side: 'W', at: 1500, h: 1200 },
    { id: 'F12', type: 'light', x: 3500, y: 1600 },
    { id: 'F13', type: 'light', x: 5000, y: 1600 },
    { id: 'F14', type: 'light', x: 3500, y: 4300 },
    { id: 'F15', type: 'light', x: 5000, y: 4300 },
    { id: 'F16', type: 'socket', wall: 'W1', side: 'S', at: 7000, h: 1100 },
    { id: 'F17', type: 'socket', wall: 'W1', side: 'S', at: 8200, h: 1100 },
    { id: 'F18', type: 'spur', wall: 'W2', side: 'W', at: 2600, h: 1100 },
    { id: 'F19', type: 'switch', wall: 'W5', side: 'E', at: 2750, h: 1200 },
    { id: 'F20', type: 'light', x: 7500, y: 2250 },
    { id: 'F21', type: 'spur', wall: 'W2', side: 'W', at: 4300, h: 1800 },
    { id: 'F22', type: 'socket', wall: 'W6', side: 'S', at: 1500, h: 1100 },
    { id: 'F23', type: 'switch', wall: 'W5', side: 'E', at: 4600, h: 1200 },
    { id: 'F24', type: 'light', x: 7500, y: 5250 },
    { id: 'F25', type: 'db', wall: 'W2', side: 'W', at: 5400, h: 1500 },
  ];
  // Runs follow one face of one wall at a height. Drops are vertical between two heights.
  const ROUTES = [
    { id: 'R1', name: 'Mirror wall run', type: 'trunking',
      runs: [{ wall: 'W1', side: 'S', from: 2700, to: 5850, h: 1100 }], drops: [] },
    { id: 'R2', name: 'Staff worktop run', type: 'trunking',
      runs: [{ wall: 'W1', side: 'S', from: 6150, to: 8850, h: 1100 }], drops: [] },
    { id: 'R3', name: 'Till counter run', type: 'trunking',
      runs: [{ wall: 'W4', side: 'E', from: 3800, to: 4800, h: 1100 }], drops: [] },
    { id: 'R4', name: 'Board to mirror wall and worktop', type: 'conduit',
      runs: [{ wall: 'W2', side: 'W', from: 150, to: 5200, h: 2500 }, { wall: 'W1', side: 'S', from: 5800, to: 8850, h: 2500 }],
      drops: [{ wall: 'W2', side: 'W', at: 5200, h1: 1800, h2: 2500 }, { wall: 'W1', side: 'S', at: 5800, h1: 1100, h2: 2500 }, { wall: 'W1', side: 'S', at: 8600, h1: 1100, h2: 2500 }] },
    { id: 'R5', name: 'Board to till', type: 'conduit',
      runs: [{ wall: 'W2', side: 'W', from: 5600, to: 5850, h: 2600 }, { wall: 'W3', side: 'N', from: 150, to: 8850, h: 2600 }, { wall: 'W4', side: 'E', from: 4300, to: 5850, h: 2600 }],
      drops: [{ wall: 'W2', side: 'W', at: 5600, h1: 1800, h2: 2600 }, { wall: 'W4', side: 'E', at: 4300, h1: 1100, h2: 2600 }] },
  ];

  const state = {
    view: 'floor',
    zoneId: 'Z2',
    faceId: null,
    added: [],
    nextWallNo: FIRST_ADDED_NO,
    routeTypes: Object.fromEntries(ROUTES.map((r) => [r.id, r.type])),
    show: { trunking: true, conduit: true },
    routeId: null,
    drawing: null, // { start, hover } while drawing a wall
    printZones: new Set(),
    lastFocus: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const narrow = () => window.matchMedia('(max-width: 600px)').matches;

  const walls = () => BASE_WALLS.concat(state.added);
  const wallById = (id) => walls().find((w) => w.id === id);
  const zoneById = (id) => ZONES.find((z) => z.id === id);
  const isH = (w) => w.y1 === w.y2;
  const wallLen = (w) => (isH(w) ? w.x2 - w.x1 : w.y2 - w.y1);
  const half = (w) => THICK[w.kind] / 2;
  const centre = (w, at) => (isH(w) ? [w.x1 + at, w.y1] : [w.x1, w.y1 + at]);
  function wallPoint(w, at, side, extra) {
    const [nx, ny] = SIDE_VEC[side];
    const [cx, cy] = centre(w, at);
    const off = half(w) + extra;
    return [cx + nx * off, cy + ny * off];
  }
  const fittingPos = (f) => (f.wall ? wallPoint(wallById(f.wall), f.at, f.side, 170) : [f.x, f.y]);
  const inZone = (z, [x, y]) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;

  function routeLabels() {
    const n = { trunking: 0, conduit: 0 };
    const out = {};
    for (const r of ROUTES) {
      const t = state.routeTypes[r.id];
      n[t] += 1;
      out[r.id] = ROUTE_TYPES[t].prefix + n[t];
    }
    return out;
  }
  const countType = (t) => ROUTES.filter((r) => state.routeTypes[r.id] === t).length;

  function routeTouchesZone(r, z) {
    return r.runs.some((run) => {
      const w = wallById(run.wall);
      const a = wallPoint(w, run.from, run.side, 70);
      const b = wallPoint(w, run.to, run.side, 70);
      const xlo = Math.min(a[0], b[0]), xhi = Math.max(a[0], b[0]);
      const ylo = Math.min(a[1], b[1]), yhi = Math.max(a[1], b[1]);
      if (isH(w)) return a[1] >= z.y0 && a[1] <= z.y1 && Math.min(xhi, z.x1) - Math.max(xlo, z.x0) > 50;
      return a[0] >= z.x0 && a[0] <= z.x1 && Math.min(yhi, z.y1) - Math.max(ylo, z.y0) > 50;
    });
  }

  // A face is one side of one wall, cut to the part that lies in a zone.
  function facesForZone(z) {
    const faces = [];
    for (const w of walls()) {
      const h = isH(w);
      const line = h ? w.y1 : w.x1;
      const lo = h ? z.y0 : z.x0;
      const hi = h ? z.y1 : z.x1;
      const base = h ? w.x1 : w.y1;
      const a = Math.max(base, h ? z.x0 : z.y0);
      const b = Math.min(h ? w.x2 : w.y2, h ? z.x1 : z.y1);
      if (b - a < 300) continue;
      let sides = [];
      if (line === lo) sides = [h ? 'S' : 'E'];
      else if (line === hi) sides = [h ? 'N' : 'W'];
      else if (line > lo && line < hi) sides = h ? ['S', 'N'] : ['E', 'W'];
      const edge = line === lo || line === hi;
      for (const side of sides) {
        faces.push({ id: `${z.id}:${w.id}:${side}`, zone: z, wall: w, side, from: a - base, to: b - base, edge, look: LOOK[side] });
      }
    }
    faces.sort((p, q) => (p.edge === q.edge ? 0 : (p.edge ? -1 : 1)) || LOOK_ORDER[p.look] - LOOK_ORDER[q.look] || p.from - q.from);
    return faces;
  }
  function faceName(f) {
    const tag = f.wall.added ? 'new' : f.wall.kind;
    return f.edge ? `${cap(f.look)} wall (${f.wall.id}, ${tag})` : `${f.wall.id} partition, ${SIDE_NAME[f.side]} side (${tag})`;
  }
  const faceShort = (f) => (f.edge ? `${cap(f.look)} wall · ${f.wall.id}` : `${f.wall.id} ${SIDE_NAME[f.side]} side`);
  const missingEdges = (faces) => ['north', 'east', 'south', 'west'].filter((l) => !faces.some((f) => f.edge && f.look === l));

  const zone = () => zoneById(state.zoneId);
  const faces = () => facesForZone(zone());
  const currentFace = () => faces().find((f) => f.id === state.faceId) || null;
  function ensureFace() {
    const list = faces();
    if (!list.some((f) => f.id === state.faceId)) state.faceId = list.length ? list[0].id : null;
  }

  // ---------- SVG pieces ----------
  function symbol(type, x, y, s) {
    const h = s / 2;
    const sw = s * 0.09;
    const text = (t, fill, k = 0.44) => `<text x="${x}" y="${y}" font-size="${s * k}" text-anchor="middle" dominant-baseline="central" font-weight="700" fill="${fill}">${t}</text>`;
    let body;
    switch (type) {
      case 'light':
        body = `<circle cx="${x}" cy="${y}" r="${h}" fill="#fff" stroke="#111" stroke-width="${sw}"/><path d="M${x - h * 0.7} ${y - h * 0.7}L${x + h * 0.7} ${y + h * 0.7}M${x + h * 0.7} ${y - h * 0.7}L${x - h * 0.7} ${y + h * 0.7}" stroke="#111" stroke-width="${sw}"/>`;
        break;
      case 'switch':
        body = `<circle cx="${x}" cy="${y}" r="${h * 0.9}" fill="#fff" stroke="#111" stroke-width="${sw}"/>${text('SW', '#111', 0.4)}`;
        break;
      case 'data':
        body = `<path d="M${x} ${y - h}L${x + h} ${y}L${x} ${y + h}L${x - h} ${y}Z" fill="#e8f1ff" stroke="#111" stroke-width="${sw}"/>${text('D', '#111')}`;
        break;
      case 'db':
        body = `<rect x="${x - s * 0.8}" y="${y - h}" width="${s * 1.6}" height="${s}" fill="#222" stroke="#111" stroke-width="${sw}"/>${text('DB', '#fff')}`;
        break;
      case 'spur':
        body = `<rect x="${x - h}" y="${y - h}" width="${s}" height="${s}" fill="#fff" stroke="#111" stroke-width="${sw}"/><line x1="${x - h}" y1="${y + h}" x2="${x + h}" y2="${y - h}" stroke="#111" stroke-width="${sw * 0.6}"/>${text('FS', '#111', 0.38)}`;
        break;
      default:
        body = `<rect x="${x - h}" y="${y - h}" width="${s}" height="${s}" rx="${s * 0.12}" fill="#fff" stroke="#111" stroke-width="${sw}"/>${text('SO', '#111', 0.4)}`;
    }
    return `<g class="fit" data-fit-type="${type}">${body}</g>`;
  }

  function routeLine(type, a, b, k) {
    const xy = `x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"`;
    if (type === 'trunking') return `<line ${xy} stroke="#7a5200" stroke-width="${k * 1.6}"/><line ${xy} stroke="#f2b84b" stroke-width="${k}"/>`;
    return `<line ${xy} stroke="#1d5fa8" stroke-width="${k * 0.45}" stroke-dasharray="${k * 2.4} ${k * 1.2}"/>`;
  }

  function routeTag(x, y, text, type, fs) {
    const w = fs * (text.length * 0.65 + 0.9);
    const h = fs * 1.4;
    const trunk = type === 'trunking';
    return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${h * 0.3}" fill="${trunk ? '#f2b84b' : '#fff'}" stroke="${trunk ? '#7a5200' : '#1d5fa8'}" stroke-width="${fs * 0.12}"${trunk ? '' : ` stroke-dasharray="${fs * 0.4} ${fs * 0.2}"`}/>` +
      `<text x="${x}" y="${y}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" font-weight="700" fill="#111">${esc(text)}</text>`;
  }

  function haloText(x, y, text, fs, extra = '', fill = '#111') {
    return `<text x="${x}" y="${y}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" fill="${fill}" stroke="#fff" stroke-width="${fs * 0.25}" paint-order="stroke" ${extra}>${esc(text)}</text>`;
  }

  function planMarkup({ print = false } = {}) {
    const out = [];
    const labels = routeLabels();
    const sel = print ? null : state.zoneId;
    out.push(`<rect x="0" y="0" width="${FLOOR.w}" height="${FLOOR.h}" fill="#fff"/>`);
    const ordered = ZONES.filter((z) => z.id !== sel).concat(ZONES.filter((z) => z.id === sel));
    for (const z of ordered) {
      const on = z.id === sel;
      out.push(`<rect class="zone${on ? ' sel' : ''}" data-zone="${z.id}" x="${z.x0}" y="${z.y0}" width="${z.x1 - z.x0}" height="${z.y1 - z.y0}" fill="${z.colour}" fill-opacity="${on ? 0.2 : 0.07}" stroke="${z.colour}" stroke-width="${on ? 80 : 40}" stroke-dasharray="240 140"/>`);
    }
    for (const w of walls()) {
      out.push(`<line data-wall="${w.id}" x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${w.added ? '#b45309' : '#262626'}" stroke-width="${THICK[w.kind]}" stroke-linecap="square"/>`);
    }
    for (const o of OPENINGS) {
      const w = wallById(o.wall);
      const t = THICK[w.kind];
      const [ax, ay] = centre(w, o.from);
      const [bx, by] = centre(w, o.to);
      out.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#fff" stroke-width="${t + 8}"/>`);
      if (o.kind === 'window') {
        const [nx, ny] = isH(w) ? [0, 1] : [1, 0];
        for (const s of [-1, 0, 1]) {
          const d = s * t * 0.33;
          out.push(`<line x1="${ax + nx * d}" y1="${ay + ny * d}" x2="${bx + nx * d}" y2="${by + ny * d}" stroke="#333" stroke-width="${s ? 22 : 12}"/>`);
        }
      } else {
        const [nx, ny] = SIDE_VEC[o.swing];
        const r = o.to - o.from;
        const tx = ax + nx * r, ty = ay + ny * r;
        const cross = (tx - ax) * (by - ay) - (ty - ay) * (bx - ax);
        out.push(`<line x1="${ax}" y1="${ay}" x2="${tx}" y2="${ty}" stroke="#333" stroke-width="28"/>`);
        out.push(`<path d="M${tx} ${ty}A${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${bx} ${by}" fill="none" stroke="#777" stroke-width="16" stroke-dasharray="60 40"/>`);
      }
    }
    if (!print) {
      const f = currentFace();
      if (f) {
        const a = wallPoint(f.wall, f.from, f.side, 30);
        const b = wallPoint(f.wall, f.to, f.side, 30);
        out.push(`<line class="face-mark" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${f.zone.colour}" stroke-width="100" stroke-opacity="0.8" pointer-events="none"/>`);
      }
    }
    for (const r of ROUTES) {
      const type = state.routeTypes[r.id];
      if (!state.show[type]) continue;
      const on = !print && r.id === state.routeId;
      const g = [];
      for (const run of r.runs) {
        const w = wallById(run.wall);
        const a = wallPoint(w, run.from, run.side, 70);
        const b = wallPoint(w, run.to, run.side, 70);
        if (on) g.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#ffd400" stroke-width="320" stroke-opacity="0.6"/>`);
        g.push(routeLine(type, a, b, 70));
        g.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="transparent" stroke-width="320"/>`);
      }
      const colour = type === 'trunking' ? '#7a5200' : '#1d5fa8';
      for (const d of r.drops) {
        const [x, y] = wallPoint(wallById(d.wall), d.at, d.side, 70);
        g.push(`<circle cx="${x}" cy="${y}" r="90" fill="#fff" stroke="${colour}" stroke-width="30"/><circle cx="${x}" cy="${y}" r="32" fill="${colour}"/>`);
      }
      const run0 = r.runs.reduce((p, q) => (q.to - q.from > p.to - p.from ? q : p));
      const [lx, ly] = wallPoint(wallById(run0.wall), (run0.from + run0.to) / 2, run0.side, 480);
      g.push(routeTag(lx, ly, labels[r.id], type, 170));
      out.push(`<g class="route" data-route="${r.id}" data-route-type="${type}">${g.join('')}</g>`);
    }
    for (const f of FITTINGS) {
      const [x, y] = fittingPos(f);
      out.push(symbol(f.type, x, y, 240));
    }
    for (const w of state.added) {
      const [mx, my] = [(w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2];
      const [ox, oy] = isH(w) ? [0, -260] : [300, 0];
      out.push(haloText(mx + ox, my + oy, `${w.id} new`, 170, 'font-weight="700" class="zone-label"', '#b45309'));
    }
    for (const z of ZONES) {
      const cx = (z.x0 + z.x1) / 2, cy = (z.y0 + z.y1) / 2;
      out.push(`<g class="zone-label">${haloText(cx, cy - 190, z.id, 170, 'font-weight="700"', z.colour)}${haloText(cx, cy + 90, z.name, 230, 'font-weight="700"')}</g>`);
    }
    if (!print && state.drawing && state.drawing.start) {
      const s = state.drawing.start;
      out.push(`<circle cx="${s.x}" cy="${s.y}" r="110" fill="#b45309"/>`);
      if (state.drawing.hover) {
        const e = constrain(s, state.drawing.hover);
        const len = Math.abs(e.x - s.x) + Math.abs(e.y - s.y);
        out.push(`<line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}" stroke="#b45309" stroke-width="100" stroke-dasharray="200 120" pointer-events="none"/>`);
        out.push(haloText((s.x + e.x) / 2 + 250, (s.y + e.y) / 2 - 250, `${len} mm`, 190, 'font-weight="700" pointer-events="none"'));
      }
    }
    // Overall size, north point and scale bar.
    out.push(`<g fill="#333" stroke="#333" font-size="170">
      <line x1="0" y1="-450" x2="${FLOOR.w}" y2="-450" stroke-width="16"/><line x1="0" y1="-560" x2="0" y2="-340" stroke-width="16"/><line x1="${FLOOR.w}" y1="-560" x2="${FLOOR.w}" y2="-340" stroke-width="16"/>
      <text x="${FLOOR.w / 2}" y="-570" text-anchor="middle" stroke="none">${FLOOR.w} mm</text>
      <line x1="-450" y1="0" x2="-450" y2="${FLOOR.h}" stroke-width="16"/><line x1="-560" y1="0" x2="-340" y2="0" stroke-width="16"/><line x1="-560" y1="${FLOOR.h}" x2="-340" y2="${FLOOR.h}" stroke-width="16"/>
      <text x="-540" y="${FLOOR.h / 2}" text-anchor="middle" stroke="none" transform="rotate(-90 -540 ${FLOOR.h / 2})">${FLOOR.h} mm</text>
      <path d="M9450 -880L9580 -520L9450 -590L9320 -520Z" stroke="none"/><text x="9450" y="-380" text-anchor="middle" stroke="none" font-weight="700">N</text>
      <rect x="0" y="6480" width="1000" height="90" stroke-width="12"/><rect x="1000" y="6480" width="1000" height="90" fill="#fff" stroke-width="12"/>
      <text x="0" y="6760" stroke="none">0</text><text x="1000" y="6760" text-anchor="middle" stroke="none">1 m</text><text x="2000" y="6760" text-anchor="middle" stroke="none">2 m</text>
    </g>`);
    return out.join('');
  }

  function keyPlanMarkup(face) {
    const z = face.zone;
    const out = [`<rect x="0" y="0" width="${FLOOR.w}" height="${FLOOR.h}" fill="#fff"/>`,
      `<rect x="${z.x0}" y="${z.y0}" width="${z.x1 - z.x0}" height="${z.y1 - z.y0}" fill="${z.colour}" fill-opacity="0.25" stroke="${z.colour}" stroke-width="60" stroke-dasharray="240 140"/>`];
    for (const w of walls()) out.push(`<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${w.added ? '#b45309' : '#444'}" stroke-width="${THICK[w.kind]}" stroke-linecap="square"/>`);
    const a = wallPoint(face.wall, face.from, face.side, 180);
    const b = wallPoint(face.wall, face.to, face.side, 180);
    out.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#c0392b" stroke-width="360"/>`);
    out.push(haloText((z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2, z.id, 600, 'font-weight="700"'));
    return out.join('');
  }

  function wallMarkup(face) {
    const L = face.to - face.from;
    const H = FLOOR.ceiling;
    const span = L + 1200;
    const s = Math.max(170, span / 26);
    const fs = Math.max(90, span / 50);
    const inc = face.side === 'S' || face.side === 'W';
    const u = (at) => (inc ? at - face.from : face.to - at);
    const Y = (h) => H - h;
    const labels = routeLabels();
    const out = [];
    out.push(`<rect x="0" y="0" width="${L}" height="${H}" fill="${face.wall.added ? '#fff4e5' : '#f6f2ea'}" stroke="#333" stroke-width="${fs * 0.2}"/>`);
    out.push(`<line x1="-300" y1="${H}" x2="${L + 300}" y2="${H}" stroke="#222" stroke-width="${fs * 0.45}"/>`);
    out.push(`<text x="${L / 2}" y="${-fs * 0.6}" font-size="${fs}" text-anchor="middle" fill="#444">Ceiling ${H} mm (assumed)</text>`);
    for (const o of OPENINGS) {
      if (o.wall !== face.wall.id) continue;
      const a = Math.max(o.from, face.from), b = Math.min(o.to, face.to);
      if (b - a <= 0) continue;
      const x = Math.min(u(a), u(b)), w = Math.abs(u(b) - u(a));
      out.push(`<rect x="${x}" y="${Y(o.head)}" width="${w}" height="${o.head - o.sill}" fill="${o.kind === 'window' ? '#dbe9f7' : '#ebe5d8'}" stroke="#555" stroke-width="${fs * 0.15}"/>`);
      out.push(`<text x="${x + w / 2}" y="${Y(o.head) + fs * 1.3}" font-size="${fs * 0.85}" text-anchor="middle" fill="#444">${esc(o.label)}</text>`);
    }
    const k = Math.max(60, s * 0.32);
    for (const r of ROUTES) {
      const type = state.routeTypes[r.id];
      if (!state.show[type]) continue;
      const g = [];
      const on = r.id === state.routeId;
      for (const run of r.runs) {
        if (run.wall !== face.wall.id || run.side !== face.side) continue;
        const a = Math.max(run.from, face.from), b = Math.min(run.to, face.to);
        if (b - a <= 0) continue;
        const x1 = Math.min(u(a), u(b)), x2 = Math.max(u(a), u(b));
        if (on) g.push(`<line x1="${x1}" y1="${Y(run.h)}" x2="${x2}" y2="${Y(run.h)}" stroke="#ffd400" stroke-width="${k * 4}" stroke-opacity="0.6"/>`);
        g.push(routeLine(type, [x1, Y(run.h)], [x2, Y(run.h)], k));
        g.push(routeTag(Math.min(x1 + fs * 1.6, (x1 + x2) / 2), Y(run.h) - k - fs * 0.9, labels[r.id], type, fs * 0.9));
      }
      for (const d of r.drops) {
        if (d.wall !== face.wall.id || d.side !== face.side || d.at < face.from || d.at > face.to) continue;
        g.push(routeLine(type, [u(d.at), Y(d.h1)], [u(d.at), Y(d.h2)], k));
      }
      if (g.length) out.push(`<g class="route" data-route="${r.id}" data-route-type="${type}">${g.join('')}</g>`);
    }
    let fitCount = 0;
    for (const f of FITTINGS) {
      if (f.wall !== face.wall.id || f.side !== face.side || f.at < face.from || f.at > face.to) continue;
      fitCount += 1;
      const x = u(f.at), y = Y(f.h);
      out.push(symbol(f.type, x, y, s));
      out.push(haloText(x, y + s * 0.5 + fs * 0.75, `h ${f.h}`, fs * 0.8));
    }
    if (face.wall.added) {
      out.push(haloText(L / 2, H / 2, 'New wall: nothing placed on it yet', fs * 1.1, 'font-weight="700"', '#7a3d00'));
    } else if (!fitCount && !out.some((p) => p.includes('class="route"'))) {
      out.push(haloText(L / 2, H / 2, 'No fittings or routes on this wall', fs, '', '#555'));
    }
    // Ends: which way each end points, and whether the wall carries on outside the zone.
    const rightDir = { S: 'east', N: 'west', E: 'north', W: 'south' }[face.side];
    const leftDir = { east: 'west', west: 'east', north: 'south', south: 'north' }[rightDir];
    const len = wallLen(face.wall);
    const leftCont = inc ? face.from > 0 : face.to < len;
    const rightCont = inc ? face.to < len : face.from > 0;
    out.push(`<text x="0" y="${H + fs * 1.3}" font-size="${fs * 0.85}" fill="#444">${leftCont ? '‹ wall continues · ' : ''}${cap(leftDir)} end</text>`);
    out.push(`<text x="${L}" y="${H + fs * 1.3}" font-size="${fs * 0.85}" text-anchor="end" fill="#444">${cap(rightDir)} end${rightCont ? ' · wall continues ›' : ''}</text>`);
    const dy = H + fs * 2.6;
    out.push(`<g stroke="#333" stroke-width="${fs * 0.12}"><line x1="0" y1="${dy}" x2="${L}" y2="${dy}"/><line x1="0" y1="${dy - fs * 0.5}" x2="0" y2="${dy + fs * 0.5}"/><line x1="${L}" y1="${dy - fs * 0.5}" x2="${L}" y2="${dy + fs * 0.5}"/></g>`);
    out.push(haloText(L / 2, dy, `${L} mm`, fs, 'font-weight="700"'));
    return { vb: `-600 ${-fs * 2.2} ${L + 1200} ${H + fs * 6}`, markup: out.join('') };
  }

  // ---------- Panel, legend, viewbar ----------
  function swatchSVG(kind) {
    const k = 6;
    if (kind === 'trunking' || kind === 'conduit') return `<svg width="48" height="18" viewBox="0 0 48 18" aria-hidden="true">${routeLine(kind, [2, 9], [46, 9], k)}</svg>`;
    if (kind === 'drop') return `<svg width="48" height="18" viewBox="0 0 48 18" aria-hidden="true"><circle cx="24" cy="9" r="7" fill="#fff" stroke="#1d5fa8" stroke-width="2.4"/><circle cx="24" cy="9" r="2.6" fill="#1d5fa8"/></svg>`;
    if (kind === 'ext' || kind === 'int' || kind === 'new') {
      const w = kind === 'ext' ? 8 : 3;
      return `<svg width="48" height="18" viewBox="0 0 48 18" aria-hidden="true"><line x1="2" y1="9" x2="46" y2="9" stroke="${kind === 'new' ? '#b45309' : '#262626'}" stroke-width="${w}"/></svg>`;
    }
    if (kind === 'zone') return `<svg width="48" height="18" viewBox="0 0 48 18" aria-hidden="true"><rect x="2" y="2" width="44" height="14" fill="#d9822b" fill-opacity=".15" stroke="#d9822b" stroke-width="2" stroke-dasharray="6 4"/></svg>`;
    return `<svg width="48" height="22" viewBox="0 0 48 22" aria-hidden="true">${symbol(kind, 24, 11, 18)}</svg>`;
  }

  function legendHTML() {
    const t = countType('trunking'), c = countType('conduit');
    return `<h3>Walls and zones</h3><ul>
      <li>${swatchSVG('ext')}Exterior wall</li><li>${swatchSVG('int')}Interior wall</li><li>${swatchSVG('new')}Added wall (sample)</li><li>${swatchSVG('zone')}Zone boundary</li></ul>
      <h3>Containment (proposed)</h3><ul>
      <li>${swatchSVG('trunking')}Trunking (${t}) T1, T2…</li><li>${swatchSVG('conduit')}Conduit (${c}) C1, C2…</li><li>${swatchSVG('drop')}Drop between heights</li></ul>
      <h3>Fittings</h3><ul>${Object.keys(FITTING_TYPES).map((k) => `<li>${swatchSVG(k)}${esc(FITTING_TYPES[k])}</li>`).join('')}</ul>`;
  }
  const legendLine = () => `T = trunking (solid band), C = conduit (dashed line), circle = drop. SO socket, SW switch, FS fused spur, D data, DB board, crossed circle = ceiling light. Heights in mm above floor.`;

  function renderViewbar() {
    for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
    $('#zone-select').value = state.zoneId;
    const list = faces();
    $('#wall-tabs').innerHTML = list.map((f) => {
      const pressed = state.view === 'wall' && f.id === state.faceId;
      const cur = state.view === 'floor' && f.id === state.faceId ? ' class="current"' : '';
      return `<button type="button"${cur} data-face="${esc(f.id)}" aria-pressed="${pressed}" title="${esc(faceName(f))}">${esc(faceShort(f))}</button>`;
    }).join('') + missingEdges(list).map((l) => `<span class="wall-gap">${cap(l)}: zone edge, no wall</span>`).join('');
  }

  function renderDrawing() {
    const svg = $('#drawing');
    const z = zone();
    svg.classList.toggle('drawing-wall', Boolean(state.drawing));
    if (state.view === 'floor') {
      svg.setAttribute('viewBox', PLAN_VB);
      svg.innerHTML = planMarkup();
      $('#view-title').textContent = `Whole floor · ${z.name} selected`;
      svg.setAttribute('aria-label', `Floor plan of the sample barber shop with ${ZONES.length} zones. ${z.name} is selected.`);
      return;
    }
    const f = currentFace();
    if (!f) {
      svg.setAttribute('viewBox', '0 0 100 40');
      svg.innerHTML = '<text x="50" y="20" font-size="5" text-anchor="middle">This zone has no walls to show.</text>';
      $('#view-title').textContent = `${z.name} · no walls`;
      return;
    }
    const { vb, markup } = wallMarkup(f);
    svg.setAttribute('viewBox', vb);
    svg.innerHTML = markup;
    $('#view-title').textContent = `${z.name} · ${faceName(f)}`;
    svg.setAttribute('aria-label', `Wall view of ${faceName(f)} in ${z.name}, looking ${f.look}.`);
  }

  function renderPanel() {
    const z = zone();
    const list = faces();
    const labels = routeLabels();
    const fits = FITTINGS.filter((f) => inZone(z, fittingPos(f)));
    const touching = ROUTES.filter((r) => routeTouchesZone(r, z)).map((r) => labels[r.id]);
    $('#zone-info').innerHTML = `<h2><span class="zone-swatch" style="background:${z.colour}"></span>${esc(z.name)}<span class="zone-id">${z.id}</span></h2>
      <p>${esc(z.purpose)}</p>
      <ul class="facts"><li>${list.length} wall view${list.length === 1 ? '' : 's'}: ${list.map((f) => esc(faceShort(f))).join(', ') || 'none'}</li>
      <li>${fits.length} fittings on the plan</li><li>Routes in this zone: ${touching.join(', ') || 'none'}</li></ul>`;

    $('#show-trunking').checked = state.show.trunking;
    $('#show-conduit').checked = state.show.conduit;
    $('#count-trunking').textContent = `(${countType('trunking')})`;
    $('#count-conduit').textContent = `(${countType('conduit')})`;
    $('#route-list').innerHTML = ROUTES.map((r) => {
      const t = state.routeTypes[r.id];
      const on = r.id === state.routeId;
      return `<li class="route-row${on ? ' sel' : ''}">
        <button type="button" class="route-pick" data-pick-route="${r.id}" aria-pressed="${on}">${swatchSVG(t)}<span><b>${labels[r.id]}</b> ${esc(r.name)}</span></button>
        <label class="route-type">Type <select data-route-select="${r.id}" data-testid="route-type-${r.id}">
          <option value="trunking"${t === 'trunking' ? ' selected' : ''}>Trunking</option>
          <option value="conduit"${t === 'conduit' ? ' selected' : ''}>Conduit</option></select></label></li>`;
    }).join('');
    const r = ROUTES.find((x) => x.id === state.routeId);
    $('#route-detail').innerHTML = r ? `<dl>
      <dt>Route</dt><dd>${labels[r.id]} · ${esc(r.name)}</dd>
      <dt>Type</dt><dd>${ROUTE_TYPES[state.routeTypes[r.id]].name}${state.routeTypes[r.id] === r.type ? '' : ' (changed in this preview)'}</dd>
      <dt>Walls</dt><dd>${[...new Set(r.runs.map((x) => x.wall))].join(', ')}</dd>
      <dt>Heights</dt><dd>${[...new Set(r.runs.map((x) => x.h))].join(', ')} mm (sample)</dd>
      <dt>Drops</dt><dd>${r.drops.length}</dd>
      <dt>Size</dt><dd>Not set</dd><dt>Accessories</dt><dd>Not set</dd></dl>` : '';

    $('#added-walls').textContent = state.added.length
      ? `Added: ${state.added.map((w) => `${w.id} (${wallLen(w)} mm, runs ${isH(w) ? 'east to west' : 'north to south'})`).join(', ')}.`
      : 'No walls added yet.';
    $('#btn-remove-walls').disabled = !state.added.length;
    $('#btn-sample-wall').disabled = state.added.length >= MAX_ADDED;
    $('#btn-draw-wall').textContent = state.drawing ? 'Stop drawing' : 'Draw a wall on the plan';
    $('#btn-draw-wall').setAttribute('aria-pressed', String(Boolean(state.drawing)));
    for (const el of document.querySelectorAll('.legend-body')) el.innerHTML = legendHTML();
  }

  function render() {
    ensureFace();
    renderViewbar();
    renderDrawing();
    renderPanel();
    if (!$('#print-root').hidden) renderPrint();
  }

  function hint(msg) { $('#hint').textContent = msg; }
  function defaultHint() {
    hint(state.view === 'floor'
      ? 'Tap a zone to select it, or a route label to see its details.'
      : 'Heights are mm above the finished floor. Ceiling lights show on the floor plan only.');
  }

  // ---------- Print preview ----------
  function renderPrint() {
    $('#print-zone-boxes').innerHTML = ZONES.map((z) => `<label><input type="checkbox" data-print-zone="${z.id}" data-testid="print-zone-${z.id}"${state.printZones.has(z.id) ? ' checked' : ''}> ${esc(z.name)}</label>`).join('');
    const sheets = [{ kind: 'plan' }];
    for (const z of ZONES) {
      if (!state.printZones.has(z.id)) continue;
      for (const f of facesForZone(z)) sheets.push({ kind: 'wall', z, f });
    }
    const total = sheets.length;
    const shown = ['trunking', 'conduit'].filter((t) => state.show[t]).map((t) => ROUTE_TYPES[t].name.toLowerCase());
    const shownText = shown.length ? `Containment shown: ${shown.join(' and ')}.` : 'Containment hidden.';
    $('#print-count').textContent = `${total} sheet${total === 1 ? '' : 's'}`;
    $('#sheets').innerHTML = sheets.map((sh, i) => {
      const no = `Sheet ${i + 1} of ${total}`;
      let title, sub, body;
      if (sh.kind === 'plan') {
        title = 'Whole floor overview';
        sub = `Sample barbershop (invented) · ${ZONES.map((z) => `${z.id} ${z.name}`).join(', ')} · north up`;
        body = `<svg class="main-drawing" viewBox="${PLAN_VB}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Whole floor overview">${planMarkup({ print: true })}</svg>`;
      } else {
        const { vb, markup } = wallMarkup(sh.f);
        title = `${sh.z.name} · ${faceName(sh.f)}`;
        sub = `Zone ${sh.z.id} · wall view looking ${sh.f.look} · ${sh.f.to - sh.f.from} mm long · key plan shows the wall in red`;
        body = `<svg class="main-drawing" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(title)}">${markup}</svg>
          <svg class="key-plan" viewBox="-300 -300 9600 6600" role="img" aria-label="Key plan">${keyPlanMarkup(sh.f)}</svg>`;
      }
      return `<article class="sheet" data-testid="sheet">
        <header class="sheet-head"><h3 class="sheet-title">${esc(title)}</h3><span class="sheet-no">${no}</span></header>
        <p class="sheet-sub">${esc(sub)}</p>
        <div class="sheet-body">${body}</div>
        <footer class="sheet-foot"><span>${esc(legendLine())}</span><span>Design preview, not for construction. ${shownText} Containment sizes not set.</span></footer>
      </article>`;
    }).join('');
  }

  function openPrint() {
    stopDrawing();
    state.printZones = new Set([state.zoneId]);
    state.lastFocus = document.activeElement;
    $('#print-root').hidden = false;
    document.body.classList.add('print-open');
    renderPrint();
    $('#btn-close-print').focus();
  }
  function closePrint() {
    $('#print-root').hidden = true;
    document.body.classList.remove('print-open');
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  // ---------- Adding walls ----------
  function svgPoint(e) {
    const svg = $('#drawing');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const snap = (p) => ({ x: clamp(Math.round(p.x / GRID) * GRID, 0, FLOOR.w), y: clamp(Math.round(p.y / GRID) * GRID, 0, FLOOR.h) });
  const constrain = (s, p) => (Math.abs(p.x - s.x) >= Math.abs(p.y - s.y) ? { x: p.x, y: s.y } : { x: s.x, y: p.y });

  function tryAddWall(p, q) {
    if (state.added.length >= MAX_ADDED) return { ok: false, msg: `This preview allows ${MAX_ADDED} added walls. Remove added walls to try again.` };
    let { x: x1, y: y1 } = p;
    let { x: x2, y: y2 } = q;
    if (x1 !== x2 && y1 !== y2) return { ok: false, msg: 'Walls in this preview run straight across or straight down.' };
    if (x1 > x2) [x1, x2] = [x2, x1];
    if (y1 > y2) [y1, y2] = [y2, y1];
    const len = x2 - x1 + y2 - y1;
    if (len < 500) return { ok: false, msg: 'That wall would be shorter than 500 mm. Tap the start point again, then tap further away.' };
    const h = y1 === y2;
    const clash = walls().some((w) => isH(w) === h && (h ? w.y1 === y1 : w.x1 === x1)
      && Math.min(h ? w.x2 : w.y2, h ? x2 : y2) - Math.max(h ? w.x1 : w.y1, h ? x1 : y1) > 0);
    if (clash) return { ok: false, msg: 'A wall already runs along that line. Pick another spot.' };
    const before = Object.fromEntries(ZONES.map((z) => [z.id, facesForZone(z).length]));
    const w = { id: `W${state.nextWallNo++}`, x1, y1, x2, y2, kind: 'interior', added: true };
    state.added.push(w);
    const changed = ZONES.filter((z) => facesForZone(z).length !== before[z.id]).map((z) => `${z.name} now has ${facesForZone(z).length} wall views`);
    return { ok: true, msg: `Added ${w.id}, ${len} mm. ${changed.length ? `${changed.join('. ')}.` : 'It is outside every zone, so no wall views changed.'}` };
  }

  function startDrawing() {
    state.view = 'floor';
    state.drawing = { start: null, hover: null };
    if (narrow()) setPanel(false);
    hint('Drawing a wall: tap where it starts. Press Esc or Stop drawing to cancel.');
    render();
  }
  function stopDrawing(msg) {
    if (!state.drawing) return;
    state.drawing = null;
    render();
    if (msg) hint(msg); else defaultHint();
  }
  function drawingClick(e) {
    const p = snap(svgPoint(e));
    const d = state.drawing;
    if (!d.start) {
      d.start = p;
      d.hover = null;
      hint(`Start at ${p.x}, ${p.y} mm. Now tap where the wall ends.`);
      renderDrawing();
      return;
    }
    const res = tryAddWall(d.start, constrain(d.start, p));
    if (res.ok) { stopDrawing(res.msg); return; }
    d.start = null;
    d.hover = null;
    renderDrawing();
    hint(res.msg);
  }

  // ---------- Selection and wiring ----------
  function selectZone(id) {
    if (!zoneById(id)) return;
    state.zoneId = id;
    state.faceId = null;
    render();
    hint(`${zoneById(id).name} selected. ${faces().length} wall views available.`);
  }
  function setView(v) {
    if (v === 'wall') stopDrawing();
    state.view = v;
    render();
    defaultHint();
  }
  function selectRoute(id) {
    state.routeId = state.routeId === id ? null : id;
    render();
    if (state.routeId) hint(`${routeLabels()[id]} selected: ${ROUTES.find((r) => r.id === id).name}.`);
  }
  function setPanel(open) {
    document.body.classList.toggle('panel-closed', !open);
    const b = $('#btn-panel');
    b.setAttribute('aria-expanded', String(open));
    b.textContent = open ? 'Hide panel' : 'Show panel';
  }

  function init() {
    $('#zone-select').innerHTML = ZONES.map((z) => `<option value="${z.id}">${z.id} · ${esc(z.name)}</option>`).join('');
    $('#zone-select').addEventListener('change', (e) => selectZone(e.target.value));
    for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
    $('#wall-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-face]');
      if (!b) return;
      stopDrawing();
      state.faceId = b.dataset.face;
      state.view = 'wall';
      render();
      defaultHint();
    });

    const svg = $('#drawing');
    svg.addEventListener('click', (e) => {
      if (state.view !== 'floor') return;
      if (state.drawing) { drawingClick(e); return; }
      const r = e.target.closest('[data-route]');
      if (r) { selectRoute(r.dataset.route); return; }
      const p = svgPoint(e);
      const z = ZONES.find((zz) => inZone(zz, [p.x, p.y]));
      if (z) selectZone(z.id);
    });
    let frame = 0;
    svg.addEventListener('pointermove', (e) => {
      if (!state.drawing || !state.drawing.start) return;
      state.drawing.hover = snap(svgPoint(e));
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderDrawing(); });
    });

    $('#show-trunking').addEventListener('change', (e) => { state.show.trunking = e.target.checked; render(); });
    $('#show-conduit').addEventListener('change', (e) => { state.show.conduit = e.target.checked; render(); });
    $('#route-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick-route]');
      if (b) selectRoute(b.dataset.pickRoute);
    });
    $('#route-list').addEventListener('change', (e) => {
      const s = e.target.closest('[data-route-select]');
      if (!s) return;
      state.routeTypes[s.dataset.routeSelect] = s.value;
      render();
      hint(`Route changed to ${s.value}. Labels and the legend follow the new type.`);
    });

    $('#btn-draw-wall').addEventListener('click', () => (state.drawing ? stopDrawing() : startDrawing()));
    $('#btn-sample-wall').addEventListener('click', () => {
      stopDrawing();
      const res = tryAddWall({ x: 2500, y: 0 }, { x: 2500, y: 1500 });
      render();
      hint(res.msg);
    });
    $('#btn-remove-walls').addEventListener('click', () => {
      stopDrawing();
      state.added = [];
      state.nextWallNo = FIRST_ADDED_NO;
      render();
      hint('Added walls removed.');
    });

    $('#btn-panel').addEventListener('click', () => setPanel(document.body.classList.contains('panel-closed')));
    $('#btn-panel-close').addEventListener('click', () => setPanel(false));

    $('#btn-print').addEventListener('click', openPrint);
    $('#btn-close-print').addEventListener('click', closePrint);
    $('#btn-do-print').addEventListener('click', () => window.print());
    $('#print-zone-boxes').addEventListener('change', (e) => {
      const id = e.target.dataset.printZone;
      if (!id) return;
      if (e.target.checked) state.printZones.add(id); else state.printZones.delete(id);
      renderPrint();
      const box = document.querySelector(`[data-print-zone="${id}"]`);
      if (box) box.focus();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#print-root').hidden) closePrint();
      else if (state.drawing) stopDrawing('Drawing cancelled.');
    });

    setPanel(window.matchMedia('(min-width: 1000px)').matches);
    render();
    defaultHint();
  }

  init();
})();
