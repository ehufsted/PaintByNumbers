import { section, check, num, makeRGBA, coverage, randomPoints } from './runner.js';
import { runPipeline } from '../src/pipeline.js';
import { paintedSVG, patternSVG } from '../src/core/svg.js';
import { inRings } from '../src/core/geom.js';

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
  check('a blend is numbered with both its colors, each inside it', blends.every((r) => r.label.second &&
    inRings(r.label.x, r.label.y, r.rings) && inRings(r.label.second.x, r.label.second.y, r.rings) &&
    r.label.text === String(grad.palette[r.fill.c0].num) && r.label.second.text === String(grad.palette[r.fill.c1].num)));
  check('the two numbers of a blend do not touch', blends.every((r) => Math.hypot(r.label.x - r.label.second.x, r.label.y - r.label.second.y) > 1.6 * r.label.size));
  check('blending lowers the error against the image', grad.stats.meanDE < flat.stats.meanDE, `mean ΔE ${num(flat.stats.meanDE, 2)} flat → ${num(grad.stats.meanDE, 2)}`);
  const cov = coverage(grad.regions, randomPoints(2000, grad.piece.W, grad.piece.H, 9));
  check('with blends the regions still tile the canvas', cov.one === 2000, `${cov.none} in none, ${cov.many} in two+`);
  check('painted SVG fills blends with a linear gradient', (paintedSVG(grad).match(/<linearGradient /g) || []).length === blends.length);
  check('the pattern draws a dashed line for each blend', (patternSVG(grad).match(/stroke-dasharray/g) || []).length === blends.filter((r) => Math.hypot(r.label.x - r.label.second.x, r.label.y - r.label.second.y) > 1.4 * r.label.size).length);

  const edge = makeRGBA(400, 200, (x) => (x < 200 ? [40, 60, 120] : [230, 200, 80]));
  const e = runPipeline(edge, { ...base, autoN: 2, methodId: 'gradient' });
  check('two flat halves with a hard edge stay flat', e.regions.every((r) => r.fill.type === 'solid') && e.stats.gradients === 0, `${e.stats.gradients} blends`);
  const unknown = runPipeline(edge, { ...base, autoN: 2, methodId: 'nope' });
  check('an unknown method falls back to flat color', unknown.method === 'flat');
}
