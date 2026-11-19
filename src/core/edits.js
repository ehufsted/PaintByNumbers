// Hand edits to the regions: recolor a region, merge one into another, or paint
// with a brush.
//
// EDITS ARE OPERATIONS, NOT PIXELS. Each is kept as what the person did, in mm
// on the canvas, with colors as hex:
//
//   {op: 'recolor', x, y, hex}          the region at (x, y) becomes hex
//   {op: 'merge', x, y, x2, y2}         the region at (x, y) takes the color of
//                                       the region at (x2, y2)
//   {op: 'brush', hex, r, pts: [x, y, ...]}   a stroke of radius r
//
// They are applied, in order, to the color map after the detail limits and
// before the boundaries are traced (pipeline.js), so the regions still tile the
// canvas and every edited region gets its number. Because they are positions and
// colors, not pixels, they survive changes to the settings: a recolor still
// lands on whatever region is at that point, and a color that is no longer in
// the palette goes to the nearest one that is. Edits are deliberate, so they
// are not held to the detail limits (a brush can make a region as small as it
// likes).

import { hexLab } from './palette.js';
import { deltaE, normalizeHex } from './color.js';

const OPS = new Set(['recolor', 'merge', 'brush']);
export const MAX_EDITS = 2000;

/** The palette index for a hex: exact, else the nearest by ΔE. */
function indexFor(pal, hex) {
  const exact = pal.findIndex((p) => p.hex === hex);
  if (exact >= 0) return exact;
  const lab = hexLab(hex);
  let best = 0, bd = Infinity;
  pal.forEach((p, i) => { const d = deltaE(lab, p.lab); if (d < bd) { bd = d; best = i; } });
  return best;
}

/**
 * @param {Uint16Array} colors  palette index per grid pixel
 * @param {{w, h, sx, sy}} g    the grid; sx, sy mm per pixel
 * @param {Array<{hex, lab}>} pal
 * @param {object[]} edits
 * @returns {{colors: Uint16Array, applied: number}} applied: edits that changed something
 */
export function applyEdits(colors, g, pal, edits) {
  const { w, h, sx, sy } = g;
  const out = Uint16Array.from(colors);
  const px = (x, y) => Math.min(h - 1, Math.max(0, Math.floor(y / sy))) * w + Math.min(w - 1, Math.max(0, Math.floor(x / sx)));
  const stack = new Int32Array(w * h);
  // the 4-connected region of one color at pixel s, to color `to`; returns pixels changed
  const flood = (s, to) => {
    const from = out[s];
    if (from === to) return 0;
    let top = 0, n = 0;
    stack[top++] = s; out[s] = to;
    while (top) {
      const k = stack[--top];
      n++;
      const x = k % w;
      if (x > 0 && out[k - 1] === from) { out[k - 1] = to; stack[top++] = k - 1; }
      if (x < w - 1 && out[k + 1] === from) { out[k + 1] = to; stack[top++] = k + 1; }
      if (k >= w && out[k - w] === from) { out[k - w] = to; stack[top++] = k - w; }
      if (k + w < w * h && out[k + w] === from) { out[k + w] = to; stack[top++] = k + w; }
    }
    return n;
  };
  let applied = 0;
  for (const e of edits) {
    let changed = 0;
    if (e.op === 'recolor') changed = flood(px(e.x, e.y), indexFor(pal, e.hex));
    else if (e.op === 'merge') changed = flood(px(e.x, e.y), out[px(e.x2, e.y2)]);
    else if (e.op === 'brush') {
      const to = indexFor(pal, e.hex), r = e.r, p = e.pts;
      const segs = p.length >= 4 ? (p.length / 2 - 1) : 1;
      for (let s = 0; s < segs; s++) {
        const ax = p[2 * s], ay = p[2 * s + 1];
        const bx = p.length >= 4 ? p[2 * s + 2] : ax, by = p.length >= 4 ? p[2 * s + 3] : ay;
        const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - r) / sx)), x1 = Math.min(w - 1, Math.floor((Math.max(ax, bx) + r) / sx));
        const y0 = Math.max(0, Math.floor((Math.min(ay, by) - r) / sy)), y1 = Math.min(h - 1, Math.floor((Math.max(ay, by) + r) / sy));
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        for (let gy = y0; gy <= y1; gy++) {
          for (let gx = x0; gx <= x1; gx++) {
            const cx = (gx + 0.5) * sx - ax, cy = (gy + 0.5) * sy - ay;
            const t = L2 > 0 ? Math.max(0, Math.min(1, (cx * dx + cy * dy) / L2)) : 0;
            if ((cx - t * dx) ** 2 + (cy - t * dy) ** 2 <= r * r) {
              const i = gy * w + gx;
              if (out[i] !== to) { out[i] = to; changed++; }
            }
          }
        }
      }
    }
    if (changed) applied++;
  }
  return { colors: out, applied };
}

/**
 * Edits from a file or storage, made safe: known ops with finite numbers and
 * valid colors only. @returns {{edits: object[], dropped: number}}
 */
export function parseEdits(src) {
  if (!Array.isArray(src)) return { edits: [], dropped: 0 };
  const ok = (...v) => v.every((x) => typeof x === 'number' && isFinite(x));
  const edits = [];
  let dropped = 0;
  for (const e of src.slice(0, MAX_EDITS)) {
    if (!e || !OPS.has(e.op)) { dropped++; continue; }
    if (e.op === 'recolor' && ok(e.x, e.y) && normalizeHex(e.hex)) edits.push({ op: 'recolor', x: e.x, y: e.y, hex: normalizeHex(e.hex) });
    else if (e.op === 'merge' && ok(e.x, e.y, e.x2, e.y2)) edits.push({ op: 'merge', x: e.x, y: e.y, x2: e.x2, y2: e.y2 });
    else if (e.op === 'brush' && ok(e.r) && e.r > 0 && Array.isArray(e.pts) && e.pts.length >= 2 && e.pts.length % 2 === 0 && ok(...e.pts) && normalizeHex(e.hex)) {
      edits.push({ op: 'brush', hex: normalizeHex(e.hex), r: e.r, pts: e.pts.slice() });
    } else dropped++;
  }
  return { edits, dropped: dropped + Math.max(0, src.length - MAX_EDITS) };
}
