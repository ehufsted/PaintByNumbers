// Shared harness machinery: output accumulation, pass/fail lines, fixtures.
//
// NOTHING HERE TOUCHES THE DOM. tests/report.js paints the accumulated HTML in a
// browser; run-tests.mjs strips it to text under node/deno. Same test modules both
// ways. (Copied from Photo2Mosaic's, with this app's fixtures.)

import { mulberry32 } from '../src/shim/random.js';
import { inRings } from '../src/core/geom.js';

const html = [];
export const say = (s) => html.push(s);
export const getHtml = () => html.join('\n');
export const reset = () => { html.length = 0; };

export const num = (v, dp = 3) => (isFinite(v) ? v.toFixed(dp) : String(v));

const tally = { pass: 0, fail: 0 };
export const getTally = () => ({ ...tally });

/** One checked claim. `detail` is the measurement, so a failure says by how much. */
export function check(label, ok, detail = '') {
  if (ok) tally.pass++; else tally.fail++;
  say(`<p><span class="${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : 'FAIL'}</span> ${label}` +
      (detail ? ` <span class="note">— ${detail}</span>` : '') + '</p>');
  return ok;
}

export const section = (title, blurb = '') => {
  say(`<h2>${title}</h2>`);
  if (blurb) say(`<p class="note">${blurb}</p>`);
};

export const mkRand = mulberry32;

/** An RGBA fixture from fn(x, y) -> [r, g, b] in 0-255. */
export function makeRGBA(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const p = 4 * (y * w + x);
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** A label map from fn(x, y) -> integer. */
export function makeLabels(w, h, fn, Type = Uint16Array) {
  const out = new Type(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = fn(x, y);
  return out;
}

/** Seeded blobs of K colors: a Voronoi of random sites, with per-pixel noise flips. */
export function blobLabels(w, h, K, sites, noise, seed) {
  const rand = mulberry32(seed);
  const S = Array.from({ length: sites }, () => [rand() * w, rand() * h, Math.floor(rand() * K)]);
  return makeLabels(w, h, (x, y) => {
    if (rand() < noise) return Math.floor(rand() * K);
    let best = 0, bd = Infinity;
    S.forEach(([sx, sy], i) => { const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = i; } });
    return S[best][2];
  });
}

/**
 * How many of `pts` lie in exactly one region, in none, and in more than one:
 * the harness's independent check that regions tile the canvas.
 */
export function coverage(regions, pts) {
  let one = 0, none = 0, many = 0;
  for (const [x, y] of pts) {
    let k = 0;
    for (const r of regions) {
      const b = r.bbox;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (inRings(x, y, r.rings)) k++;
    }
    if (k === 1) one++; else if (k === 0) none++; else many++;
  }
  return { one, none, many };
}

/** n seeded random points in [0, W] × [0, H]. */
export function randomPoints(n, W, H, seed) {
  const rand = mulberry32(seed);
  return Array.from({ length: n }, () => [rand() * W, rand() * H]);
}
