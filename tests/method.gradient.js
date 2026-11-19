import { section, check, num, makeRGBA, coverage, randomPoints } from './runner.js';
import { runPipeline } from '../src/pipeline.js';
import { paintedSVG, patternSVG } from '../src/core/svg.js';
import { inRings } from '../src/core/geom.js';
import { generateSample } from '../src/app/samples.js';

export function run() {
  section('method.gradient', 'Flat + gradients. Predictions: a smooth ramp, which flat color cuts into bands, becomes blends between neighbouring paints running along the ramp; two flat halves with a hard edge stay flat; with blends the regions still tile and every number is in its region.');
  const ramp = makeRGBA(400, 200, (x) => { const v = 30 + (200 * x) / 399; return [v, v * 0.9, v * 0.7]; });
  const base = { widthMm: 200, precision: 'rough', autoN: 6, style: { order: [], on: {}, params: {} } };
  const flat = runPipeline(ramp, base);
  const grad = runPipeline(ramp, { ...base, methodId: 'gradient' });
  const blends = grad.regions.filter((r) => r.fill.type === 'gradient');
  check('a ramp: blends, fewer regions than flat bands', blends.length >= 1 && grad.regions.length < flat.regions.length,
    `${flat.regions.length} flat regions → ${grad.regions.length} with ${blends.length} blends`);
  const along = blends.every((r) => Math.abs(r.fill.x1 - r.fill.x0) > 5 * Math.abs(r.fill.y1 - r.fill.y0) && r.fill.x0 > r.fill.x1);   // the ramp is light on the right
  check('each blend runs along the ramp, from its lighter paint (c0, on the right) to its darker', along && blends.every((r) => r.fill.c0 < r.fill.c1),
    blends.map((r) => `${num(r.fill.x0, 0)}→${num(r.fill.x1, 0)}`).join(' '));
  const nums = (r) => [r.label, ...(r.label.chain || [])];
  check('a blend is numbered with each of its colors, in order, each inside it', blends.every((r) => nums(r).length === r.fill.stops.length &&
    nums(r).every((q, k) => inRings(q.x, q.y, r.rings) && q.text === String(grad.palette[r.fill.stops[k].c].num))));
  check('a blend\u2019s consecutive numbers do not touch', blends.every((r) => nums(r).every((q, k, a) => !k || Math.hypot(q.x - a[k - 1].x, q.y - a[k - 1].y) > 1.6 * q.size)));
  check('blending lowers the error against the image', grad.stats.meanDE < flat.stats.meanDE, `mean ΔE ${num(flat.stats.meanDE, 2)} flat → ${num(grad.stats.meanDE, 2)}`);
  const cov = coverage(grad.regions, randomPoints(2000, grad.piece.W, grad.piece.H, 9));
  check('with blends the regions still tile the canvas', cov.one === 2000, `${cov.none} in none, ${cov.many} in two+`);
  check('painted SVG fills each blend with a gradient', (paintedSVG(grad).match(/<(linear|radial)Gradient /g) || []).length === blends.length);
  check('the pattern draws a dashed line between each blend\u2019s consecutive numbers', (patternSVG(grad).match(/stroke-dasharray/g) || []).length === blends.reduce((a, r) => a + r.fill.stops.length - 1, 0));

  // the sphere: shading through many paints, round a highlight
  const sphere = generateSample('sphere').color;
  const sb = { widthMm: 300, precision: 'rough', autoN: 16 };
  const sph = (p) => runPipeline(sphere, { ...sb, methodId: 'gradient', methodParams: { gradient: p } });
  const two = sph({ maxPaints: 2, radial: false, strictness: 'strict' });
  const many = sph({});
  const kinds = many.regions.filter((r) => r.fill.type === 'gradient');
  const share = (pl) => pl.regions.filter((r) => r.fill.type === 'gradient').reduce((a, r) => a + r.area, 0) / (pl.piece.W * pl.piece.H);
  check('the sphere: multi-paint and round blends cover more of it than two-paint straight ones', share(many) > share(two) + 0.05 &&
    kinds.some((r) => r.fill.stops.length > 2) && kinds.some((r) => r.fill.shape === 'radial'),
    `${num(100 * share(two), 0)}% → ${num(100 * share(many), 0)}% blended: ${kinds.length} blends, ${kinds.filter((r) => r.fill.stops.length > 2).length} through 3+ paints, ${kinds.filter((r) => r.fill.shape === 'radial').length} round`);
  const counts = ['strict', 'normal', 'loose'].map((k) => sph({ strictness: k }).stats.gradients);
  check('looser strictness keeps at least as many blends', counts[0] <= counts[1] && counts[1] <= counts[2], counts.join(' ≤ '));
  const covS = coverage(many.regions, randomPoints(2000, many.piece.W, many.piece.H, 12));
  check('the sphere with blends still tiles', covS.one === 2000);
  const allNums = many.regions.every((r) => [r.label, ...(r.label.chain || [])].every((q) => inRings(q.x, q.y, r.rings) || q === r.label && r.label.leader));
  check('every blend number is inside its region', allNums);

  const edge = makeRGBA(400, 200, (x) => (x < 200 ? [40, 60, 120] : [230, 200, 80]));
  const e = runPipeline(edge, { ...base, autoN: 2, methodId: 'gradient' });
  check('two flat halves with a hard edge stay flat', e.regions.every((r) => r.fill.type === 'solid') && e.stats.gradients === 0, `${e.stats.gradients} blends`);
  const unknown = runPipeline(edge, { ...base, autoN: 2, methodId: 'nope' });
  check('an unknown method falls back to flat color', unknown.method === 'flat');
}
