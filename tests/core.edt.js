import { section, check, num, mkRand } from './runner.js';
import { edt, edtNearest } from '../src/core/edt.js';

export function run() {
  section('core.edt', 'The nearest-site transform (edtNearest) against brute force: its distance must equal edt\'s, and the site it names must be a set pixel at exactly that distance.');
  const rand = mkRand(7);
  let worstD = 0, badSite = 0, n = 0;
  for (const [w, h, p] of [[23, 17, 0.05], [40, 9, 0.01], [16, 31, 0.3]]) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = rand() < p ? 1 : 0;
    mask[Math.floor(rand() * w * h)] = 1;
    const { dist, near } = edtNearest(mask, w, h);
    const ref = edt(mask, w, h);
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = (i / w) | 0;
      let bf = Infinity;
      for (let j = 0; j < w * h; j++) if (mask[j]) bf = Math.min(bf, Math.hypot((j % w) - x, ((j / w) | 0) - y));
      worstD = Math.max(worstD, Math.abs(dist[i] - bf), Math.abs(ref[i] - bf));
      const s = near[i];
      if (!(s >= 0 && mask[s] && Math.abs(Math.hypot((s % w) - x, ((s / w) | 0) - y) - bf) < 1e-4)) badSite++;
      n++;
    }
  }
  check('distances match brute force', worstD < 1e-4, `worst error ${num(worstD, 6)} px over ${n} pixels`);
  check('every named site is set, and at the nearest distance', badSite === 0, `${badSite} bad of ${n}`);
  const empty = edtNearest(new Uint8Array(12), 4, 3);
  check('an empty mask names no site', empty.near.every((v) => v === -1));
}
