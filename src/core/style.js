// Style filters: the image restyled BEFORE its colors are matched.
//
// A CHAIN, as HalftoneCuttable's Style section: the pipeline applies the enabled
// filters, in the order given, to the work raster (core/raster.js) and hands
// the result to the method. An empty chain passes the raster through untouched
// (the very same object). Each filter is a registry entry: {id, label, blurb,
// params, apply(rgba, p, widthMm)}, with params in the methods' format, so the
// app builds its controls the same way. Lengths are millimeters on the canvas,
// converted with the canvas width, so a filter does the same thing at any
// precision.
//
// settings.style is {order: [ids], on: {id: bool}, params: {id: {...}}}; the
// order of FILTERS is the default order of the chain.
//
//   MEDIAN      each channel's median over a square window: removes speckle,
//               scratches and JPEG noise while keeping edges sharp (a mean would
//               blur them). Huang's sliding histogram, so the cost per pixel
//               grows with the window's side, not its area.
//   BLUR        a plain Gaussian, each channel (copied from HalftoneCuttable).
//   CLAHE       contrast-limited adaptive histogram equalization, on luminance,
//               keeping hue (copied from HalftoneCuttable, whose header there
//               explains it): flat or washed-out areas get distinct tones, so
//               they get distinct colors.
//   SHARPEN     unsharp mask, out = in + amount·(in − blur(in)): edges get
//               steeper, so the region boundaries settle on them.
//   PAINTERLY   the anisotropic Kuwahara filter (core/kuwahara.js): texture
//               flattened into brush-like patches with crisp edges. The default,
//               and the filter that most helps a paint-by-numbers: fewer, larger
//               regions that follow the forms.

import { makeImage } from '../shim/image.js';
import { blur } from './features.js';
import { kuwahara } from './kuwahara.js';
import { luminance } from './color.js';

const medianFilter = {
  id: 'median',
  label: 'Median (despeckle)',
  blurb: 'Removes speckle, scratches and JPEG noise while keeping edges sharp.',
  params: [{ key: 'radius', label: 'Radius', type: 'range', min: 0.1, max: 3, step: 0.1, def: 0.5, unit: 'mm', dp: 1 }],
  apply: medianStyle,
};

const blurFilter = {
  id: 'blur',
  label: 'Blur (Gaussian)',
  blurb: 'Softens the image with a plain Gaussian blur: fine grain becomes an even gradient.',
  params: [{ key: 'radius', label: 'Blur radius', type: 'range', min: 0, max: 10, step: 0.1, def: 1, unit: 'mm', dp: 1 }],
  apply: blurStyle,
};

const claheFilter = {
  id: 'clahe',
  label: 'Local contrast (CLAHE)',
  blurb: 'Equalizes contrast within local tiles, so flat or washed-out areas get distinct tones (and so distinct colors). Contrast limit caps how far a tile is stretched, so a flat or grainy one is not blown into noise.',
  params: [
    { key: 'tileSize', label: 'Tile size', type: 'range', min: 5, max: 100, step: 1, def: 40, unit: 'mm' },
    { key: 'clipLimit', label: 'Contrast limit', type: 'range', min: 1, max: 8, step: 0.5, def: 2, dp: 1 },
  ],
  apply: claheStyle,
};

const sharpenFilter = {
  id: 'sharpen',
  label: 'Sharpen',
  blurb: 'An unsharp mask: steeper edges, so the region boundaries settle on them.',
  params: [
    { key: 'radius', label: 'Radius', type: 'range', min: 0.2, max: 5, step: 0.1, def: 1, unit: 'mm', dp: 1 },
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 3, step: 0.1, def: 1, dp: 1 },
  ],
  apply: sharpenStyle,
};

const kuwaharaFilter = {
  id: 'kuwahara',
  label: 'Painterly (Kuwahara)',
  blurb: 'Flattens texture into even, brush-like patches with crisp edges, stretched along the forms: fewer, larger regions that follow the image.',
  params: [
    { key: 'size', label: 'Brush size', type: 'range', min: 0.5, max: 10, step: 0.1, def: 1.5, unit: 'mm', dp: 1 },
    { key: 'anisotropy', label: 'Anisotropy', type: 'range', min: 0, max: 3, step: 0.1, def: 1, dp: 1 },
    { key: 'sharpness', label: 'Sharpness', type: 'range', min: 2, max: 16, step: 1, def: 8 },
  ],
  apply: kuwahara,
};

/** The filters, in their default chain order. */
export const FILTERS = [medianFilter, blurFilter, claheFilter, sharpenFilter, kuwaharaFilter];
export const filterById = (id) => FILTERS.find((f) => f.id === id);
export const defaultsOf = (f) => Object.fromEntries(f.params.map((p) => [p.key, p.def]));

/** The default style: every filter in its order, only Painterly on. */
export const defaultStyle = () => ({
  order: FILTERS.map((f) => f.id),
  on: Object.fromEntries(FILTERS.map((f) => [f.id, f.id === 'kuwahara'])),
  params: Object.fromEntries(FILTERS.map((f) => [f.id, defaultsOf(f)])),
});

/**
 * A style made safe: known filters only, every one present once, params
 * checked against their ranges (defaults where missing or out of range).
 * @returns {{style, problems:string[]}}
 */
export function normalizeStyle(src) {
  const out = defaultStyle(), problems = [];
  if (!src || typeof src !== 'object') return { style: out, problems };
  if (Array.isArray(src.order)) {
    const seen = src.order.filter((id, i) => filterById(id) && src.order.indexOf(id) === i);
    out.order = [...seen, ...out.order.filter((id) => !seen.includes(id))];
  }
  for (const f of FILTERS) {
    if (src.on && typeof src.on[f.id] === 'boolean') out.on[f.id] = src.on[f.id];
    const p = (src.params || {})[f.id] || {};
    for (const d of f.params) {
      if (p[d.key] === undefined) continue;
      const ok = d.type === 'range' ? isFinite(Number(p[d.key])) && Number(p[d.key]) >= d.min && Number(p[d.key]) <= d.max
        : d.type === 'checkbox' ? typeof p[d.key] === 'boolean' : d.options.some(([v]) => v === p[d.key]);
      if (ok) out.params[f.id][d.key] = d.type === 'range' ? Number(p[d.key]) : p[d.key];
      else problems.push(`${f.label}, ${d.label}: unusable, using ${d.def}`);
    }
  }
  return { style: out, problems };
}

/** The enabled filters in order, as [{id, ...params}]: what a run depends on. */
export const chainOf = (style) => (style ? style.order.filter((id) => style.on[id] && filterById(id)).map((id) => ({ id, ...style.params[id] })) : []);

/**
 * @param {{width, height, data}} rgba
 * @param {object} style      settings.style
 * @param {number} widthMm    the canvas width the image spans
 * @returns the styled pixels, or `rgba` itself when the chain is empty
 */
export function applyStyle(rgba, style, widthMm, onStep = () => {}) {
  let out = rgba;
  for (const st of chainOf(style)) {
    const f = filterById(st.id);
    onStep(f.label);
    out = f.apply(out, st, widthMm);
  }
  return out;
}

/** The three channels as float planes, and back. */
function planes(rgba) {
  const { width: w, height: h, data } = rgba;
  const P = [0, 1, 2].map(() => makeImage(w, h));
  for (let i = 0, q = 0; i < w * h; i++, q += 4) { P[0].data[i] = data[q]; P[1].data[i] = data[q + 1]; P[2].data[i] = data[q + 2]; }
  return P;
}
function fromPlanes(P, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, q = 0; i < w * h; i++, q += 4) { out[q] = P[0][i]; out[q + 1] = P[1][i]; out[q + 2] = P[2][i]; out[q + 3] = 255; }
  return { width: w, height: h, data: out };
}

function blurStyle(rgba, st, widthMm) {
  const { width: w, height: h } = rgba;
  const sigma = st.radius * (w / widthMm);
  if (!(sigma > 0.3)) return rgba;   // matches blur()'s own no-op threshold
  return fromPlanes(planes(rgba).map((pl) => blur(pl, sigma).data), w, h);
}

function sharpenStyle(rgba, st, widthMm) {
  const { width: w, height: h } = rgba;
  const sigma = st.radius * (w / widthMm);
  if (!(sigma > 0.3) || !(st.amount > 0)) return rgba;
  return fromPlanes(planes(rgba).map((pl) => {
    const b = blur(pl, sigma).data, o = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) o[i] = pl.data[i] + st.amount * (pl.data[i] - b[i]);
    return o;
  }), w, h);
}

/**
 * One channel's median over a (2r+1)² window, clamped at the edges (Huang:
 * a 256-bin histogram slides along each row, and the median is walked up or
 * down from the last one as columns enter and leave).
 */
export function median8(src, w, h, r) {
  const out = new Uint8ClampedArray(w * h);
  const hist = new Int32Array(256);
  const half = ((2 * r + 1) * (2 * r + 1)) >> 1;   // the median is the value with `half` values below it
  const cx = (x) => (x < 0 ? 0 : x >= w ? w - 1 : x), cy = (y) => (y < 0 ? 0 : y >= h ? h - 1 : y);
  for (let y = 0; y < h; y++) {
    hist.fill(0);
    for (let dy = -r; dy <= r; dy++) { const row = cy(y + dy) * w; for (let dx = -r; dx <= r; dx++) hist[src[row + cx(dx)]]++; }
    let m = 0, below = 0;   // `below`: how many values are < m
    for (;;) { if (below + hist[m] > half) break; below += hist[m]; m++; }
    out[y * w] = m;
    for (let x = 1; x < w; x++) {
      const xo = cx(x - r - 1), xi = cx(x + r);
      for (let dy = -r; dy <= r; dy++) {
        const row = cy(y + dy) * w;
        const vo = src[row + xo], vi = src[row + xi];
        hist[vo]--; if (vo < m) below--;
        hist[vi]++; if (vi < m) below++;
      }
      while (below > half) { m--; below -= hist[m]; }
      while (below + hist[m] <= half) { below += hist[m]; m++; }
      out[y * w + x] = m;
    }
  }
  return out;
}

function medianStyle(rgba, st, widthMm) {
  const { width: w, height: h, data } = rgba;
  const r = Math.round(st.radius * (w / widthMm));
  if (r < 1) return rgba;
  const ch = [0, 1, 2].map((c) => {
    const a = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) a[i] = data[4 * i + c];
    return median8(a, w, h, r);
  });
  return fromPlanes(ch, w, h);
}

const CLAHE_BINS = 256;

function claheStyle(rgba, st, widthMm) {
  const { width: w, height: h, data } = rgba;
  const n = w * h;

  // luminance, as an integer 0..255 -- histogram bins need discrete values
  const Y = new Uint8Array(n);
  for (let i = 0, q = 0; i < n; i++, q += 4) {
    Y[i] = Math.round(luminance(data[q], data[q + 1], data[q + 2]));
  }

  // ---- one equalization curve per tile, contrast-limited
  const tilePx = Math.max(8, st.tileSize * (w / widthMm));
  const tx = Math.max(1, Math.round(w / tilePx)), ty = Math.max(1, Math.round(h / tilePx));
  const tw = w / tx, th = h / ty;
  const luts = new Array(tx * ty);
  for (let j = 0; j < ty; j++) {
    const y0 = Math.floor(j * th), y1 = j === ty - 1 ? h : Math.floor((j + 1) * th);
    for (let i = 0; i < tx; i++) {
      const x0 = Math.floor(i * tw), x1 = i === tx - 1 ? w : Math.floor((i + 1) * tw);
      const hist = new Float64Array(CLAHE_BINS);
      let count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { hist[Y[y * w + x]]++; count++; }
      // clip any bin taller than the limit, and spread what was clipped off evenly
      const clip = Math.max(1, (st.clipLimit * count) / CLAHE_BINS);
      let excess = 0;
      for (let b = 0; b < CLAHE_BINS; b++) if (hist[b] > clip) { excess += hist[b] - clip; hist[b] = clip; }
      const bonus = excess / CLAHE_BINS;
      const lut = new Float32Array(CLAHE_BINS);
      let acc = 0;
      for (let b = 0; b < CLAHE_BINS; b++) { acc += hist[b] + bonus; lut[b] = count > 0 ? (255 * acc) / count : b; }
      luts[j * tx + i] = lut;
    }
  }

  // ---- every pixel's curve, bilinearly interpolated from its 4 nearest tiles
  const out = new Uint8ClampedArray(n * 4);
  for (let py = 0; py < h; py++) {
    const gy = (py + 0.5) / th - 0.5;
    const gy0 = Math.floor(gy), fy = gy - gy0;
    const ty0 = Math.max(0, Math.min(ty - 1, gy0)), ty1 = Math.max(0, Math.min(ty - 1, gy0 + 1));
    for (let px = 0; px < w; px++) {
      const gx = (px + 0.5) / tw - 0.5;
      const gx0 = Math.floor(gx), fx = gx - gx0;
      const tx0 = Math.max(0, Math.min(tx - 1, gx0)), tx1 = Math.max(0, Math.min(tx - 1, gx0 + 1));
      const i = py * w + px, y = Y[i];
      const l00 = luts[ty0 * tx + tx0][y], l01 = luts[ty0 * tx + tx1][y];
      const l10 = luts[ty1 * tx + tx0][y], l11 = luts[ty1 * tx + tx1][y];
      const top = l00 + (l01 - l00) * fx, bot = l10 + (l11 - l10) * fx;
      const newY = top + (bot - top) * fy;
      const q = 4 * i;
      if (y > 0) {
        const scale = newY / y;
        out[q] = data[q] * scale; out[q + 1] = data[q + 1] * scale; out[q + 2] = data[q + 2] * scale;
      } else {
        out[q] = out[q + 1] = out[q + 2] = newY;
      }
      out[q + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}
