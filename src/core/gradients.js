// Gradient regions: where the image is a smooth blend, one region painted as a
// blend from one palette color to another, instead of bands of flat color.
//
// FINDING THEM. A limited palette turns a smooth sky into BANDS, and the
// boundary between two bands is not an edge in the image: on either side of it
// the pixels are nearly the same. A real edge is a jump. So each boundary
// between two regions is scored by how much the image actually changes across
// it, as a share of how different the two paints are:
//
//   jump = mean ΔE between the pixel pairs that straddle it  /  ΔE(paint A, paint B)
//
// A band boundary scores low (the pixels differ by a step of the blend, the
// paints by a whole band); an edge scores near 1 or more. Boundaries scoring
// under `blend` join their regions, smoothest first, as long as a group keeps
// to TWO paints (a painter blends two colors, not three).
//
// Only paints within MAX_PAINT_DE of each other are blended: across a wide gap
// (black to ochre) the relative test passes too easily, and a painter would not
// blend it anyway.
//
// FITTING. In each group, every pixel's place between the two paints, t in
// [0, 1] (its OKLab color projected on the line between them), is fitted by
// least squares as a linear function of position, t = a + b·x + c·y. A group
// becomes one region with a gradient fill, from paint c0 where t = 0 to c1
// where t = 1 along (b, c), only when all of these hold; otherwise its regions
// stay flat as they were:
//
//   big enough        at least `minArea` (a blend needs room to be painted)
//   linear            R² at least MIN_R2
//   not an edge       the blend at least MIN_SPAN long
//   no worse          the image's error against the blend is no more than
//                     against the flat bands it replaces
//   room to number    each half (t below and above 0.5) has a point at least
//                     `room` from the region's edge, for its number
//   one blend         the two points at least 2.5 rooms apart (two numbers and
//                     a dash between), and the straight line between them inside
//                     the region (a snaking region is not one linear blend,
//                     and its dashed line would cross other regions)

import { deltaE } from './color.js';
import { edt } from './edt.js';
import { boundaryMask } from './segment.js';

export const MIN_R2 = 0.5;        // how much of the color change the linear blend must explain
export const MIN_SPAN = 3;        // mm, the shortest blend (shorter is an edge)
export const MAX_PAINT_DE = 30;   // ΔE, the widest gap between two paints that are blended

/**
 * @param {{colors:Uint16Array, region:Int32Array, count:number, lab:Float32Array, pal:number[][],
 *          w, h, sx, sy, blend:number, minArea:number, room?:number}} o
 *   pal: OKLab per palette entry; minArea: px, the smallest gradient group;
 *   room: px, the clearance a number needs (each half must have it)
 * @returns {{region:Int32Array, count:number, fills:object[], gradients:number}}
 *   fills per new region: {type:'solid', c} | {type:'gradient', c0, c1, x0, y0, x1, y1} (mm)
 */
export function findGradients(o) {
  const { colors, region, count, lab, pal, w, h, sx, sy } = o;
  const colorOf = new Int32Array(count), size = new Float64Array(count);
  for (let i = 0; i < w * h; i++) { colorOf[region[i]] = colors[i]; size[region[i]]++; }

  // boundary scores: the image's change across each region pair
  const pairs = new Map();   // key a*count+b (a<b) -> [sum ΔE, n]
  const dEpx = (i, j) => 100 * Math.hypot(lab[3 * i] - lab[3 * j], lab[3 * i + 1] - lab[3 * j + 1], lab[3 * i + 2] - lab[3 * j + 2]);
  const add = (i, j) => {
    const a = region[i], b = region[j];
    if (a === b) return;
    const key = a < b ? a * count + b : b * count + a;
    const e = pairs.get(key);
    const d = dEpx(i, j);
    if (e) { e[0] += d; e[1]++; } else pairs.set(key, [d, 1]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < w - 1) add(i, i + 1);
      if (y < h - 1) add(i, i + w);
    }
  }
  const cand = [];
  for (const [key, [sum, n]] of pairs) {
    const a = Math.floor(key / count), b = key % count;
    const paints = deltaE(pal[colorOf[a]], pal[colorOf[b]]);
    if (!(paints > 0) || paints > MAX_PAINT_DE) continue;
    const jump = sum / n / paints;
    if (jump < o.blend) cand.push({ a, b, jump });
  }
  cand.sort((p, q) => p.jump - q.jump || p.a - q.a || p.b - q.b);

  // groups of at most two paints, smoothest boundaries first
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const paintsOf = Array.from({ length: count }, (_, i) => new Set([colorOf[i]]));
  for (const { a, b } of cand) {
    const ra = find(a), rb = find(b);
    if (ra === rb) continue;
    const u = new Set([...paintsOf[ra], ...paintsOf[rb]]);
    if (u.size > 2) continue;
    parent[rb] = ra;
    paintsOf[ra] = u;
  }

  // fit each two-paint group: t = a + b·x + c·y by least squares (normal equations)
  const groups = new Map();   // root -> accumulators
  for (let i = 0; i < w * h; i++) {
    const r = find(region[i]);
    if (paintsOf[r].size !== 2) continue;
    let g = groups.get(r);
    if (!g) {
      const [c0, c1] = [...paintsOf[r]].sort((p, q) => pal[q][0] - pal[p][0] || p - q);   // c0 the lighter
      g = { c0, c1, n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0, syy: 0, st: 0, sxt: 0, syt: 0, stt: 0 };
      groups.set(r, g);
    }
    const P0 = pal[g.c0], P1 = pal[g.c1];
    const dx0 = P1[0] - P0[0], dx1 = P1[1] - P0[1], dx2 = P1[2] - P0[2];
    const L2 = dx0 * dx0 + dx1 * dx1 + dx2 * dx2;
    let t = ((lab[3 * i] - P0[0]) * dx0 + (lab[3 * i + 1] - P0[1]) * dx1 + (lab[3 * i + 2] - P0[2]) * dx2) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = ((i % w) + 0.5) * sx, y = (Math.floor(i / w) + 0.5) * sy;
    g.n++; g.sx += x; g.sy += y; g.sxx += x * x; g.sxy += x * y; g.syy += y * y;
    g.st += t; g.sxt += x * t; g.syt += y * t; g.stt += t * t;
  }
  const accepted = new Map();   // root -> fill
  for (const [r, g] of groups) {
    if (g.n < o.minArea) continue;
    const n = g.n, mx = g.sx / n, my = g.sy / n, mt = g.st / n;
    const cxx = g.sxx / n - mx * mx, cxy = g.sxy / n - mx * my, cyy = g.syy / n - my * my;
    const cxt = g.sxt / n - mx * mt, cyt = g.syt / n - my * mt, ctt = g.stt / n - mt * mt;
    const det = cxx * cyy - cxy * cxy;
    if (!(det > 1e-9) || !(ctt > 1e-9)) continue;
    const b = (cxt * cyy - cyt * cxy) / det, c = (cyt * cxx - cxt * cxy) / det;
    const r2 = (b * cxt + c * cyt) / ctt;
    const g2 = b * b + c * c;
    if (!(r2 >= MIN_R2) || !(g2 > 0)) continue;
    const span = 1 / Math.sqrt(g2);   // mm from t = 0 to t = 1
    if (span < MIN_SPAN) continue;
    // the ends: where t = 0 and t = 1 on the line through the centroid
    const ux = b / g2, uy = c / g2;
    accepted.set(r, { type: 'gradient', c0: g.c0, c1: g.c1, x0: mx - mt * ux, y0: my - mt * uy, x1: mx + (1 - mt) * ux, y1: my + (1 - mt) * uy, r2,
      blendErr: 0, flatErr: 0 });
  }

  // no worse: the image against the blend, and against the flat bands
  const tAt = (f, i) => gradientT(f, ((i % w) + 0.5) * sx, (Math.floor(i / w) + 0.5) * sy);
  for (let i = 0; i < w * h; i++) {
    const f = accepted.get(find(region[i]));
    if (!f) continue;
    const t = tAt(f, i), A = pal[f.c0], B = pal[f.c1], F = pal[colors[i]];
    const L = lab[3 * i], a = lab[3 * i + 1], bb = lab[3 * i + 2];
    f.blendErr += Math.hypot(L - (A[0] + t * (B[0] - A[0])), a - (A[1] + t * (B[1] - A[1])), bb - (A[2] + t * (B[2] - A[2])));
    f.flatErr += Math.hypot(L - F[0], a - F[1], bb - F[2]);
  }
  for (const [r, f] of accepted) if (f.blendErr > f.flatErr) accepted.delete(r);

  // the new region map: an accepted group is one region, every other region as it was
  const build = () => {
    const newId = new Int32Array(count).fill(-1);
    const fills = [], roots = [];
    const out = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r0 = region[i], root = find(r0);
      const key = accepted.has(root) ? root : r0;
      if (newId[key] < 0) {
        newId[key] = fills.length;
        roots.push(accepted.has(root) ? root : -1);
        fills.push(accepted.has(root) ? accepted.get(root) : { type: 'solid', c: colorOf[r0] });
      }
      out[i] = newId[key];
    }
    return { out, fills, roots };
  };
  let m = build();
  if (o.room > 0 && accepted.size) {
    // room to number, and one blend: the deepest point of each half, and the line between them
    const dB = edt(boundaryMask(m.out, w, h), w, h);
    const n = m.fills.length;
    const best = Array.from({ length: n }, () => [[-1, -1], [-1, -1]]);   // [depth, pixel] per half
    for (let i = 0; i < w * h; i++) {
      const id = m.out[i], f = m.fills[id];
      if (f.type !== 'gradient') continue;
      const half = tAt(f, i) >= 0.5 ? 1 : 0;
      if (dB[i] > best[id][half][0]) best[id][half] = [dB[i], i];
    }
    let dropped = 0;
    m.fills.forEach((f, id) => {
      if (f.type !== 'gradient') return;
      const [[d0, p0], [d1, p1]] = best[id];
      let ok = d0 + 0.5 >= o.room && d1 + 0.5 >= o.room;
      const x0 = p0 % w, y0 = Math.floor(p0 / w), x1 = p1 % w, y1 = Math.floor(p1 / w);
      // and far enough apart that the two numbers (and their dashed line) do not touch
      if (Math.hypot((x1 - x0) * sx, (y1 - y0) * sy) < 2.5 * o.room * Math.sqrt(sx * sy)) ok = false;
      if (ok) {
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
        for (let k = 1; k < steps && ok; k++) {
          const x = Math.round(x0 + ((x1 - x0) * k) / steps), y = Math.round(y0 + ((y1 - y0) * k) / steps);
          if (m.out[y * w + x] !== id) ok = false;
        }
      }
      if (!ok) { accepted.delete(m.roots[id]); dropped++; }
    });
    if (dropped) m = build();
  }
  for (const f of m.fills) { delete f.blendErr; delete f.flatErr; }
  return { region: m.out, count: m.fills.length, fills: m.fills, gradients: accepted.size };
}

/** A gradient fill's t at (x, y): 0 at its c0 end, 1 at its c1 end, clamped. */
export function gradientT(f, x, y) {
  const dx = f.x1 - f.x0, dy = f.y1 - f.y0, L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? ((x - f.x0) * dx + (y - f.y0) * dy) / L2 : 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
