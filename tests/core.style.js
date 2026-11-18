import { section, check, num, makeRGBA, mkRand } from './runner.js';
import { applyStyle, defaultStyle, normalizeStyle, chainOf, median8, FILTERS } from '../src/core/style.js';

const only = (id, params = {}) => {
  const st = defaultStyle();
  for (const f of FILTERS) st.on[f.id] = f.id === id;
  Object.assign(st.params[id], params);
  return st;
};

export function run() {
  section('core.style', 'The Style chain. Predictions: an empty chain returns the image itself; the median (sliding histogram) equals a brute-force median, removes salt noise and keeps an edge; sharpen steepens an edge; blur leaves a flat image flat; a style read from a file is cleaned.');
  const img = makeRGBA(60, 40, (x) => (x < 30 ? [40, 60, 80] : [200, 190, 170]));
  const none = defaultStyle();
  none.on.kuwahara = false;
  check('an empty chain returns the very same image', applyStyle(img, none, 60) === img);

  const rand = mkRand(9);
  const w = 37, h = 23, src = new Uint8ClampedArray(w * h).map(() => Math.floor(rand() * 256));
  let bad = 0;
  for (const r of [1, 2, 4]) {
    const m = median8(src, w, h, r);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const win = [];
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) win.push(src[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))]);
        win.sort((a, b) => a - b);
        if (win[(win.length - 1) / 2] !== m[y * w + x]) bad++;
      }
    }
  }
  check('median: the sliding histogram equals a brute-force median', bad === 0, `${bad} pixels differ`);

  const noisy = makeRGBA(60, 40, (x, y) => (rand() < 0.05 ? [255, 255, 255] : x < 30 ? [40, 60, 80] : [200, 190, 170]));
  const med = applyStyle(noisy, only('median', { radius: 2 }), 60);   // 2 px at 1 px/mm
  // (white salt next to the edge counts as the light side, so it may tip an edge pixel)
  let diff = 0, edge = 0;
  for (let i = 0; i < img.data.length; i++) {
    if (med.data[i] === img.data[i]) continue;
    if (Math.abs(((i / 4) % 60) - 29.5) > 1) diff++; else edge++;
  }
  check('median: 5% salt noise removed, away from the edge', diff === 0, `${diff} channel values differ; ${edge} at the edge itself`);

  const sh = applyStyle(img, only('sharpen', { radius: 2, amount: 1 }), 60);
  const at = (im, x) => im.data[4 * (20 * 60 + x)];
  check('sharpen: darker just before the edge, lighter just after', at(sh, 29) < at(img, 29) && at(sh, 30) > at(img, 30) && at(sh, 5) === at(img, 5),
    `${at(img, 29)}→${at(sh, 29)}, ${at(img, 30)}→${at(sh, 30)}`);
  const flat = makeRGBA(30, 30, () => [90, 120, 150]);
  const bl = applyStyle(flat, only('blur', { radius: 3 }), 30);
  check('blur: a flat image stays flat', bl.data.every((v, i) => Math.abs(v - flat.data[i]) <= 1));
  const cl = applyStyle(makeRGBA(80, 80, (x) => [100 + (x % 8), 100 + (x % 8), 100 + (x % 8)]), only('clahe', { tileSize: 20 }), 80);
  let lo = 255, hi = 0;
  for (let i = 0; i < cl.data.length; i += 4) { lo = Math.min(lo, cl.data[i]); hi = Math.max(hi, cl.data[i]); }
  check('local contrast spreads a narrow band of tones (at least doubles it, within its limit)', hi - lo >= 14, `range 7 → ${hi - lo}`);

  const { style, problems } = normalizeStyle({ order: ['kuwahara', 'nope', 'blur'], on: { blur: true }, params: { blur: { radius: 99 }, kuwahara: { size: 3 } } });
  check('a style from a file: unknown filters dropped, every filter kept once, bad values reset',
    style.order.length === FILTERS.length && style.order[0] === 'kuwahara' && style.order[1] === 'blur' &&
    style.params.blur.radius === 1 && style.params.kuwahara.size === 3 && problems.length === 1,
    `${style.order.join(' ')}; ${problems.join('; ')}`);
  check('the chain runs only the ticked filters, in order', chainOf(style).map((f) => f.id).join() === 'kuwahara,blur');
  void num;
}
