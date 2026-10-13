// Pure print-sheet planning. No DOM and no job mutation.
// Face offsets match floor-zones.js: viewed from the left of the face.

import { zonesOf, zoneTouchingFaces, wholeFloorFaces } from './floor-zones.js';
import { wallLength } from './floor-walls.js';

export const BUILD = 'surface-proto-v18-floor-fixes-20261013';

const EXTERIOR_NAME = {
  A: 'North wall (A)',
  B: 'East wall (B)',
  C: 'South wall (C)',
  D: 'West wall (D)',
};
const EXTERIOR_RANK = { A: 0, B: 1, C: 2, D: 3 };
const FACE_RANK = { N: 0, E: 1, S: 2, W: 3 };
const LOOKING = {
  A: 'north', B: 'east', C: 'south', D: 'west',
  N: 'south', E: 'west', S: 'north', W: 'east',
};

function metres(mm) {
  return (Number(mm) / 1000).toFixed(2);
}

function faceLength(job, face) {
  if (face.wall === 'A' || face.wall === 'C') return Math.round(Number(job.room.widthM) * 1000);
  if (face.wall === 'B' || face.wall === 'D') return Math.round(Number(job.room.depthM) * 1000);
  const walls = job && job.floor && Array.isArray(job.floor.walls) ? job.floor.walls : [];
  const wall = walls.find(item => item && item.id === face.wall);
  return wall ? wallLength(wall) : 0;
}

export function faceTitleName(face) {
  if (EXTERIOR_NAME[face.wall]) return EXTERIOR_NAME[face.wall];
  // A face on a zone edge uses the edge name: "North wall (W6)".
  if (face.edge && face.label) return face.label;
  return face.sideLabel || face.label || String(face.wall);
}

export function lookingWord(face) {
  if (EXTERIOR_NAME[face.wall]) return LOOKING[face.wall];
  return LOOKING[face.face] || 'north';
}

export function sheetSubtitle(sheet) {
  return `Looking ${lookingWord(sheet)} · ${metres(sheet.fromMm)} to ${metres(sheet.toMm)} m of ${metres(sheet.lengthMm)} m · key plan shows this wall in red`;
}

function wallRank(id) {
  if (Object.prototype.hasOwnProperty.call(EXTERIOR_RANK, id)) return EXTERIOR_RANK[id];
  const n = Number(String(id || '').slice(1));
  return 100 + (Number.isInteger(n) ? n : 999);
}

function compareSheets(a, b) {
  return wallRank(a.wall) - wallRank(b.wall)
    || (FACE_RANK[a.face] ?? 0) - (FACE_RANK[b.face] ?? 0);
}

// Endpoints of a zone clip that fall strictly inside the printed range.
function boundarySides(ranges, names, atMm) {
  const left = [];
  const right = [];
  ranges.forEach((range, i) => {
    const name = names[i];
    if (range[1] === atMm && !left.includes(name)) left.push(name);
    if (range[0] === atMm && !right.includes(name)) right.push(name);
  });
  return { left, right };
}

function boundariesFor(ranges, names, from, to) {
  const at = new Map();
  ranges.forEach((range, i) => {
    for (const mm of range) {
      if (mm <= from || mm >= to) continue;
      if (!at.has(mm)) at.set(mm, []);
      const list = at.get(mm);
      if (!list.includes(names[i])) list.push(names[i]);
    }
  });
  return [...at.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([atMm, zoneNames]) => {
      const sides = boundarySides(ranges, names, atMm);
      return { atMm, names: zoneNames, left: sides.left, right: sides.right };
    });
}

function finishSheet(job, face, fromMm, toMm, zoneNames, ranges, boundaryNames) {
  const lengthMm = faceLength(job, face);
  const sheet = {
    wall: face.wall,
    face: face.face,
    view: face.view,
    interior: !!face.interior,
    sideLabel: face.sideLabel || '',
    label: face.label || '',
    edge: face.edge || null,
    fromMm,
    toMm,
    lengthMm,
    zoneNames,
    boundaries: boundariesFor(ranges, boundaryNames, fromMm, toMm),
  };
  const scope = zoneNames.length ? zoneNames.join(', ') : 'Whole floor';
  sheet.title = `${scope} · ${faceTitleName(sheet)}`;
  sheet.subtitle = sheetSubtitle(sheet);
  return sheet;
}

export function useLegacyPack(job) {
  const floor = job && job.floor;
  const zones = floor && Array.isArray(floor.zones) ? floor.zones.length : 0;
  const walls = floor && Array.isArray(floor.walls) ? floor.walls.length : 0;
  const routes = floor && Array.isArray(floor.routes) ? floor.routes.length : 0;
  return zones === 0 && walls === 0 && routes === 0;
}

// whole: every physical face, full length.
// Otherwise one sheet per face touched by the ticked zones, range = hull of those clips.
export function planSheets(job, choice) {
  const whole = !choice || choice.whole;
  const wanted = new Set((choice && choice.zoneIds) || []);
  if (whole) {
    const rangesByFace = new Map();
    for (const zone of zonesOf(job)) {
      for (const face of zoneTouchingFaces(job, zone)) {
        const key = face.wall + '|' + face.face;
        if (!rangesByFace.has(key)) rangesByFace.set(key, { ranges: [], names: [] });
        const bucket = rangesByFace.get(key);
        bucket.ranges.push([face.fromMm, face.toMm]);
        bucket.names.push(zone.name);
      }
    }
    const sheets = wholeFloorFaces(job).map(face => {
      const bucket = rangesByFace.get(face.wall + '|' + face.face) || { ranges: [], names: [] };
      const lengthMm = faceLength(job, face);
      return finishSheet(job, face, 0, lengthMm, [], bucket.ranges, bucket.names);
    });
    return { sheets, sharedWalls: 0 };
  }
  const selected = zonesOf(job).filter(zone => wanted.has(zone.id));
  const buckets = new Map();
  for (const zone of selected) {
    for (const face of zoneTouchingFaces(job, zone)) {
      const key = face.wall + '|' + face.face;
      if (!buckets.has(key)) buckets.set(key, { face, ranges: [], names: [], zones: new Set() });
      const bucket = buckets.get(key);
      bucket.ranges.push([face.fromMm, face.toMm]);
      bucket.names.push(zone.name);
      bucket.zones.add(zone.id);
    }
  }
  const shared = new Set();
  for (const bucket of buckets.values()) {
    if (bucket.zones.size >= 2) shared.add(bucket.face.wall);
  }
  const sheets = [...buckets.values()].map(bucket => {
    const fromMm = Math.min(...bucket.ranges.map(range => range[0]));
    const toMm = Math.max(...bucket.ranges.map(range => range[1]));
    return finishSheet(job, bucket.face, fromMm, toMm, bucket.names, bucket.ranges, bucket.names);
  });
  sheets.sort(compareSheets);
  return { sheets, sharedWalls: shared.size };
}

export function countLine(sheetCount, sharedWalls) {
  const sheets = `${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'}`;
  if (sharedWalls === 1) return `${sheets}. 1 wall is shared by the ticked zones and prints once.`;
  if (sharedWalls > 1) return `${sheets}. ${sharedWalls} walls are shared by the ticked zones and print once.`;
  return sheets;
}

// Legacy wall pages: A4 landscape is 210mm tall and 297mm wide (print CSS has
// no @page margin). Each wall drawing is capped at 72mm. The other sizes are
// the print rules in style.css: 2px border and 6px padding on .page, 9.5pt
// header, 11pt h2 with 8px and 4px margins, 9pt rows with 3px padding, a 9pt
// footer, and the 16px "No fittings" paragraph. Line height is the 1.4 set
// on body. Fitting columns are the fixed mm widths on table.fitting-table.
const LEGACY_SHEET_MM = 210;
const LEGACY_PAGE_W_MM = 297;
const LEGACY_SVG_MM = 72;
const PX_MM = 25.4 / 96;
const PT_MM = 25.4 / 72;
const lineMm = (pt) => pt * PT_MM * 1.4;
const LEGACY_CHROME_MM = PX_MM * (2 + 6 + 1) + lineMm(9.5) + lineMm(9) + 9 * PT_MM;
const LEGACY_H2_MM = PX_MM * (8 + 4) + lineMm(11);
const LEGACY_ROW_PAD_MM = PX_MM * (3 + 3 + 1);
const LEGACY_EMPTY_MM = PX_MM * 16 * 1.4 + PX_MM * 16 * 2;
const LEGACY_SCOPE_PAD_MM = PX_MM * (3 + 3 + 1 + 1 + 4 + 4);
const LEGACY_SCOPE_MM = lineMm(9.5) + LEGACY_SCOPE_PAD_MM;
// 18+52+36+30+161 = 297. Same widths as the print CSS col rules.
const FIT_COL_MM = [18, 52, 36, 30, 161];
// Wider than an average system-ui glyph, and a word of slack, so a row is
// counted taller than it prints. Short labels still fit on one line.
const FIT_EM = 0.65;
const WORD_SLACK = 12;
const charsAcross = (widthMm, padPx, pt, em) => {
  const content = widthMm - PX_MM * padPx;
  return Math.max(1, Math.floor(content / (pt * PT_MM * em)));
};
const FIT_CHARS = FIT_COL_MM.map(mm => charsAcross(mm, 5 + 5 + 1, 9, FIT_EM));
const SCOPE_CHARS = charsAcross(LEGACY_PAGE_W_MM, 6 + 6 + 1 + 1, 9.5, 0.75);
const WALL_HEAD = ['ID', 'Type', 'From left (mm)', 'Height (mm)', 'Notes'];
const CEIL_HEAD = ['ID', 'Type', 'x (mm)', 'y (mm)', 'Notes'];

function wrappedLines(text, chars) {
  const len = String(text ?? '').length;
  if (len <= chars) return 1;
  return Math.ceil(len / Math.max(1, chars - WORD_SLACK));
}

function rowLines(cells) {
  const list = Array.isArray(cells) ? cells : [];
  let lines = 1;
  for (let i = 0; i < FIT_CHARS.length; i += 1) {
    lines = Math.max(lines, wrappedLines(list[i] || '', FIT_CHARS[i]));
  }
  return lines;
}

function headerLines(ceiling) {
  const heads = ceiling ? CEIL_HEAD : WALL_HEAD;
  let lines = 1;
  for (let i = 0; i < heads.length; i += 1) lines = Math.max(lines, wrappedLines(heads[i], FIT_CHARS[i]));
  return lines;
}

// One text line plus the cell padding. Extra wrapped lines add line height only.
function rowMm(lines) {
  return Math.max(1, lines) * lineMm(9) + LEGACY_ROW_PAD_MM;
}

function asLines(rows) {
  if (typeof rows === 'number') return Array.from({ length: Math.max(0, rows) }, () => 1);
  if (!Array.isArray(rows)) return [];
  return rows.map(rowLines);
}

function scopeMm(scopeNote) {
  if (!scopeNote) return 0;
  if (scopeNote === true) return LEGACY_SCOPE_MM;
  const lines = wrappedLines(scopeNote, SCOPE_CHARS);
  return lines * lineMm(9.5) + LEGACY_SCOPE_PAD_MM;
}

function legacyChromeMm(scopeNote) {
  return LEGACY_CHROME_MM + scopeMm(scopeNote);
}

// svg: the 72mm drawing. No rows and a drawing is the empty-wall note.
function legacySectionMm(lines, svg, ceiling) {
  const head = LEGACY_H2_MM + (svg ? LEGACY_SVG_MM : 0);
  if (!lines.length) return svg ? head + LEGACY_EMPTY_MM : 0;
  let body = rowMm(headerLines(ceiling));
  for (const n of lines) body += rowMm(n);
  return head + body;
}

function legacyFits(contentMm, scopeNote) {
  return legacyChromeMm(scopeNote) + contentMm <= LEGACY_SHEET_MM;
}

// How many rows from `from` fit in room after fixed chrome. A row taller than
// the room is not included; the caller still places that single row.
function rowsThatFit(roomMm, fixedMm, lines, from) {
  let used = fixedMm;
  let n = 0;
  while (from + n < lines.length) {
    const h = rowMm(lines[from + n]);
    if (used + h > roomMm + 1e-6) break;
    used += h;
    n += 1;
  }
  return n;
}

function rowsHeight(lines, from, n) {
  let h = 0;
  for (let i = 0; i < n; i += 1) h += rowMm(lines[from + i]);
  return h;
}

// One wall, then any ceiling rows that follow wall D. Split the table when
// the drawing plus the wrapped rows will not stay on one sheet.
function paginateLegacyWall(wall, lines, ceilingLines, scopeNote) {
  const pages = [];
  let from = 0;
  let cfrom = 0;
  let started = false;
  const limit = lines.length + ceilingLines.length + 2;
  for (let guard = 0; guard < limit && (!started || from < lines.length || cfrom < ceilingLines.length); guard += 1) {
    let room = LEGACY_SHEET_MM - legacyChromeMm(scopeNote);
    const blocks = [];
    if (!started || from < lines.length) {
      const svg = !started;
      const head = LEGACY_H2_MM + (svg ? LEGACY_SVG_MM : 0);
      if (!started && lines.length === 0) {
        blocks.push({ kind: 'wall', wall, from: 0, to: 0, svg: true });
        room -= head + LEGACY_EMPTY_MM;
        started = true;
      } else if (from < lines.length) {
        const fixed = head + rowMm(headerLines(false));
        let n = rowsThatFit(room, fixed, lines, from);
        if (n < 1) n = 1;
        blocks.push({ kind: 'wall', wall, from, to: from + n, svg });
        room -= fixed + rowsHeight(lines, from, n);
        from += n;
        started = true;
      }
    }
    if (started && from >= lines.length && cfrom < ceilingLines.length) {
      const fixed = LEGACY_H2_MM + rowMm(headerLines(true));
      let n = rowsThatFit(room, fixed, ceilingLines, cfrom);
      if (n < 1) {
        if (blocks.length) {
          pages.push({ blocks });
          continue;
        }
        n = 1;
      }
      blocks.push({ kind: 'ceiling', from: cfrom, to: cfrom + n });
      cfrom += n;
    }
    if (!blocks.length) break;
    pages.push({ blocks });
  }
  return pages;
}

// walls: { A, B, C, D, ceiling }, each an array of fitting cell strings
// (one row). A number still means that many single-line rows. scopeNote is
// the layer paragraph, or a truthy flag for one reserved line. Pairs stay
// together only when both walls, their wrapped tables, and the ceiling
// fittings after wall D fit one sheet. Otherwise each wall has its own pages.
export function planLegacyWalls(walls, scopeNote) {
  const pages = [];
  const group = walls || {};
  for (const [left, right] of [['A', 'B'], ['C', 'D']]) {
    const leftLines = asLines(group[left]);
    const rightLines = asLines(group[right]);
    const ceilingLines = right === 'D' ? asLines(group.ceiling) : [];
    const content = legacySectionMm(leftLines, true, false)
      + legacySectionMm(rightLines, true, false)
      + (ceilingLines.length ? legacySectionMm(ceilingLines, false, true) : 0);
    if (legacyFits(content, scopeNote)) {
      const blocks = [
        { kind: 'wall', wall: left, from: 0, to: leftLines.length, svg: true },
        { kind: 'wall', wall: right, from: 0, to: rightLines.length, svg: true },
      ];
      if (ceilingLines.length) blocks.push({ kind: 'ceiling', from: 0, to: ceilingLines.length });
      pages.push({ blocks });
    } else {
      pages.push(...paginateLegacyWall(left, leftLines, [], scopeNote));
      pages.push(...paginateLegacyWall(right, rightLines, ceilingLines, scopeNote));
    }
  }
  return pages;
}

// Overview, the legacy wall pages, and the labour page.
export function legacyPageCount(counts, scopeNote) {
  return planLegacyWalls(counts, scopeNote).length + 2;
}
