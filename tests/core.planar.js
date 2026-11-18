import { section, check, num, makeLabels, blobLabels, coverage, randomPoints } from './runner.js';
import { planarMap, smoothChains, ringPoints, ringArea, gaussChain } from '../src/core/planar.js';
import { regionsOf, segment } from '../src/core/segment.js';
import { ringsArea, ringsBox, inRings } from '../src/core/geom.js';

/** Regions as the pipeline builds them, in grid px. */
function shapes(region, w, h, sigma) {
  const pm = planarMap(region, w, h);
  const pts = sigma === null ? pm.chains.map((c) => c.pts) : smoothChains(pm.chains, sigma, 0.2);
  const regions = pm.rings.map((rs) => {
    const rings = rs.map((r) => ringPoints(r, pts, pm.chains));
    return { rings, bbox: ringsBox(rings), area: ringsArea(rings) };
  });
  return { pm, pts, regions };
}

export function run() {
  section('core.planar', 'The planar map. Predictions: unsmoothed, every region\'s polygon area equals its pixel count and every pixel centre is in its own region only; smoothed, every point of the canvas is still in exactly one region (the shared chains leave no gap and no overlap); every chain is used once by each region beside it.');

  const one = shapes(new Int32Array([0]), 1, 1, null);
  check('one pixel: one closed chain, one ring of area 1', one.pm.chains.length === 1 && one.pm.chains[0].closed && one.regions[0].rings.length === 1 && Math.abs(one.regions[0].area - 1) < 1e-12);
  check('a ring with its region on the left has negative area (y-down)', ringArea(one.regions[0].rings[0]) < 0, num(ringArea(one.regions[0].rings[0])));

  // a saddle: a b / b a, four 4-connected regions meeting at one node
  const sad = shapes(new Int32Array([0, 1, 2, 3]), 2, 2, null);
  check('saddle: four regions of area 1 around one node', sad.regions.length === 4 && sad.regions.every((r) => Math.abs(r.area - 1) < 1e-12));
  // one region touching itself diagonally: a U whose ends meet at a corner
  const u = regionsOf(makeLabels(3, 3, (x, y) => (x === 1 && y === 1 ? 1 : (x === 2 && y === 0) ? 2 : 0)), 3, 3);
  const us = shapes(u.id, 3, 3, null);
  const uArea = us.regions.map((r) => r.area);
  check('a region touching itself at a corner keeps its pixel areas', uArea.join() === '7,1,1', uArea.join());

  // an island: a 3×3 region inside a 7×7
  const isl = shapes(makeLabels(7, 7, (x, y) => (x >= 2 && x < 5 && y >= 2 && y < 5 ? 1 : 0), Int32Array), 7, 7, null);
  check('an island makes a hole: two rings, area 49 − 9', isl.regions[0].rings.length === 2 && Math.abs(isl.regions[0].area - 40) < 1e-9, `${isl.regions[0].rings.length} rings, area ${isl.regions[0].area}`);
  check('the island\'s boundary is one closed chain', isl.pm.chains.filter((c) => c.closed && c.a >= 0 && c.b >= 0).length === 1);

  // random segmented maps
  const cases = [[120, 90, 5, 30, 0.05, 1], [70, 140, 3, 60, 0.15, 2], [200, 150, 8, 90, 0.08, 3]];
  let areaBad = 0, centreBad = 0, useBad = 0, nPix = 0, nReg = 0;
  const smoothRes = [];
  for (const [w, h, K, sites, noise, seed] of cases) {
    const lab0 = blobLabels(w, h, K, sites, noise, seed);
    const pal = Array.from({ length: K }, (_, k) => [k / K, 0, 0]);
    const lab = new Float32Array(3 * w * h);
    lab0.forEach((v, i) => { lab[3 * i] = pal[v][0]; });
    // light limits, so plenty of small and saddle-prone regions remain
    const seg = segment(lab0, w, h, lab, pal, { minWidthPx: 2, minAreaPx: 3 });
    const raw = shapes(seg.region, w, h, null);
    const sizes = new Array(seg.count).fill(0);
    for (const v of seg.region) sizes[v]++;
    raw.regions.forEach((r, i) => { if (Math.abs(r.area - sizes[i]) > 1e-9) areaBad++; });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = seg.region[y * w + x];
        let k = 0, own = false;
        raw.regions.forEach((g, i) => {
          const b = g.bbox;
          if (x + 0.5 < b[0] || x + 0.5 > b[2] || y + 0.5 < b[1] || y + 0.5 > b[3]) return;
          if (inRings(x + 0.5, y + 0.5, g.rings)) { k++; if (i === r) own = true; }
        });
        if (k !== 1 || !own) centreBad++;
        nPix++;
      }
    }
    // each chain once per region beside it
    const uses = raw.pm.chains.map(() => 0);
    raw.pm.rings.forEach((rs) => rs.forEach((ring) => ring.forEach(({ c }) => { uses[c]++; })));
    raw.pm.chains.forEach((c, i) => { if (uses[i] !== (c.a >= 0) + (c.b >= 0)) useBad++; });
    nReg += seg.count;
    for (const sigma of [1, 2.5]) {
      const sm = shapes(seg.region, w, h, sigma);
      const cov = coverage(sm.regions, randomPoints(4000, w, h, seed * 10 + sigma * 2));
      const total = sm.regions.reduce((a, r) => a + r.area, 0);
      smoothRes.push({ w, h, sigma, cov, total });
    }
  }
  check('unsmoothed: each region\'s area is its pixel count', areaBad === 0, `${areaBad} of ${nReg} regions differ`);
  check('unsmoothed: every pixel centre is in its own region and no other', centreBad === 0, `${centreBad} of ${nPix} pixels`);
  check('every chain is used once by each region beside it', useBad === 0, `${useBad} chains misused`);
  const covBad = smoothRes.filter((r) => r.cov.one !== 4000);
  check('smoothed: every random point is in exactly one region', covBad.length === 0,
    smoothRes.map((r) => `${r.w}×${r.h} σ ${r.sigma}: ${r.cov.none} in none, ${r.cov.many} in two+`).join('; '));
  const areaErr = Math.max(...smoothRes.map((r) => Math.abs(r.total - r.w * r.h) / (r.w * r.h)));
  check('smoothed: the regions\' areas sum to the canvas', areaErr < 1e-9, `worst relative error ${areaErr.toExponential(2)}`);

  // smoothing holds a chain's ends
  const zig = [0, 0, 1, 0, 1, 1, 2, 1, 2, 2, 3, 2, 3, 3, 4, 3, 4, 4];
  const g = gaussChain(zig, 2, false);
  check('smoothing pins both ends of an open chain', g[0] === 0 && g[1] === 0 && g[16] === 4 && g[17] === 4);
  // a staircase's edge is the line midway between its inner and outer corners
  const mid = Math.abs(g[8] - g[9] - 0.5);
  check('and straightens a staircase onto its midline', mid < 0.1, `the middle point is ${num(mid)} px off it`);
}
