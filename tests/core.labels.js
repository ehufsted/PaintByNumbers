import { section, check, num } from './runner.js';
import { polylabel, placeLabels, fitFont, halfDiag } from '../src/core/labels.js';
import { inRings, ringsDist } from '../src/core/geom.js';

const rect = (x0, y0, x1, y1) => [x0, y0, x0, y1, x1, y1, x1, y0];
const circle = (cx, cy, r, n = 64) => {
  const p = [];
  for (let i = 0; i < n; i++) p.push(cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n));
  return p;
};

export function run() {
  section('core.labels', 'Where numbers go. Predictions: a square\'s number sits at its centre; a ring\'s in the ring, not the hole; a number fits its region\'s largest circle; a region too small for the smallest number gets it outside, on a leader, clear of every other number.');
  const sq = polylabel([rect(0, 0, 10, 10)], 0.01);
  check('square: the centre, 5 from every side', Math.hypot(sq.x - 5, sq.y - 5) < 0.05 && Math.abs(sq.d - 5) < 0.02, `(${num(sq.x)}, ${num(sq.y)}) d ${num(sq.d)}`);
  const ann = [circle(0, 0, 10), circle(0, 0, 6).reverse()];
  const an = polylabel(ann, 0.01);
  const rr = Math.hypot(an.x, an.y);
  check('annulus 6-10: in the ring, 2 from both edges', rr > 7.8 && rr < 8.2 && Math.abs(an.d - 2) < 0.05, `radius ${num(rr)}, d ${num(an.d)}`);
  const L = [[0, 0, 0, 30, 30, 30, 30, 20, 10, 20, 10, 0]];
  const lp = polylabel(L, 0.01);
  check('L shape: inside, in the corner block', inRings(lp.x, lp.y, L) && Math.abs(lp.d - ringsDist(lp.x, lp.y, L)) < 1e-9 && lp.d > 4.9, `d ${num(lp.d)}`);

  check('fitFont and halfDiag agree (95% of the radius)', [1, 2, 3].every((n) => Math.abs(halfDiag(n, fitFont(n, 4)) - 0.95 * 4) < 1e-9));

  // a big region with a tiny one in it; the clearance is exact distance to either boundary
  const big = [rect(0, 0, 60, 40)];
  const tiny = [rect(30, 19, 31.5, 20.5)];
  const bigWithHole = [...big, tiny[0].slice()];
  const regions = [{ rings: bigWithHole, num: 1 }, { rings: tiny, num: 12 }];
  const clearance = (x, y) => Math.min(Math.abs(ringsDist(x, y, big)), Math.abs(ringsDist(x, y, tiny)));
  const o = { minFont: 2, maxFont: 5, lineWidth: 0.3, W: 60, H: 40, clearance };
  const ls = placeLabels(regions, o);
  check('the big region gets the largest size', ls[0].size === 5 && !ls[0].leader, `size ${num(ls[0].size)}`);
  const t = ls[1];
  check('the tiny region gets a leader', !!t.leader && t.size === 2 && !t.crowded);
  if (t.leader) {
    check('its leader dot is inside it', inRings(t.leader.x, t.leader.y, tiny));
    const r = halfDiag(2, 2);
    check('its number is outside it, with room', !inRings(t.x, t.y, tiny) && clearance(t.x, t.y) >= r, `clearance ${num(clearance(t.x, t.y))} for a half-diagonal ${num(r)}`);
    const gap = Math.hypot(t.x - ls[0].x, t.y - ls[0].y) - r - halfDiag(1, ls[0].size);
    check('and clear of the big region\'s number', gap > 0, `gap ${num(gap)} mm`);
  }
  const noRoom = placeLabels(regions, { ...o, clearance: () => 0 });
  check('with no room anywhere it stays inside, marked crowded', noRoom[1].crowded && !noRoom[1].leader);
}
