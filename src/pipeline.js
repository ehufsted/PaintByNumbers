// The whole chain, DOM-free: pixels + settings -> a paint-by-numbers plan.
// worker.js wraps it; the harness calls it directly.
//
//   A  tone -> canvas geometry -> the work raster -> the Style chain
//   B  the palette -> the method's regions (colors, clean-up, detail limits);
//      aiming for a number of regions, the detail limits are scaled to reach it
//   E  hand edits (core/edits.js): recolor, merge, brush, on the color map
//   G  the method's grouping, if it has one (Flat + gradients: blends)
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
import { placeLabels, halfDiag } from './core/labels.js';
import { byId, defaultsFor } from './methods/index.js';
import { gradientT } from './core/gradients.js';
import { applyEdits } from './core/edits.js';
import { regionsOf } from './core/segment.js';

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
  // the custom colors by hex only: a name changes no region, and is applied at assembly
  const keyB = [keyA, method.id, s.paletteMode, s.autoN, merge, s.paletteMode === 'custom' ? s.colors.map((c) => c.hex) : null, s.order, s.cleanup, s.minWidth, s.minArea,
    s.targetOn ? [s.target, s.edgeSmooth] : null];
  const B = stage('B', keyB, () => {
    progress('matching colors');
    const colors = s.paletteMode === 'custom' ? s.colors.map((c) => ({ hex: c.hex, name: c.name || '' })) : autoPalette(A.filtered, s.autoN, 1, merge);
    const pal = numberPalette(colors, s.paletteMode === 'custom' ? s.order : 'light');
    progress('finding regions');
    const palLab = pal.map((p) => p.lab);
    const segAt = (f) => method.segment({ lab: A.lab, w, h, pal: palLab, px, s: { ...s, ...scaledDetail(s, f) } });
    if (!s.targetOn) return { colors, pal, seg: segAt(1), f: 1, tries: 1 };
    const t = aimFor(segAt, s.target, (f, n) => progress(`aiming for ${s.target} regions: ${n} at ×${f.toFixed(2)}`));
    return { colors, pal, seg: t.seg, f: t.f, tries: t.tries };
  });
  const { pal } = B;

  // E: hand edits, after the detail limits (an edit is deliberate) and before tracing
  const edits = s.edits || [];
  const keyE = [keyB, edits];
  const E = stage('E', keyE, () => {
    if (!edits.length) return { ...B.seg, edits: 0 };
    progress('applying edits');
    const ed = applyEdits(B.seg.colors, { w, h, sx, sy }, pal, edits);
    const { id, count } = regionsOf(ed.colors, w, h);
    return { ...B.seg, colors: ed.colors, region: id, count, edits: ed.applied };
  });
  const detail = { f: B.f, tries: B.tries, ...scaledDetail(s, B.f) };

  // G: the method's grouping (gradient regions), on the edited map
  const mParams = { ...defaultsFor(method), ...((s.methodParams || {})[method.id] || {}) };
  // a blend's halves need room for a two-digit number and half the line
  const roomPx = (halfDiag(2, s.fontSize) + s.lineWidth / 2) / px;
  const keyG = [keyE, method.id, method.group ? [mParams, roomPx] : null];
  const G = stage('G', keyG, () => {
    if (!method.group) return { region: E.region, count: E.count, fills: null, gradients: 0 };
    progress('finding blends');
    return method.group({ colors: E.colors, region: E.region, count: E.count, lab: A.lab, pal: pal.map((p) => p.lab),
      w, h, sx, sy, params: mParams, minAreaPx: detail.minArea / (px * px), roomPx });
  });
  const seg = { ...E, region: G.region, count: G.count };

  // C: shapes
  const sigmaCap = 0.25 * (detail.minWidth / px);
  const sigma = Math.min(detail.edgeSmooth / px, sigmaCap);
  const keyC = [keyG, sigma];
  const C = stage('C', keyC, () => {
    progress('tracing boundaries');
    const pm = planarMap(seg.region, w, h);
    const sm = smoothChains(pm.chains, sigma, 0.2);
    const toMm = (p) => { const o = new Array(p.length); for (let i = 0; i < p.length; i += 2) { o[i] = r3(p[i] * sx); o[i + 1] = r3(p[i + 1] * sy); } return o; };
    const chains = pm.chains.map((c, i) => ({ pts: toMm(sm[i]), a: c.a, b: c.b, closed: c.closed }));
    const n = seg.count;
    // per region: its color, pixel count, ΔE against the image, deepest pixel
    // (a gradient region: the deepest in each half, t below and above 0.5, where
    // its two numbers go; its ΔE is against the blend at each pixel)
    const color = new Int32Array(n), cnt = new Float64Array(n), dEsum = new Float64Array(n);
    const dB = edt(boundaryMask(seg.region, w, h), w, h);
    const deep = new Float64Array(n).fill(-1), deepAt = new Int32Array(n);
    const deep2 = new Float64Array(n).fill(-1), deepAt2 = new Int32Array(n);
    const palLab = pal.map((p) => p.lab);
    const fills = G.fills;
    let dEall = 0;
    for (let i = 0; i < w * h; i++) {
      const r = seg.region[i];
      const f = fills && fills[r];
      color[r] = f ? (f.type === 'solid' ? f.c : f.c0) : seg.colors[i];
      cnt[r]++;
      let p = palLab[seg.colors[i]], half = 0;
      if (f && f.type === 'gradient') {
        const t = gradientT(f, ((i % w) + 0.5) * sx, (Math.floor(i / w) + 0.5) * sy);
        const a = palLab[f.c0], b = palLab[f.c1];
        p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
        half = t >= 0.5 ? 1 : 0;
      }
      const dE = 100 * Math.hypot(A.labSrc[3 * i] - p[0], A.labSrc[3 * i + 1] - p[1], A.labSrc[3 * i + 2] - p[2]);
      dEsum[r] += dE; dEall += dE;
      if (half) { if (dB[i] > deep2[r]) { deep2[r] = dB[i]; deepAt2[r] = i; } } else if (dB[i] > deep[r]) { deep[r] = dB[i]; deepAt[r] = i; }
    }
    const at = (i) => [((i % w) + 0.5) * sx, (Math.floor(i / w) + 0.5) * sy];
    const nbrs = Array.from({ length: n }, () => new Set());
    for (const c of pm.chains) if (c.a >= 0 && c.b >= 0) { nbrs[c.a].add(c.b); nbrs[c.b].add(c.a); }
    const regions = pm.rings.map((rs, r) => {
      const rings = rs.map((ring) => toMm(ringPoints(ring, sm, pm.chains)));
      const f = fills && fills[r];
      const grad = f && f.type === 'gradient' && deep[r] >= 0 && deep2[r] >= 0;
      const out = {
        c: color[r], rings, area: r3(ringsArea(rings)), bbox: ringsBox(rings).map(r3),
        nbrs: [...nbrs[r]].sort((a, b) => a - b), dE: r3(dEsum[r] / cnt[r]),
        fill: grad ? { type: 'gradient', c0: f.c0, c1: f.c1, x0: r3(f.x0), y0: r3(f.y0), x1: r3(f.x1), y1: r3(f.y1) } : { type: 'solid' },
        seed: at(deep[r] >= 0 ? deepAt[r] : deepAt2[r]),
      };
      if (grad) out.seeds = [{ at: at(deepAt[r]), room: (deep[r] + 0.5) * px, c: f.c0 }, { at: at(deepAt2[r]), room: (deep2[r] + 0.5) * px, c: f.c1 }];
      return out;
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
    return placeLabels(C.regions.map((r) => ({
      rings: r.rings, num: pal[r.c].num, seed: r.seed,
      fixed: r.seeds && r.seeds.map((q) => ({ x: q.at[0], y: q.at[1], text: String(pal[q.c].num), room: q.room })),
    })), {
      fontSize: s.fontSize, lineWidth: s.lineWidth, W: geo.W, H: geo.H, clearance,
    });
  });

  progress('assembling');
  const regions = C.regions.map((r, i) => {
    const l = D[i];
    const { seed, seeds, ...rest } = r;
    const label = { ...l, x: r3(l.x), y: r3(l.y), size: r3(l.size), room: r3(l.room), leader: l.leader && { x: r3(l.leader.x), y: r3(l.leader.y) } };
    if (l.second) label.second = { ...l.second, x: r3(l.second.x), y: r3(l.second.y), size: r3(l.second.size), room: r3(l.second.room) };
    return { ...rest, label };
  });
  const nameOf = (p) => (s.paletteMode === 'custom' ? (s.colors[p.from] && s.colors[p.from].name) || '' : p.name);
  const palette = pal.map((p) => ({ num: p.num, hex: p.hex, name: nameOf(p), area: 0, regions: 0, used: false }));
  for (const r of regions) {
    // a blend uses both its paints: half the area each
    const cs = r.fill.type === 'gradient' ? [r.fill.c0, r.fill.c1] : [r.c];
    for (const c of cs) { const p = palette[c]; p.area += r.area / cs.length; p.regions++; p.used = true; }
  }
  for (const p of palette) p.area = r3(p.area);

  const notes = [];
  const close = closePairs(pal);
  for (const { a, b, dE } of close) notes.push(`colors ${pal[a].num} and ${pal[b].num} are only ΔE ${dE.toFixed(1)} apart: hard to tell apart as paints`);
  const unused = palette.filter((p) => !p.used);
  if (unused.length) notes.push(`${unused.length === 1 ? 'color' : 'colors'} ${unused.map((p) => p.num).join(', ')} ${unused.length === 1 ? 'is' : 'are'} not used`);
  const leaders = regions.filter((r) => r.label.leader).length;
  const crowded = regions.filter((r) => r.label.crowded || (r.label.second && r.label.second.crowded)).length;
  if (G.gradients) notes.push(`${G.gradients} ${G.gradients === 1 ? 'region is a blend' : 'regions are blends'} between two colors: numbered with both, joined by a dashed line`);
  if (leaders) notes.push(`${leaders} ${leaders === 1 ? 'region is' : 'regions are'} too small for a number, and ${leaders === 1 ? 'has its number' : 'have theirs'} outside on a leader line`);
  if (crowded) notes.push(`${crowded} ${crowded === 1 ? 'number' : 'numbers'} found no room outside either and sit inside their regions (the Problems view shows where)`);
  if (merge > 0 && B.colors.length < s.autoN) notes.push(`${B.colors.length} colors of the ${s.autoN} asked for: the image has no more that are ${merge} ΔE apart`);
  if (edits.length > seg.edits) notes.push(`${edits.length - seg.edits} of ${edits.length} edits changed nothing (the region was already that color)`);
  if (s.targetOn && Math.abs(B.seg.count - s.target) > tolerance(s.target)) {
    notes.push(`${B.seg.count} regions is as near ${s.target} as the detail limits reach (×${B.f.toFixed(2)})`);
  }
  if (detail.edgeSmooth / px > sigmaCap + 1e-9) notes.push('edge smoothing held to a quarter of the narrowest region, so neighbouring boundaries cannot cross');

  return {
    method: method.id,
    piece: { W: geo.W, H: geo.H },
    imageRect: geo.imageRect,
    grid: { w, h, sx, sy },
    detail,
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
      edits: seg.edits,
      gradients: G.gradients,
      blendWhy: G.why || null,
      smallest: regions.reduce((m, r) => Math.min(m, r.area), Infinity),
    },
  };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/** The detail limits scaled by f: lengths by f, the area by f². */
export const scaledDetail = (s, f) => ({
  cleanup: s.cleanup * f, minWidth: s.minWidth * f, minArea: s.minArea * f * f, edgeSmooth: s.edgeSmooth * f,
});

/** How near the target counts as reached: 5%, at least 3 regions. */
export const tolerance = (target) => Math.max(3, 0.05 * target);

// AIMING FOR A NUMBER OF REGIONS. One factor f scales every detail limit, so
// the person's values keep their proportions and only the overall level moves.
// The count falls as f grows, roughly as f^-2 (the area limit goes as f²) but
// not smoothly: once the narrowest width passes the size of the image's
// features, many regions merge at once. So the search keeps a BRACKET: the
// largest f that gave too many regions and the smallest that gave too few.
// Until it has both ends it steps out by the f^-2 rule (at least ×1.25); then
// it interpolates in log-log between them, falling back to their geometric
// midpoint when the interpolation hugs an end (a cliff). It stops within the
// tolerance, when the bracket is narrower than 2%, or after MAX_TRIES, and uses
// the trial nearest the target; f stays in [F_MIN, F_MAX], so an unreachable
// target gets the nearest count (and a note says so).
const F_MIN = 0.1, F_MAX = 10, MAX_TRIES = 10;

/**
 * @param {(f:number)=>{count:number}} segAt
 * @returns {{seg, f:number, tries:number}}
 */
export function aimFor(segAt, target, onTry = () => {}) {
  const tried = [];
  const tryAt = (f) => {
    const seg = segAt(f);
    tried.push({ f, n: seg.count, seg });
    onTry(f, seg.count);
    return tried[tried.length - 1];
  };
  let t = tryAt(1);
  while (tried.length < MAX_TRIES && Math.abs(t.n - target) > tolerance(target)) {
    const many = tried.filter((q) => q.n > target).sort((a, b) => b.f - a.f)[0];   // f too small
    const few = tried.filter((q) => q.n < target).sort((a, b) => a.f - b.f)[0];    // f too large
    let next;
    if (many && few) {
      const span = Math.log(few.f / many.f);
      if (span < 0.02) break;
      const u = Math.log(many.n / target) / Math.log(many.n / Math.max(1, few.n));   // where the target falls, 0..1
      next = many.f * Math.exp(span * (u > 0.15 && u < 0.85 ? u : 0.5));
    } else if (many) {
      if (many.f >= F_MAX) break;
      next = Math.min(F_MAX, many.f * Math.max(1.25, Math.sqrt(many.n / target)));
    } else {
      if (few.f <= F_MIN) break;
      next = Math.max(F_MIN, few.f / Math.max(1.25, Math.sqrt(target / Math.max(1, few.n))));
    }
    t = tryAt(next);
  }
  const best = [...tried].sort((a, b) => Math.abs(a.n - target) - Math.abs(b.n - target) || a.f - b.f)[0];
  return { seg: best.seg, f: best.f, tries: tried.length };
}

function validate(s) {
  if (!(s.widthMm > 0)) throw new Error('the canvas needs a width');
  if (!(s.heightMm >= 0)) throw new Error('height must be 0 (from the image) or more');
  if (s.paletteMode === 'custom' && !(s.colors && s.colors.length)) throw new Error('the palette has no colors');
  if (s.paletteMode !== 'custom' && !(s.autoN >= 1)) throw new Error('ask for at least one color');
  if (!(s.minWidth >= 0) || !(s.minArea >= 0)) throw new Error('detail limits cannot be negative');
  if (!(s.fontSize > 0)) throw new Error('the numbers need a size');
}
