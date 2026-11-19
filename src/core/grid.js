// The pencil transfer grid: squares of a set spacing over the pattern, columns
// numbered 1, 2, 3 ... from the left and rows lettered A, B, C ... from the top
// (Z, then AA, AB ...), so square "C4" is the same square on the printout and
// on a canvas gridded in pencil at the same spacing (or at a multiple of it, to
// scale the design up by eye).
//
// THE GRID IS GLOBAL: it starts at the canvas's top-left corner, and every page
// of a split 1:1 pattern draws its own window of it with the labels of the
// squares it shows, along its own top and left edges. So pages still agree with
// each other and with the canvas, wherever they were cut.
//
// It is drawn light blue: distinct from the grey pattern lines, which are what
// gets painted over.

import { fmt, escapeXml, FONT } from './svg.js';

export const GRID_COLOR = '#4a86d8';

/** Row label for index i: 0 -> A, 25 -> Z, 26 -> AA. */
export function gridLetters(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Column label for index i: 0 -> 1. */
export const gridNumber = (i) => String(i + 1);

/** The grid's interior lines, mm: {xs, ys, cols, rows}. */
export function gridLines(W, H, spacing) {
  const xs = [], ys = [];
  if (!(spacing > 0)) return { xs, ys, cols: 1, rows: 1 };
  for (let x = spacing; x < W - 1e-6; x += spacing) xs.push(x);
  for (let y = spacing; y < H - 1e-6; y += spacing) ys.push(y);
  return { xs, ys, cols: xs.length + 1, rows: ys.length + 1 };
}

/**
 * The labels a window shows: one per column whose middle is inside it (along
 * its top edge) and one per row (along its left edge).
 * @returns {{cols:Array<{x, text}>, rows:Array<{y, text}>}}
 */
export function gridLabels(W, H, spacing, win) {
  const cols = [], rows = [];
  if (!(spacing > 0)) return { cols, rows };
  for (let i = 0; i * spacing < W; i++) {
    const mid = (i * spacing + Math.min(W, (i + 1) * spacing)) / 2;
    if (mid >= win.x0 && mid <= win.x1) cols.push({ x: mid, text: gridNumber(i) });
  }
  for (let j = 0; j * spacing < H; j++) {
    const mid = (j * spacing + Math.min(H, (j + 1) * spacing)) / 2;
    if (mid >= win.y0 && mid <= win.y1) rows.push({ y: mid, text: gridLetters(j) });
  }
  return { cols, rows };
}

/**
 * The grid over one window of the pattern, as SVG elements in pattern mm.
 * @param {{x0, y0, x1, y1}} win
 * @param {{fs:number, lw:number}} o  label size and line width, mm in pattern units
 */
export function gridSVG(W, H, spacing, win, o) {
  const { xs, ys } = gridLines(W, H, spacing);
  const out = [`<g class="grid" stroke="${GRID_COLOR}" stroke-width="${fmt(o.lw)}" fill="none">`];
  for (const x of xs) if (x > win.x0 && x < win.x1) out.push(`<path d="M${fmt(x)} ${fmt(win.y0)}V${fmt(win.y1)}"/>`);
  for (const y of ys) if (y > win.y0 && y < win.y1) out.push(`<path d="M${fmt(win.x0)} ${fmt(y)}H${fmt(win.x1)}"/>`);
  out.push('</g>');
  const L = gridLabels(W, H, spacing, win);
  const pad = 0.4 * o.fs;
  out.push(`<g class="gridlabels" fill="${GRID_COLOR}" font-family="${FONT}" font-weight="bold" font-size="${fmt(o.fs, 2)}" text-anchor="middle">`);
  for (const c of L.cols) out.push(`<text x="${fmt(c.x)}" y="${fmt(win.y0 + pad + 0.72 * o.fs)}">${escapeXml(c.text)}</text>`);
  for (const r of L.rows) out.push(`<text x="${fmt(win.x0 + pad + 0.6 * o.fs)}" y="${fmt(r.y + 0.36 * o.fs)}">${escapeXml(r.text)}</text>`);
  out.push('</g>');
  return out.join('\n');
}

/** Label size for a spacing, mm: a third of a square, between 2 and 5. */
export const gridFont = (spacing) => Math.max(2, Math.min(5, spacing / 3));
