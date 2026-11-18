// The palette: N colors from the image, how they are numbered, and which pairs
// are too alike to tell apart in a paint pot.
//
// FROM THE IMAGE: k-means in OKLab, copied from Photo2Mosaic's core/palette.js
// (itself HalftoneCuttable's kmeansPoints): seeded k-means++ on a fixed budget
// of sampled pixels, 25 Lloyd iterations, so the same image always gives the
// same palette. It runs on the work raster AFTER the pre-filter, so it clusters
// the colors the regions will actually be matched from.
//
// NUMBERING. Paint-by-numbers is painted light to dark (a dark paint covers a
// light slip, not the other way), so by default the lightest color is 1 and the
// numbers rise with darkness, by OKLab lightness. 'list' keeps the order a person
// gave, for a kit whose pots are already numbered.

import { mulberry32 } from '../shim/random.js';
import { LINEAR_LUT, rgbToOKLab, oklabToRgb, linearToHex, hexToLinear, deltaE } from './color.js';

/** ΔE below which two palette colors are flagged as hard to tell apart. */
export const CLOSE_DE = 3;

/**
 * Seeded k-means++ over sampled pixels, in the point space `toPoint` maps a
 * linear pixel into (copied verbatim from Photo2Mosaic). Empty clusters are
 * dropped.
 * @returns {{centers:number[][], mass:number[]}}
 */
export function kmeansPoints(rgba, n, seed, toPoint, budget = 20000) {
  const total = rgba.width * rgba.height;
  const stride = Math.max(1, Math.floor(total / budget));
  const pts = [];
  for (let i = 0; i < total; i += stride) {
    const q = 4 * i;
    pts.push(toPoint(LINEAR_LUT[rgba.data[q]], LINEAR_LUT[rgba.data[q + 1]], LINEAR_LUT[rgba.data[q + 2]]));
  }
  const N = pts.length, D = pts[0].length;
  const rand = mulberry32(seed);
  const d2 = (a, b) => { let s = 0; for (let d = 0; d < D; d++) s += (a[d] - b[d]) ** 2; return s; };

  // k-means++ seeding (stops early when every point is already a centre)
  const centers = [pts[Math.floor(rand() * N)].slice()];
  const dist = new Float64Array(N).fill(Infinity);
  while (centers.length < n) {
    const c = centers[centers.length - 1];
    let sum = 0;
    for (let i = 0; i < N; i++) { dist[i] = Math.min(dist[i], d2(pts[i], c)); sum += dist[i]; }
    if (!(sum > 0)) break;
    let t = rand() * sum, pick = N - 1;
    for (let i = 0; i < N; i++) { t -= dist[i]; if (t <= 0) { pick = i; break; } }
    centers.push(pts[pick].slice());
  }

  const K = centers.length;
  const mass = new Float64Array(K);
  for (let it = 0; it < 25; it++) {
    const acc = centers.map(() => new Array(D).fill(0));
    mass.fill(0);
    for (let i = 0; i < N; i++) {
      let bi = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const dd = d2(pts[i], centers[k]); if (dd < bd) { bd = dd; bi = k; } }
      mass[bi]++;
      for (let d = 0; d < D; d++) acc[bi][d] += pts[i][d];
    }
    for (let k = 0; k < K; k++) if (mass[k] > 0) centers[k] = acc[k].map((v) => v / mass[k]);
  }
  const keep = [...centers.keys()].filter((k) => mass[k] > 0);
  return { centers: keep.map((k) => centers[k]), mass: keep.map((k) => mass[k] / N) };
}

/**
 * Clusters closer than `dE` merged, closest pair first, each pair into its
 * mass-weighted mean (in OKLab), until every two are at least dE apart.
 */
export function mergeClusters({ centers, mass }, dE) {
  const C = centers.map((c) => c.slice()), M = mass.slice();
  for (;;) {
    let bi = -1, bj = -1, bd = dE;
    for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) {
      const d = deltaE(C[i], C[j]);
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    if (bi < 0) break;
    const m = M[bi] + M[bj];
    C[bi] = C[bi].map((v, d) => (v * M[bi] + C[bj][d] * M[bj]) / m);
    M[bi] = m;
    C.splice(bj, 1); M.splice(bj, 1);
  }
  return { centers: C, mass: M };
}

/**
 * N colors from the image, largest share first. Two clusters that land on the
 * same hex (a flat image asked for many colors) come back as one.
 *
 * MERGING (mergeDE > 0). k-means spends clusters where the image has the most
 * pixels, so a dark painting gets several near-blacks no one could tell apart in
 * a pot. Clusters closer than mergeDE are merged, and the freed slots are
 * filled: k-means is run again with more clusters (N, N + 1, ...) until merging
 * leaves N, or as near N as it gets without going over (up to 3N clusters).
 * Fewer than N come back only when the image has no more colors that far apart.
 * @param {{width, height, data}} rgba  encoded pixels
 * @returns {Array<{hex:string, name:string, share:number}>}
 */
export function autoPalette(rgba, n, seed = 1, mergeDE = 0) {
  const N = Math.max(1, Math.round(n));
  const run = (k) => kmeansPoints(rgba, k, seed, (r, g, b) => rgbToOKLab(r, g, b));
  let got = run(N);
  if (mergeDE > 0) {
    let best = mergeClusters(got, mergeDE);
    for (let k = N + 1; best.centers.length < N && k <= 3 * N; k++) {
      const raw = run(k);
      // fewer clusters than asked: k-means emptied one (by chance) or the image has
      // no more distinct colors; either way this k cannot fill a slot, but a
      // larger k still may
      if (raw.centers.length < k) continue;
      const m = mergeClusters(raw, mergeDE);
      if (m.centers.length > N) break;
      if (m.centers.length >= best.centers.length) best = m;
    }
    got = best;
  }
  const { centers, mass } = got;
  const byHex = new Map();
  centers.forEach((c, k) => {
    const hex = linearToHex(oklabToRgb(c).map((v) => Math.max(0, Math.min(1, v))));
    byHex.set(hex, (byHex.get(hex) || 0) + mass[k]);
  });
  return [...byHex].map(([hex, share]) => ({ hex, name: '', share })).sort((a, b) => b.share - a.share);
}

/** OKLab of a '#rrggbb'. */
export const hexLab = (hex) => rgbToOKLab(...hexToLinear(hex));

/**
 * The palette in number order: [{num, hex, name, lab, from}], `from` its index
 * in `colors`. 'light' sorts by OKLab lightness, lightest first (ties keep the
 * list order); 'list' keeps the list.
 */
export function numberPalette(colors, order = 'light') {
  const out = colors.map((c, i) => ({ hex: c.hex, name: c.name || '', lab: hexLab(c.hex), from: i }));
  if (order !== 'list') out.sort((a, b) => b.lab[0] - a.lab[0] || a.from - b.from);
  out.forEach((c, i) => { c.num = i + 1; });
  return out;
}

/** Pairs of palette entries closer than `limit` ΔE: [{a, b, dE}] (indices into `pal`). */
export function closePairs(pal, limit = CLOSE_DE) {
  const out = [];
  for (let a = 0; a < pal.length; a++) {
    for (let b = a + 1; b < pal.length; b++) {
      const dE = deltaE(pal[a].lab, pal[b].lab);
      if (dE < limit) out.push({ a, b, dE });
    }
  }
  return out;
}
