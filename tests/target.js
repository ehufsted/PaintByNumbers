import { section, check, num, makeRGBA, mkRand } from './runner.js';
import { runPipeline, aimFor, tolerance, scaledDetail } from '../src/pipeline.js';
import { generateSample } from '../src/app/samples.js';

export function run() {
  section('target', 'Aiming for a number of regions. Predictions: on a count that falls as a power of the scale, the search lands within 5% in a few tries; out of reach, it stops at the nearest it can get; on real images it lands within 5% and keeps the limits in proportion.');
  const fake = (p, k) => (f) => ({ count: Math.max(1, Math.round(k * f ** -p)) });
  for (const [p, k, target] of [[2, 1000, 300], [2.6, 5000, 120], [1.4, 200, 900]]) {
    const r = aimFor(fake(p, k), target);
    check(`count ${k}·f^-${p}, aiming for ${target}`, Math.abs(r.seg.count - target) <= tolerance(target) && r.tries <= 6, `${r.seg.count} at ×${num(r.f)} in ${r.tries} tries`);
  }
  const out = aimFor(fake(2, 1000), 10 ** 6);
  check('out of reach: stops at the scale limit with the nearest count', out.f <= 0.1 + 1e-9 && out.tries <= 7, `${out.seg.count} at ×${num(out.f)}`);
  const sd = scaledDetail({ cleanup: 0.5, minWidth: 2, minArea: 8, edgeSmooth: 0.4 }, 1.5);
  check('the limits scale in proportion (the area by f²)', Math.abs(sd.minWidth - 3) < 1e-12 && Math.abs(sd.minArea - 18) < 1e-12 && Math.abs(sd.cleanup - 0.75) < 1e-12);

  // a patchwork with plenty of structure: 400 cells of 8 colors, a little noise
  const rand = mkRand(21);
  const sites = Array.from({ length: 400 }, () => [rand() * 600, rand() * 450, Math.floor(rand() * 8)]);
  const COL = [[220, 60, 50], [240, 200, 60], [60, 150, 70], [40, 90, 200], [150, 70, 160], [240, 240, 235], [30, 30, 35], [200, 130, 80]];
  const patch = makeRGBA(600, 450, (x, y) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < sites.length; i++) { const d = (x - sites[i][0]) ** 2 + (y - sites[i][1]) ** 2; if (d < bd) { bd = d; bi = i; } }
    return COL[sites[bi][2]].map((v) => v + (rand() - 0.5) * 20);
  });
  const base = { widthMm: 300, precision: 'rough', autoN: 8 };
  for (const target of [80, 250]) {
    const plan = runPipeline(patch, { ...base, targetOn: true, target });
    check(`patchwork: aiming for ${target} regions lands within 5%`, Math.abs(plan.stats.regions - target) <= tolerance(target),
      `${plan.stats.regions} regions at ×${num(plan.detail.f)} in ${plan.detail.tries} tries`);
  }
  const rings = runPipeline(generateSample('rings').color, { ...base, targetOn: true, target: 2000 });
  check('a simple image cannot reach a large target: the nearest count, and a note saying so', rings.notes.some((n) => /as near 2000/.test(n)), `${rings.stats.regions} regions`);
  const off = runPipeline(generateSample('rings').color, base);
  check('off, the limits are used as they are', off.detail.f === 1 && off.detail.tries === 1);
}
