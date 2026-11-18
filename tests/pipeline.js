import { section, check, num, say, coverage, randomPoints } from './runner.js';
import { runPipeline } from '../src/pipeline.js';
import { generateSample } from '../src/app/samples.js';
import { inRings } from '../src/core/geom.js';
import { halfDiag } from '../src/core/labels.js';

export function run() {
  section('pipeline', 'The whole chain on the sphere and rings samples. Predictions: the regions tile the canvas; every region has a number, inside it or on a leader whose dot is inside it; regions meet the area limit (to within what the edge smoothing moves); the same input gives the same plan, with or without the stage cache.');
  const sphere = generateSample('sphere').color;
  const rings = generateSample('rings').color;
  const base = { widthMm: 200, precision: 'draft', autoN: 10, minWidth: 2.5, minArea: 10, edgeSmooth: 0.6, fontSize: 1.8 };
  for (const [name, img] of [['sphere', sphere], ['rings', rings]]) {
    const plan = runPipeline(img, base);
    const { W, H } = plan.piece;
    const cov = coverage(plan.regions, randomPoints(3000, W, H, 5));
    check(`${name}: the regions tile the canvas`, cov.one === 3000, `${plan.regions.length} regions; ${cov.none} points in none, ${cov.many} in two+`);
    const areaSum = plan.regions.reduce((a, r) => a + r.area, 0);
    check(`${name}: their areas sum to the canvas`, Math.abs(areaSum - W * H) / (W * H) < 1e-4, `${num(areaSum, 1)} of ${num(W * H, 1)} mm²`);
    let outside = 0, small = 0, overlap = 0;
    const r = plan.regions;
    for (const g of r) {
      const l = g.label;
      const at = l.leader || l;
      if (!inRings(at.x, at.y, g.rings)) outside++;
      if (g.area < 0.8 * base.minArea) small++;
    }
    // no two numbers overlap
    const ls = r.map((g) => g.label);
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        const a = ls[i], b = ls[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 0.98 * (halfDiag(a.text.length, a.size) + halfDiag(b.text.length, b.size)) - 1e-6 && !a.crowded && !b.crowded) overlap++;
      }
    }
    check(`${name}: every number (or its leader dot) is in its region`, outside === 0, `${outside} of ${r.length}; ${plan.stats.leaders} leaders, ${plan.stats.crowded} crowded`);
    check(`${name}: no region under 80% of the area limit`, small === 0, `smallest ${num(plan.stats.smallest, 2)} mm² (limit ${base.minArea})`);
    check(`${name}: no two numbers overlap`, overlap === 0, `${overlap} pairs`);
    check(`${name}: every number is the one size`, ls.every((l) => l.size === base.fontSize));
    check(`${name}: palette numbered light to dark`, plan.palette.every((p, i) => p.num === i + 1));
    say(`<p class="note">${name}: ${plan.regions.length} regions, ${plan.stats.colors} colors, mean ΔE ${num(plan.stats.meanDE, 2)}, ${plan.chains.length} chains</p>`);
  }

  const a = runPipeline(sphere, base);
  const b = runPipeline(sphere, base);
  check('the same input gives the same plan', JSON.stringify(a) === JSON.stringify(b));
  const cache = {};
  runPipeline(sphere, base, { cache, imageKey: 1 });
  const viaCache = runPipeline(sphere, { ...base, fontSize: 2.4 }, { cache, imageKey: 1 });
  const fresh = runPipeline(sphere, { ...base, fontSize: 2.4 });
  check('a cached run (only the numbers changed) equals a fresh one', JSON.stringify(viaCache) === JSON.stringify(fresh));
  check('and it reused the regions', cache.C && viaCache.regions.length === fresh.regions.length);

  // renaming a custom color re-runs no region
  const cols = [{ hex: '#202020', name: 'black' }, { hex: '#f0f0f0', name: 'white' }];
  const c2 = {};
  runPipeline(sphere, { ...base, paletteMode: 'custom', colors: cols }, { cache: c2, imageKey: 1 });
  const bBefore = c2.B.val;
  const renamed = runPipeline(sphere, { ...base, paletteMode: 'custom', colors: [{ ...cols[0], name: 'ivory black' }, cols[1]] }, { cache: c2, imageKey: 1 });
  check('renaming a custom color reuses the regions and shows the new name', c2.B.val === bBefore && renamed.palette.some((p) => p.name === 'ivory black'));
  const rough = runPipeline(sphere, { ...base, precision: 'rough' });
  check('rough draft works on a 700 px grid', Math.max(rough.grid.w, rough.grid.h) === 700, `${rough.grid.w} × ${rough.grid.h}`);
  const custom = runPipeline(sphere, { ...base, paletteMode: 'custom', colors: [{ hex: '#202020', name: 'black' }, { hex: '#f0f0f0', name: 'white' }, { hex: '#d07030', name: 'orange' }], order: 'list' });
  check('a custom palette in list order keeps its numbers', custom.palette.map((p) => p.name).join() === 'black,white,orange');
  check('and only its colors appear', custom.regions.every((g) => g.c >= 0 && g.c < 3));
  let threw = '';
  try { runPipeline(sphere, { ...base, paletteMode: 'custom', colors: [] }); } catch (e) { threw = e.message; }
  check('an empty custom palette is refused with a reason', /no colors/.test(threw), threw);
}
