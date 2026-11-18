// Where each region's number goes, and how big it is.
//
// THE MOST ROOM. A number sits at the region's POLE OF INACCESSIBILITY: the point
// farthest from its boundary, the centre of the largest circle that fits inside
// (polylabel, Mapbox's algorithm, after Garcia-Castellanos & Lombardo). Unlike
// the centroid it is always inside, even in a crescent or a ring.
//
// HOW BIG. The number's box (digits are about 0.56 em wide and 0.72 em tall in
// Arial) must fit in that circle, less half the outline's width, with 5% to
// spare. So the size is the circle's radius over the box's half-diagonal, held
// between the smallest and largest sizes asked for.
//
// TOO SMALL FOR THE SMALLEST. The region keeps its color (the user's choice:
// small accents such as a highlight in an eye are worth keeping) and its number
// goes OUTSIDE it, on a short LEADER line to a dot inside. The number is placed
// at the nearest spot around the region where a number of the smallest size
// has room (CLEARANCE: the distance to any boundary, from the work raster) and
// overlaps no other number; spots are tried on rings of growing radius, 16
// directions each. When no spot is found the number stays inside at the
// smallest size, and is counted as crowded.

import { ringsDist, ringsBox } from './geom.js';

const DIGIT_W = 0.56, DIGIT_H = 0.72, SPARE = 0.95;

/** Half-diagonal of a number's box at font size fs, mm. */
export const halfDiag = (digits, fs) => fs * Math.hypot((DIGIT_W * digits) / 2, DIGIT_H / 2);

/** The largest font whose box fits in a circle of radius r. */
export const fitFont = (digits, r) => (SPARE * r) / Math.hypot((DIGIT_W * digits) / 2, DIGIT_H / 2);

/**
 * The pole of inaccessibility of a region (polylabel).
 * @param {number[][]} rings     flat rings
 * @param {number} precision     stop when no cell can beat the best by more than this
 * @param {number[]} [seed]      a good first guess, [x, y] (the raster's deepest pixel)
 * @returns {{x:number, y:number, d:number}} d: distance to the boundary
 */
export function polylabel(rings, precision = 0.05, seed = null) {
  const [x0, y0, x1, y1] = ringsBox(rings);
  const w = x1 - x0, h = y1 - y0;
  const size = Math.min(w, h);
  if (!(size > 0)) return { x: x0, y: y0, d: 0 };
  const cell = (x, y, half) => {
    const d = ringsDist(x, y, rings);
    return { x, y, h: half, d, max: d + half * Math.SQRT2 };
  };
  const q = new MaxHeap();
  for (let x = x0; x < x1; x += size) for (let y = y0; y < y1; y += size) q.push(cell(x + size / 2, y + size / 2, size / 2));
  let best = cell(x0 + w / 2, y0 + h / 2, 0);
  if (seed) { const s = cell(seed[0], seed[1], 0); if (s.d > best.d) best = s; }
  let guard = 0;
  while (q.size && guard++ < 20000) {
    const c = q.pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const hh = c.h / 2;
    q.push(cell(c.x - hh, c.y - hh, hh));
    q.push(cell(c.x + hh, c.y - hh, hh));
    q.push(cell(c.x - hh, c.y + hh, hh));
    q.push(cell(c.x + hh, c.y + hh, hh));
  }
  return { x: best.x, y: best.y, d: best.d };
}

class MaxHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(c) {
    const a = this.a;
    a.push(c);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].max >= a[i].max) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].max > a[m].max) m = l;
        if (r < a.length && a[r].max > a[m].max) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/** A uniform grid of circles, for "does this number overlap one already placed". */
class CircleGrid {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  key(i, j) { return `${i},${j}`; }
  add(x, y, r) {
    const c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      for (let j = Math.floor((y - r) / c); j <= Math.floor((y + r) / c); j++) {
        const k = this.key(i, j);
        if (!this.m.has(k)) this.m.set(k, []);
        this.m.get(k).push([x, y, r]);
      }
    }
  }
  hits(x, y, r) {
    const c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      for (let j = Math.floor((y - r) / c); j <= Math.floor((y + r) / c); j++) {
        for (const [cx, cy, cr] of this.m.get(this.key(i, j)) || []) if (Math.hypot(x - cx, y - cy) < r + cr) return true;
      }
    }
    return false;
  }
}

/**
 * Numbers for every region.
 * @param {Array<{rings:number[][], num:number, seed?:number[]}>} regions  num: the color's number
 * @param {{minFont:number, maxFont:number, lineWidth:number, W:number, H:number,
 *          clearance:(x:number, y:number)=>number}} o
 *   clearance: mm from (x, y) to the nearest boundary, read off the work raster
 * @returns {Array<{x, y, size, text, leader:null|{x, y}, crowded:boolean, room:number}>}
 *   x, y: the number's centre; leader: the dot inside the region the line runs
 *   to; room: the inscribed radius found (mm)
 */
export function placeLabels(regions, o) {
  const lw = o.lineWidth / 2;
  const grid = new CircleGrid(Math.max(2, 4 * o.maxFont));
  const out = regions.map((r) => {
    const text = String(r.num);
    const pole = polylabel(r.rings, Math.max(0.02, o.minFont / 30), r.seed);
    const room = Math.max(0, pole.d - lw);
    const fit = fitFont(text.length, room);
    const size = Math.min(o.maxFont, fit);
    return { x: pole.x, y: pole.y, size, text, leader: null, crowded: false, room, small: fit < o.minFont };
  });
  // numbers that fit, first: each is inside its own region's largest circle, so none overlap
  for (const l of out) if (!l.small) grid.add(l.x, l.y, halfDiag(l.text.length, l.size));
  // then the leaders, biggest region first (the order only matters where spots compete)
  const order = out.map((l, i) => i).filter((i) => out[i].small).sort((a, b) => out[b].room - out[a].room || a - b);
  const DIRS = 16;
  for (const i of order) {
    const l = out[i];
    const fs = o.minFont, r = halfDiag(l.text.length, fs);
    const need = r + lw + 0.1 * fs;
    let found = null;
    const start = Math.max(l.room, 0) + r + lw;
    for (let rho = start; rho <= start + 14 * r && !found; rho += 0.5 * r) {
      for (let k = 0; k < DIRS && !found; k++) {
        // up-right first, then round both ways from it
        const step = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
        const ang = -Math.PI / 4 + (step * 2 * Math.PI) / DIRS;
        const x = l.x + rho * Math.cos(ang), y = l.y + rho * Math.sin(ang);
        if (x - r < 0 || y - r < 0 || x + r > o.W || y + r > o.H) continue;
        if (o.clearance(x, y) < need) continue;
        if (grid.hits(x, y, r + 0.15 * fs)) continue;
        found = [x, y];
      }
    }
    l.size = fs;
    if (found) {
      l.leader = { x: l.x, y: l.y };
      l.x = found[0]; l.y = found[1];
    } else {
      l.crowded = true;
    }
    grid.add(l.x, l.y, r);
  }
  return out;
}
