// The whole chain, DOM-free: pixels + settings -> a paint-by-numbers plan.
// worker.js wraps it; the harness calls it directly.
//
//   A  tone -> canvas geometry -> the work raster -> the Style chain
//   B  the palette -> the method's regions (colors, clean-up, detail limits)
//   C  the planar map -> smoothed shared boundaries -> each region's rings, mm
//   D  the numbers: where, how big, and leaders
//
// STAGES ARE CACHED (when a cache object is passed, as the worker does): each
// remembers the settings it was made from, and only a stage whose settings, or
// an earlier stage's, changed runs again. Moving the number sizes re-runs only
// D, the edge smoothing C and D, the palette B to D.
//
// THE PLAN is what everything downstream reads (preview, pattern, printout,
// SVG): geometry in mm and palette numbers, no pixels, so it draws the same at
// any scale.
//
//   { piece: {W, H}, imageRect, grid: {w, h, sx, sy},
//     palette: [{num, hex, name, area, regions, used}]   in number order
//     regions: [{c, rings, area, bbox, nbrs, fill, dE, label}]
//              c: index into palette; rings: flat [x, y, ...] mm, read even-odd;
//              label: {x, y, size, text, leader, crowded, room}
//     chains:  [{pts, a, b, closed}]   every boundary once (-1: the canvas edge)
//     stats, notes, method, autoColors }

import { DEFAULTS, PRECISION, applyTone, pieceGeometry } from './core/units.js';
import { workRaster, toOKLab } from './core/raster.js';
import { applyStyle, chainOf, defaultStyle } from './core/style.js';
import { autoPalette, numberPalette, closePairs } from './core/palette.js';
import { planarMap, smoothChains, ringPoints } from './core/planar.js';
import { boundaryMask } from './core/segment.js';
import { edt } from './core/edt.js';
import { ringsArea, ringsBox } from './core/geom.js';
import { placeLabels } from './core/labels.js';
import { byId } from './methods/index.js';

/**
 * @param {{width,height,data}} rgba
 * @param {object} settings  units.DEFAULTS
 * @param {{onProgress?:(stage:string)=>void, cache?:object, imageKey?:any, methodId?:string}} opts
 *   cache: an object the caller keeps between runs (stages are reused from it);
 *   imageKey: identifies the image, so a cache never serves another image's stage
 */
export function runPipeline(rgba, settings, opts = {}) {
  const s = { ...DEFAULTS, ...settings };
  const progress = opts.onProgress || (() => {});
  const method = byId(opts.methodId || s.methodId);
  const cache = opts.cache && opts.imageKey !== undefined ? opts.cache : {};
  validate(s);
  const stage = (name, keyObj, fn) => {
    const key = JSON.stringify(keyObj);
    const c = cache[name];
    if (c && c.key === key) return c.val;
    const val = fn();
    cache[name] = { key, val };
    return val;
  };

  // A: the work raster
  const style = s.style || defaultStyle();
  const keyA = [opts.imageKey ?? null, s.gamma, s.brightness, s.saturation, s.widthMm, s.heightMm, s.precision, chainOf(style)];
  const A = stage('A', keyA, () => {
    progress('reading the image');
    const toned = applyTone(rgba, s.gamma, s.brightness, s.saturation);
    const geo = pieceGeometry(toned, s);
    const r = workRaster(toned, geo, PRECISION[s.precision] || PRECISION.normal);
    const filtered = applyStyle(r.rgba, style, geo.W, (label) => progress(`style: ${label}`));
    return { geo, w: r.w, h: r.h, sx: r.sx, sy: r.sy, filtered, labSrc: toOKLab(r.rgba), lab: toOKLab(filtered) };
  });
  const { geo, w, h, sx, sy } = A;
  const px = Math.sqrt(sx * sy);

  // B: palette and regions
  const merge = s.paletteMode === 'custom' || !s.mergeOn ? 0 : s.mergeDE;
  const keyB = [keyA, method.id, s.paletteMode, s.autoN, merge, s.paletteMode === 'custom' ? s.colors : null, s.order, s.cleanup, s.minWidth, s.minArea];
  const B = stage('B', keyB, () => {
    progress('matching colors');
    const colors = s.paletteMode === 'custom' ? s.colors.map((c) => ({ hex: c.hex, name: c.name || '' })) : autoPalette(A.filtered, s.autoN, 1, merge);
    const pal = numberPalette(colors, s.paletteMode === 'custom' ? s.order : 'light');
    progress('finding regions');
    const seg = method.segment({ lab: A.lab, w, h, pal: pal.map((p) => p.lab), px, s });
    return { colors, pal, seg };
  });
  const { pal, seg } = B;

  // C: shapes
  const sigmaCap = 0.25 * (s.minWidth / px);
  const sigma = Math.min(s.edgeSmooth / px, sigmaCap);
  const keyC = [keyB, sigma];
  const C = stage('C', keyC, () => {
    progress('tracing boundaries');
    const pm = planarMap(seg.region, w, h);
    const sm = smoothChains(pm.chains, sigma, 0.2);
    const toMm = (p) => { const o = new Array(p.length); for (let i = 0; i < p.length; i += 2) { o[i] = r3(p[i] * sx); o[i + 1] = r3(p[i + 1] * sy); } return o; };
    const chains = pm.chains.map((c, i) => ({ pts: toMm(sm[i]), a: c.a, b: c.b, closed: c.closed }));
    const n = seg.count;
    // per region: its color, pixel count, ΔE against the image, deepest pixel
    const color = new Int32Array(n), cnt = new Float64Array(n), dEsum = new Float64Array(n);
    const dB = edt(boundaryMask(seg.region, w, h), w, h);
    const deep = new Float64Array(n).fill(-1), deepAt = new Int32Array(n);
    const palLab = pal.map((p) => p.lab);
    let dEall = 0;
    for (let i = 0; i < w * h; i++) {
      const r = seg.region[i];
      color[r] = seg.colors[i];
      cnt[r]++;
      const p = palLab[seg.colors[i]];
      const dE = 100 * Math.hypot(A.labSrc[3 * i] - p[0], A.labSrc[3 * i + 1] - p[1], A.labSrc[3 * i + 2] - p[2]);
      dEsum[r] += dE; dEall += dE;
      if (dB[i] > deep[r]) { deep[r] = dB[i]; deepAt[r] = i; }
    }
    const nbrs = Array.from({ length: n }, () => new Set());
    for (const c of pm.chains) if (c.a >= 0 && c.b >= 0) { nbrs[c.a].add(c.b); nbrs[c.b].add(c.a); }
    const regions = pm.rings.map((rs, r) => {
      const rings = rs.map((ring) => toMm(ringPoints(ring, sm, pm.chains)));
      return {
        c: color[r], rings, area: r3(ringsArea(rings)), bbox: ringsBox(rings).map(r3),
        nbrs: [...nbrs[r]].sort((a, b) => a - b), fill: method.fill(r), dE: r3(dEsum[r] / cnt[r]),
        seed: [((deepAt[r] % w) + 0.5) * sx, (Math.floor(deepAt[r] / w) + 0.5) * sy],
      };
    });
    return { chains, regions, dB, meanDE: dEall / (w * h) };
  });

  // D: numbers
  const keyD = [keyC, s.fontSize, s.lineWidth];
  const D = stage('D', keyD, () => {
    progress('placing numbers');
    const clearance = (x, y) => {
      const gx = Math.min(w - 1, Math.max(0, Math.floor(x / sx))), gy = Math.min(h - 1, Math.max(0, Math.floor(y / sy)));
      return (C.dB[gy * w + gx] + 0.5) * px;
    };
    return placeLabels(C.regions.map((r) => ({ rings: r.rings, num: pal[r.c].num, seed: r.seed })), {
      fontSize: s.fontSize, lineWidth: s.lineWidth, W: geo.W, H: geo.H, clearance,
    });
  });

  progress('assembling');
  const regions = C.regions.map((r, i) => {
    const l = D[i];
    const { seed, ...rest } = r;
    return { ...rest, label: { ...l, x: r3(l.x), y: r3(l.y), size: r3(l.size), room: r3(l.room), leader: l.leader && { x: r3(l.leader.x), y: r3(l.leader.y) } } };
  });
  const palette = pal.map((p) => ({ num: p.num, hex: p.hex, name: p.name, area: 0, regions: 0, used: false }));
  for (const r of regions) { const p = palette[r.c]; p.area += r.area; p.regions++; p.used = true; }
  for (const p of palette) p.area = r3(p.area);

  const notes = [];
  const close = closePairs(pal);
  for (const { a, b, dE } of close) notes.push(`colors ${pal[a].num} and ${pal[b].num} are only ΔE ${dE.toFixed(1)} apart: hard to tell apart as paints`);
  const unused = palette.filter((p) => !p.used);
  if (unused.length) notes.push(`${unused.length === 1 ? 'color' : 'colors'} ${unused.map((p) => p.num).join(', ')} ${unused.length === 1 ? 'is' : 'are'} not used`);
  const leaders = regions.filter((r) => r.label.leader).length;
  const crowded = regions.filter((r) => r.label.crowded).length;
  if (leaders) notes.push(`${leaders} ${leaders === 1 ? 'region is' : 'regions are'} too small for a number, and ${leaders === 1 ? 'has its number' : 'have theirs'} outside on a leader line`);
  if (crowded) notes.push(`${crowded} ${crowded === 1 ? 'number' : 'numbers'} found no room outside either and sit inside their regions (the Problems view shows where)`);
  if (merge > 0 && B.colors.length < s.autoN) notes.push(`${B.colors.length} colors of the ${s.autoN} asked for: the image has no more that are ${merge} ΔE apart`);
  if (s.edgeSmooth / px > sigmaCap + 1e-9) notes.push('edge smoothing held to a quarter of the narrowest region, so neighbouring boundaries cannot cross');

  return {
    method: method.id,
    piece: { W: geo.W, H: geo.H },
    imageRect: geo.imageRect,
    grid: { w, h, sx, sy },
    palette,
    regions,
    chains: C.chains,
    notes,
    autoColors: s.paletteMode === 'custom' ? null : B.colors,
    stats: {
      regions: regions.length,
      colors: palette.filter((p) => p.used).length,
      meanDE: C.meanDE,
      leaders,
      crowded,
      thin: seg.thin,
      merged: seg.merged,
      smallest: regions.reduce((m, r) => Math.min(m, r.area), Infinity),
    },
  };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

function validate(s) {
  if (!(s.widthMm > 0)) throw new Error('the canvas needs a width');
  if (!(s.heightMm >= 0)) throw new Error('height must be 0 (from the image) or more');
  if (s.paletteMode === 'custom' && !(s.colors && s.colors.length)) throw new Error('the palette has no colors');
  if (s.paletteMode !== 'custom' && !(s.autoN >= 1)) throw new Error('ask for at least one color');
  if (!(s.minWidth >= 0) || !(s.minArea >= 0)) throw new Error('detail limits cannot be negative');
  if (!(s.fontSize > 0)) throw new Error('the numbers need a size');
}
