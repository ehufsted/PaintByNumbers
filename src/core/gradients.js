// Gradient regions: where the image is a smooth blend, one region painted as a
// blend through a few neighbouring palette colors, instead of bands of flat
// color.
//
// FINDING THEM. A limited palette turns a smooth sky or a shaded sphere into
// BANDS, and the boundary between two bands is not an edge in the image: on
// either side of it the pixels are nearly the same. A real edge is a jump. So
// each boundary between two regions is scored by how much the image actually
// changes across it, as a share of how different the two paints are:
//
//   jump = mean ΔE between the pixel pairs that straddle it  /  ΔE(paint A, paint B)
//
// A band boundary scores low; an edge scores near 1 or more. Boundaries under
// `blend`, whose two paints are no more than a STEP apart (strictness), join
// their regions, smoothest first, as long as a group keeps to `maxPaints`
// paints.
//
// THE CHAIN. A group's paints, lightest first, are a CHAIN: the blend runs from
// the first through each in turn to the last. Each pixel's place on the blend,
// t in [0, 1], is where its OKLab color projects onto that chain, by distance
// along it (so the stops sit at their paints' perceptual spacing, `at`).
//
// THE SHAPE. t is fitted by least squares as a function of position, two ways:
//
//   linear   t = a + b·x + c·y                      a straight blend
//   radial   t = α + β·ρ,  ρ the distance to a centre   rings round a highlight
//
// The radial centre comes from a quadratic fit (t = a + bx + cy + d(x²+y²) is a
// paraboloid round (−b/2d, −c/2d)), then t is refitted as linear in ρ. Radial
// is used when it explains clearly more (R² at least RADIAL_GAIN more) and its
// centre is not far off (within RADIAL_FAR group radii).
//
// KEPT ONLY WHEN (otherwise the group is tried again, a paint smaller, in the
// next round; after two paints, its regions stay flat as they were):
//
//   big enough      at least `minArea` (a blend needs room to be painted)
//   fits            R² at least the strictness's r2
//   not an edge     the blend at least MIN_SPAN long
//   no much worse   the image's error against the blend at most `worse` times
//                   its error against the flat bands it replaces
//   room to number  for each paint, a point of its band (the pixels whose t is
//                   nearest its stop) at least `room` from the region's edge
//   readable        consecutive numbers at least 2.5 rooms apart, and the
//                   dashed line through them inside the region (a snaking
//                   region is not one blend, and its line would cross others)

import { deltaE, hexToLinear, linearToHex } from './color.js';
import { edt } from './edt.js';
import { boundaryMask } from './segment.js';

export const STRICTNESS = {
  strict: { worse: 1.0, r2: 0.6, step: 25 },
  normal: { worse: 1.15, r2: 0.45, step: 35 },
  loose: { worse: 1.35, r2: 0.3, step: 50 },
};
export const MIN_SPAN = 3;        // mm, the shortest blend (shorter is an edge)
const RADIAL_GAIN = 0.05;         // R² radial must beat linear by
const RADIAL_FAR = 3;             // the radial centre within this many group radii of the group

/** Solve the n×n system A x = b in place (Gaussian elimination, partial pivoting); null if singular. */
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    if (Math.abs(A[p][i]) < 1e-12) return null;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

/** A pixel color's place on a chain of paints (OKLab points, offsets `at`), 0..1. */
function chainT(L, a, b, chain, at) {
  let best = Infinity, t = 0;
  for (let k = 0; k + 1 < chain.length; k++) {
    const P = chain[k], Q = chain[k + 1];
    const d0 = Q[0] - P[0], d1 = Q[1] - P[1], d2 = Q[2] - P[2];
    const L2 = d0 * d0 + d1 * d1 + d2 * d2;
    let u = L2 > 0 ? ((L - P[0]) * d0 + (a - P[1]) * d1 + (b - P[2]) * d2) / L2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const e = (L - P[0] - u * d0) ** 2 + (a - P[1] - u * d1) ** 2 + (b - P[2] - u * d2) ** 2;
    if (e < best) { best = e; t = at[k] + u * (at[k + 1] - at[k]); }
  }
  return t;
}

/** The chain's OKLab color at t. */
export function chainLab(stops, palLab, t) {
  for (let k = 0; k + 1 < stops.length; k++) {
    const s0 = stops[k], s1 = stops[k + 1];
    if (t <= s1.at || k + 2 === stops.length) {
      const u = s1.at > s0.at ? Math.max(0, Math.min(1, (t - s0.at) / (s1.at - s0.at))) : 0;
      const P = palLab[s0.c], Q = palLab[s1.c];
      return [P[0] + u * (Q[0] - P[0]), P[1] + u * (Q[1] - P[1]), P[2] + u * (Q[2] - P[2])];
    }
  }
  return palLab[stops[0].c];
}

/** A gradient fill's t at (x, y), clamped to [0, 1]. */
export function gradientT(f, x, y) {
  let t;
  if (f.shape === 'radial') t = f.alpha + f.beta * Math.hypot(x - f.cx, y - f.cy);
  else {
    const dx = f.x1 - f.x0, dy = f.y1 - f.y0, L2 = dx * dx + dy * dy;
    t = L2 > 0 ? ((x - f.x0) * dx + (y - f.y0) * dy) / L2 : 0;
  }
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * The color stops to draw a gradient fill with, [{offset, hex}] in 0..1 along
 * its geometry: a linear one from (x0, y0) (t = 0) to (x1, y1) (t = 1); a
 * radial one from its centre (offset 0) out to radius R (offset 1). A stop
 * that falls outside is replaced by the color where the blend crosses the end,
 * mixed in linear light as a renderer mixes stops.
 */
export function gradientStops(f, hexOf) {
  const at = f.shape === 'radial' ? (t) => (t - f.alpha) / f.beta / f.R : (t) => t;
  const pts = f.stops.map((s) => ({ offset: at(s.at), rgb: hexToLinear(hexOf(s.c)) })).sort((p, q) => p.offset - q.offset);
  const colorAt = (o) => {
    if (o <= pts[0].offset) return pts[0].rgb;
    for (let k = 0; k + 1 < pts.length; k++) {
      if (o <= pts[k + 1].offset) {
        const u = (o - pts[k].offset) / (pts[k + 1].offset - pts[k].offset || 1);
        return pts[k].rgb.map((v, d) => v + u * (pts[k + 1].rgb[d] - v));
      }
    }
    return pts[pts.length - 1].rgb;
  };
  const out = [{ offset: 0, hex: linearToHex(colorAt(0)) }];
  for (const p of pts) if (p.offset > 0 && p.offset < 1) out.push({ offset: p.offset, hex: linearToHex(p.rgb) });
  out.push({ offset: 1, hex: linearToHex(colorAt(1)) });
  return out;
}

/**
 * @param {{colors:Uint16Array, region:Int32Array, count:number, lab:Float32Array, pal:number[][],
 *          w, h, sx, sy, blend:number, minArea:number, room?:number,
 *          strictness?:string, maxPaints?:number, radial?:boolean}} o
 *   pal: OKLab per palette entry; minArea: px, the smallest gradient group;
 *   room: px, the clearance a number needs
 * @returns {{region:Int32Array, count:number, fills:object[], gradients:number, why:object}}
 *   fills per new region: {type:'solid', c} |
 *   {type:'gradient', shape:'linear'|'radial', stops:[{c, at}], c0, c1,
 *    x0, y0, x1, y1 (linear) | cx, cy, alpha, beta, R (radial), bands:[[x, y], ...]}
 *   bands: each stop's number position (mm), from the readability check
 */
export function findGradients(o) {
  const { colors, region, count, lab, pal, w, h, sx, sy } = o;
  const S = STRICTNESS[o.strictness] || STRICTNESS.normal;
  const maxPaints = Math.max(2, Math.round(o.maxPaints ?? 4));
  const colorOf = new Int32Array(count);
  for (let i = 0; i < w * h; i++) colorOf[region[i]] = colors[i];

  // boundary scores: the image's change across each region pair
  const pairs = new Map();   // key a*count+b (a<b) -> [sum ΔE, n]
  const add = (i, j) => {
    const a = region[i], b = region[j];
    if (a === b) return;
    const key = a < b ? a * count + b : b * count + a;
    const d = 100 * Math.hypot(lab[3 * i] - lab[3 * j], lab[3 * i + 1] - lab[3 * j + 1], lab[3 * i + 2] - lab[3 * j + 2]);
    const e = pairs.get(key);
    if (e) { e[0] += d; e[1]++; } else pairs.set(key, [d, 1]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < w - 1) add(i, i + 1);
      if (y < h - 1) add(i, i + w);
    }
  }
  // why candidates were turned down, for the notes and for tuning
  const why = { boundaries: pairs.size, smooth: 0, farPaints: 0, tooManyPaints: 0, groups: 0, small: 0, curved: 0, short: 0, worse: 0, room: 0, close: 0, bent: 0, radial: 0 };
  const cand = [];
  for (const [key, [sum, n]] of pairs) {
    const a = Math.floor(key / count), b = key % count;
    const paints = deltaE(pal[colorOf[a]], pal[colorOf[b]]);
    if (!(paints > 0)) continue;
    const jump = sum / n / paints;
    if (jump >= o.blend) continue;
    why.smooth++;
    if (paints > S.step) { why.farPaints++; continue; }
    cand.push({ a, b, jump });
  }
  cand.sort((p, q) => p.jump - q.jump || p.a - q.a || p.b - q.b);

  // ROUNDS, from maxPaints paints per blend down to 2. A group that is turned
  // down (it fits too loosely, or matches worse than its bands) is not given up:
  // its regions are grouped again in the next round with one paint fewer, so a
  // sphere's rings, too curved to be one blend of six paints, can still be
  // three blends of two or three. Regions in an accepted blend sit out later
  // rounds.
  const groupOf = new Int32Array(count).fill(-1);   // region -> accepted blend key
  const blends = new Map();                         // key -> fill
  const tPix = new Float32Array(w * h);
  const tAt = (f, i) => gradientT(f, ((i % w) + 0.5) * sx, (Math.floor(i / w) + 0.5) * sy);
  const parent = new Int32Array(count);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let L = maxPaints; L >= 2; L--) {
    // groups of at most L paints among the free regions, smoothest boundaries first
    for (let i = 0; i < count; i++) parent[i] = i;
    const paintsOf = Array.from({ length: count }, (_, i) => new Set([colorOf[i]]));
    let joined = 0;
    for (const { a, b } of cand) {
      if (groupOf[a] >= 0 || groupOf[b] >= 0) continue;
      const ra = find(a), rb = find(b);
      if (ra === rb) continue;
      const u = new Set([...paintsOf[ra], ...paintsOf[rb]]);
      if (u.size > L) { if (L === maxPaints) why.tooManyPaints++; continue; }
      parent[rb] = ra;
      paintsOf[ra] = u;
      joined++;
    }
    if (!joined) break;   // nothing left to blend

    // each group's chain, and per pixel its t; sums for the linear and quadratic fits
    // (features 1, x, y, x² + y²)
    const groups = new Map();
    for (let i = 0; i < w * h; i++) {
      if (groupOf[region[i]] >= 0) continue;
      const r = find(region[i]);
      if (paintsOf[r].size < 2) continue;
      let g = groups.get(r);
      if (!g) {
        const order = [...paintsOf[r]].sort((p, q) => pal[q][0] - pal[p][0] || p - q);   // lightest first
        const chain = order.map((c) => pal[c]);
        const cum = [0];
        for (let k = 1; k < chain.length; k++) cum.push(cum[k - 1] + deltaE(chain[k - 1], chain[k]));
        const at = cum.map((v) => v / cum[cum.length - 1]);
        g = { order, chain, at, n: 0, Q: Array.from({ length: 4 }, () => new Float64Array(4)), qt: new Float64Array(4), st: 0, stt: 0 };
        groups.set(r, g);
      }
      const t = chainT(lab[3 * i], lab[3 * i + 1], lab[3 * i + 2], g.chain, g.at);
      tPix[i] = t;
      const x = ((i % w) + 0.5) * sx, y = (Math.floor(i / w) + 0.5) * sy;
      const f = [1, x, y, x * x + y * y];
      for (let p = 0; p < 4; p++) { g.qt[p] += f[p] * t; for (let q = 0; q < 4; q++) g.Q[p][q] += f[p] * f[q]; }
      g.n++; g.st += t; g.stt += t * t;
    }
    const live = new Set();
    for (const [r, g] of groups) {
      why.groups++;
      if (g.n < o.minArea) { why.small++; continue; }
      const n = g.n, mt = g.st / n, ctt = g.stt / n - mt * mt;
      if (!(ctt > 1e-9)) { why.curved++; continue; }
      const ss = ctt * n;   // the total sum of squares of t
      const rss = (coef, k) => {   // the residual sum of squares, from the normal equations
        let s = g.stt;
        for (let p = 0; p < k; p++) { s -= 2 * coef[p] * g.qt[p]; for (let q = 0; q < k; q++) s += coef[p] * coef[q] * g.Q[p][q]; }
        return s;
      };
      const mx = g.Q[0][1] / n, my = g.Q[0][2] / n;
      const lin = solve(g.Q.slice(0, 3).map((row) => Array.from(row.slice(0, 3))), Array.from(g.qt.slice(0, 3)));
      g.r2 = -1;
      if (lin) {
        const [a0, b, c] = lin, g2 = b * b + c * c;
        if (g2 > 0) {
          const ux = b / g2, uy = c / g2, tm = a0 + b * mx + c * my;
          g.fill = { shape: 'linear', span: 1 / Math.sqrt(g2), x0: mx - tm * ux, y0: my - tm * uy, x1: mx + (1 - tm) * ux, y1: my + (1 - tm) * uy };
          g.r2 = 1 - rss(lin, 3) / ss;
        }
      }
      if (o.radial !== false) {
        const quad = solve(g.Q.map((row) => Array.from(row)), Array.from(g.qt));
        if (quad && Math.abs(quad[3]) > 1e-12) {
          const cx = -quad[1] / (2 * quad[3]), cy = -quad[2] / (2 * quad[3]);
          const spread = Math.sqrt(Math.max(1e-9, g.Q[0][3] / n - mx * mx - my * my));   // the group's rms radius
          if (Math.hypot(cx - mx, cy - my) <= RADIAL_FAR * spread) g.centre = { cx, cy };
        }
      }
      live.add(r);
    }

    // the radial refit, t = α + β·ρ, where a centre was found
    const rad = new Map();
    for (let i = 0; i < w * h; i++) {
      if (groupOf[region[i]] >= 0) continue;
      const r = find(region[i]);
      if (!live.has(r)) continue;
      const g = groups.get(r);
      if (!g.centre) continue;
      let s = rad.get(r);
      if (!s) { s = { n: 0, sp: 0, spp: 0, spt: 0, maxP: 0 }; rad.set(r, s); }
      const x = ((i % w) + 0.5) * sx, y = (Math.floor(i / w) + 0.5) * sy;
      const p = Math.hypot(x - g.centre.cx, y - g.centre.cy), t = tPix[i];
      s.n++; s.sp += p; s.spp += p * p; s.spt += p * t;
      if (p > s.maxP) s.maxP = p;
    }
    const accepted = new Map();   // root -> fill
    for (const r of live) {
      const g = groups.get(r), s = rad.get(r);
      if (s) {
        const n = s.n, mp = s.sp / n, mt = g.st / n;
        const cpp = s.spp / n - mp * mp, cpt = s.spt / n - mp * mt, ctt = g.stt / n - mt * mt;
        if (cpp > 1e-9 && ctt > 1e-9) {
          const beta = cpt / cpp, alpha = mt - beta * mp;
          const r2R = (cpt * cpt) / (cpp * ctt);
          if (r2R >= g.r2 + RADIAL_GAIN && beta !== 0) {
            const ends = [-alpha / beta, (1 - alpha) / beta];
            g.fill = { shape: 'radial', span: 1 / Math.abs(beta), cx: g.centre.cx, cy: g.centre.cy, alpha, beta, R: Math.max(1e-6, s.maxP, ...ends) };
            g.r2 = r2R;
          }
        }
      }
      if (!g.fill || !(g.r2 >= S.r2)) { why.curved++; continue; }
      if (g.fill.span < MIN_SPAN) { why.short++; continue; }
      const { span, ...geom } = g.fill;
      accepted.set(r, { type: 'gradient', ...geom, stops: g.order.map((c, k) => ({ c, at: g.at[k] })),
        c0: g.order[0], c1: g.order[g.order.length - 1], blendErr: 0, flatErr: 0 });
    }

    // no much worse: the image against the blend, and against the flat bands
    for (let i = 0; i < w * h; i++) {
      if (groupOf[region[i]] >= 0) continue;
      const f = accepted.get(find(region[i]));
      if (!f) continue;
      const B = chainLab(f.stops, pal, tAt(f, i)), F = pal[colors[i]];
      const L0 = lab[3 * i], a = lab[3 * i + 1], bb = lab[3 * i + 2];
      f.blendErr += Math.hypot(L0 - B[0], a - B[1], bb - B[2]);
      f.flatErr += Math.hypot(L0 - F[0], a - F[1], bb - F[2]);
    }
    for (const [r, f] of accepted) if (f.blendErr > S.worse * f.flatErr) { accepted.delete(r); why.worse++; }

    // this round's blends: their regions sit out the rounds after
    const keyOf = new Map();
    for (const [r, f] of accepted) { const key = blends.size; blends.set(key, f); keyOf.set(r, key); if (f.shape === 'radial') why.radial++; }
    for (let i = 0; i < count; i++) if (groupOf[i] < 0 && keyOf.has(find(i))) groupOf[i] = keyOf.get(find(i));
  }

  // the new region map: a blend is one region, every other region as it was
  const build = () => {
    const newReg = new Int32Array(count).fill(-1), newBlend = new Map();
    const fills = [], keys = [];
    const out = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r0 = region[i], key = groupOf[r0];
      let id;
      if (key >= 0) {
        id = newBlend.get(key);
        if (id === undefined) { id = fills.length; newBlend.set(key, id); fills.push(blends.get(key)); keys.push(key); }
      } else {
        id = newReg[r0];
        if (id < 0) { id = fills.length; newReg[r0] = id; fills.push({ type: 'solid', c: colorOf[r0] }); keys.push(-1); }
      }
      out[i] = id;
    }
    return { out, fills, keys };
  };
  let m = build();
  if (blends.size) {
    // room to number and readable: each stop's band (pixels whose t is nearest
    // its stop), the deepest point of each, and the dashed line through them
    const dB = edt(boundaryMask(m.out, w, h), w, h);
    const best = m.fills.map((f) => (f.type === 'gradient' ? f.stops.map(() => [-1, -1]) : null));
    for (let i = 0; i < w * h; i++) {
      const id = m.out[i], f = m.fills[id];
      if (f.type !== 'gradient') continue;
      const t = tAt(f, i);
      let k = 0;
      for (let j = 1; j < f.stops.length; j++) if (Math.abs(t - f.stops[j].at) < Math.abs(t - f.stops[k].at)) k = j;
      if (dB[i] > best[id][k][0]) best[id][k] = [dB[i], i];
    }
    const room = o.room > 0 ? o.room : 0;
    let dropped = 0;
    m.fills.forEach((f, id) => {
      if (f.type !== 'gradient') return;
      const b = best[id];
      let ok = b.every(([d]) => d >= 0 && d + 0.5 >= room);
      if (!ok) why.room++;
      const P = b.map(([, i]) => [i % w, Math.floor(i / w)]);
      for (let k = 1; ok && k < P.length; k++) {
        if (Math.hypot((P[k][0] - P[k - 1][0]) * sx, (P[k][1] - P[k - 1][1]) * sy) < 2.5 * room * Math.sqrt(sx * sy)) { ok = false; why.close++; }
      }
      for (let k = 1; ok && k < P.length; k++) {
        const [x0, y0] = P[k - 1], [x1, y1] = P[k];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
        for (let j = 1; j < steps && ok; j++) {
          const x = Math.round(x0 + ((x1 - x0) * j) / steps), y = Math.round(y0 + ((y1 - y0) * j) / steps);
          if (m.out[y * w + x] !== id) ok = false;
        }
        if (!ok) why.bent++;
      }
      if (!ok) {
        // back to its flat regions
        const key = m.keys[id];
        blends.delete(key);
        for (let r = 0; r < count; r++) if (groupOf[r] === key) groupOf[r] = -1;
        dropped++;
      } else f.bands = P.map(([x, y]) => [(x + 0.5) * sx, (y + 0.5) * sy]);
    });
    if (dropped) m = build();
  }
  for (const f of m.fills) { delete f.blendErr; delete f.flatErr; }
  return { region: m.out, count: m.fills.length, fills: m.fills, gradients: blends.size, why };
}
