import { section, check, makeLabels, mkRand } from './runner.js';
import { nearestColors, majoritySmooth } from '../src/core/quantize.js';

export function run() {
  section('core.quantize', 'Nearest palette color, and the majority clean-up. Predictions: salt-and-pepper noise goes, a straight boundary does not move.');
  const lab = Float32Array.from([0.1, 0, 0, 0.9, 0.05, 0, 0.52, 0, 0]);
  const got = nearestColors(lab, [[0, 0, 0], [1, 0, 0], [0.5, 0, 0.01]]);
  check('each pixel takes the nearest color', got.join() === '0,1,2', got.join());

  const w = 80, h = 60, rand = mkRand(3);
  const clean = makeLabels(w, h, (x) => (x < 37 ? 0 : 1));
  const noisy = Uint16Array.from(clean, (v) => (rand() < 0.08 ? 2 : v));
  const sm = majoritySmooth(noisy, w, h, 3, 1.5);
  let wrong = 0;
  for (let i = 0; i < w * h; i++) if (sm[i] !== clean[i]) wrong++;
  check('8% noise of a third color is removed', wrong === 0, `${wrong} pixels differ from the clean map`);
  const corner = makeLabels(w, h, (x, y) => (x < 40 && y < 30 ? 1 : 0));
  const cs = majoritySmooth(corner, w, h, 2, 2);
  let moved = 0;
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i / w) | 0;
    if (cs[i] !== corner[i] && Math.hypot(x - 39.5, y - 29.5) > 4) moved++;
  }
  check('a square corner only rounds near its tip', moved === 0, `${moved} changed pixels farther than 4 px from the corner`);
  check('sigma below 0.5 changes nothing', majoritySmooth(noisy, w, h, 3, 0.3).every((v, i) => v === noisy[i]));
}
