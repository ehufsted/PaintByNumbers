// The detail limits: from a color map to regions a person can paint and number.
//
// Two limits, both lengths on the canvas:
//
//   minimum WIDTH  no region, and no PART of a region, narrower than this. A
//                  sliver passes any area limit (a long thin line has plenty of
//                  area) but cannot be painted or hold a number.
//   minimum AREA   no region smaller than this.
//
// WIDTH, BY CORES. A pixel is CORE when a disc of radius r = width / 2 around it
// stays inside its own color: its distance to the nearest boundary pixel (one
// with a differently colored 4-neighbour), plus the half pixel from that pixel's
// centre to the boundary itself, is at least r. Every pixel then takes the color
// of its NEAREST core pixel (edtNearest, core/edt.js). Inside a wide region that
// is its own color; a sliver has no core of its own, so it is shared out to the
// regions on either side, split down the middle. That is a morphological opening
// whose leftovers go to the neighbours instead of to nobody, and it rounds
// corners to radius r, which is right: a corner sharper than the brush is not
// painted anyway.
//
// AREA, BY MERGING. The colored map is split into 4-connected regions; any
// smaller than the limit is merged into the neighbour whose color is nearest
// its own pixels' mean color (ties to the longer shared border), smallest
// first. A merged region keeps its neighbour's color, and grows, so merging
// never makes a region smaller or narrower.
//
// The result is relabelled once more at the end: a merge can bring two regions
// of one color into contact, and they are one region.

import { edt, edtNearest } from './edt.js';
import { deltaE } from './color.js';

/**
 * 4-connected regions of equal value.
 * @returns {{id:Int32Array, count:number}}
 */
export function regionsOf(labels, w, h) {
  const id = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let s = 0; s < w * h; s++) {
    if (id[s] >= 0) continue;
    const v = labels[s], c = count++;
    let top = 0;
    stack[top++] = s; id[s] = c;
    while (top > 0) {
      const k = stack[--top];
      const x = k % w;
      if (x > 0 && id[k - 1] < 0 && labels[k - 1] === v) { id[k - 1] = c; stack[top++] = k - 1; }
      if (x < w - 1 && id[k + 1] < 0 && labels[k + 1] === v) { id[k + 1] = c; stack[top++] = k + 1; }
      if (k >= w && id[k - w] < 0 && labels[k - w] === v) { id[k - w] = c; stack[top++] = k - w; }
      if (k + w < w * h && id[k + w] < 0 && labels[k + w] === v) { id[k + w] = c; stack[top++] = k + w; }
    }
  }
  return { id, count };
}

/** Pixels with a 4-neighbour of another value (the canvas edge is not a boundary). */
export function boundaryMask(labels, w, h) {
  const B = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, v = labels[i];
      if ((x > 0 && labels[i - 1] !== v) || (x < w - 1 && labels[i + 1] !== v) ||
          (y > 0 && labels[i - w] !== v) || (y < h - 1 && labels[i + w] !== v)) B[i] = 1;
    }
  }
  return B;
}

/**
 * The width limit: every pixel takes the color of its nearest core pixel.
 * @param {number} r  half the minimum width, px
 * @returns {{labels:Uint16Array, thin:number}} thin: pixels that changed color
 */
export function enforceWidth(labels, w, h, r) {
  if (!(r > 0.5)) return { labels: Uint16Array.from(labels), thin: 0 };
  const dB = edt(boundaryMask(labels, w, h), w, h);
  const core = new Uint8Array(w * h);
  let any = 0;
  for (let i = 0; i < w * h; i++) if (dB[i] + 0.5 >= r) { core[i] = 1; any++; }
  if (!any) return { labels: Uint16Array.from(labels), thin: 0 };   // nothing is wide enough: leave it to the area limit
  const { near } = edtNearest(core, w, h);
  const out = new Uint16Array(w * h);
  let thin = 0;
  for (let i = 0; i < w * h; i++) {
    out[i] = labels[near[i]];
    if (out[i] !== labels[i]) thin++;
  }
  return { labels: out, thin };
}

/**
 * The area limit: regions under minArea px merged into their best neighbour.
 * @param {Float32Array} lab  OKLab per pixel (what a region's own color is measured on)
 * @param {number[][]} pal    OKLab per palette entry
 * @returns {{labels:Uint16Array, merged:number}}
 */
export function enforceArea(labels, w, h, lab, pal, minArea) {
  const { id, count } = regionsOf(labels, w, h);
  if (!(minArea > 1) || count < 2) return { labels: Uint16Array.from(labels), merged: 0 };
  const size = new Float64Array(count), color = new Int32Array(count);
  const mean = new Float64Array(3 * count);
  for (let i = 0; i < w * h; i++) {
    const c = id[i];
    size[c]++; color[c] = labels[i];
    mean[3 * c] += lab[3 * i]; mean[3 * c + 1] += lab[3 * i + 1]; mean[3 * c + 2] += lab[3 * i + 2];
  }
  for (let c = 0; c < count; c++) for (let d = 0; d < 3; d++) mean[3 * c + d] /= size[c];
  // shared border lengths
  const nb = Array.from({ length: count }, () => new Map());
  const link = (a, b) => {
    nb[a].set(b, (nb[a].get(b) || 0) + 1);
    nb[b].set(a, (nb[b].get(a) || 0) + 1);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < w - 1 && id[i + 1] !== id[i]) link(id[i], id[i + 1]);
      if (y < h - 1 && id[i + w] !== id[i]) link(id[i], id[i + w]);
    }
  }
  // smallest first; stale heap entries are skipped
  const parent = new Int32Array(count).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const heap = new MinHeap();
  for (let c = 0; c < count; c++) if (size[c] < minArea) heap.push(size[c], c);
  let merged = 0;
  while (heap.size) {
    const [s, a] = heap.pop();
    if (find(a) !== a || s !== size[a] || size[a] >= minArea) continue;
    let best = -1, bd = Infinity, bl = -1;
    const ma = [mean[3 * a], mean[3 * a + 1], mean[3 * a + 2]];
    for (const [b, len] of nb[a]) {
      const dE = deltaE(ma, pal[color[b]]);
      if (dE < bd - 1e-9 || (Math.abs(dE - bd) <= 1e-9 && (len > bl || (len === bl && b < best)))) { best = b; bd = dE; bl = len; }
    }
    if (best < 0) continue;   // the only region there is
    // a into best: best keeps its color
    parent[a] = best;
    const sb = size[best], sa = size[a], st = sb + sa;
    for (let d = 0; d < 3; d++) mean[3 * best + d] = (mean[3 * best + d] * sb + ma[d] * sa) / st;
    size[best] = st;
    for (const [c, len] of nb[a]) {
      if (c === best) continue;
      nb[c].delete(a);
      nb[c].set(best, (nb[c].get(best) || 0) + len);
      nb[best].set(c, (nb[best].get(c) || 0) + len);
    }
    nb[best].delete(a);
    nb[a] = new Map();
    merged++;
    if (st < minArea) heap.push(st, best);
  }
  const out = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = color[find(id[i])];
  return { labels: out, merged };
}

/** A binary min-heap of [key, value], ties broken by value (so the order is deterministic). */
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  less(i, j) { return this.k[i] < this.k[j] || (this.k[i] === this.k[j] && this.v[i] < this.v[j]); }
  swap(i, j) { [this.k[i], this.k[j]] = [this.k[j], this.k[i]]; [this.v[i], this.v[j]] = [this.v[j], this.v[i]]; }
  push(key, val) {
    this.k.push(key); this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.swap(i, p); i = p; }
  }
  pop() {
    const out = [this.k[0], this.v[0]];
    const lk = this.k.pop(), lv = this.v.pop();
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.less(l, m)) m = l;
        if (r < this.k.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return out;
  }
}

/**
 * Both limits, then the final regions.
 * @param {{minWidthPx:number, minAreaPx:number}} o
 * @returns {{colors:Uint16Array, region:Int32Array, count:number, thin:number, merged:number}}
 *   colors: palette index per pixel; region: region id per pixel
 */
export function segment(labels, w, h, lab, pal, o) {
  const a = enforceWidth(labels, w, h, o.minWidthPx / 2);
  const b = enforceArea(a.labels, w, h, lab, pal, o.minAreaPx);
  const { id, count } = regionsOf(b.labels, w, h);
  return { colors: b.labels, region: id, count, thin: a.thin, merged: b.merged };
}
