import { section, check, makeLabels, blobLabels } from './runner.js';
import { enforceWidth, enforceArea, regionsOf, segment, boundaryMask } from '../src/core/segment.js';
import { opening, components } from '../src/core/edt.js';

/** OKLab per pixel straight from a palette, so a region's mean is its color. */
const labOf = (labels, pal) => {
  const out = new Float32Array(3 * labels.length);
  labels.forEach((v, i) => { out[3 * i] = pal[v][0]; out[3 * i + 1] = pal[v][1]; out[3 * i + 2] = pal[v][2]; });
  return out;
};

export function run() {
  section('core.segment', 'The detail limits. Predictions: a line narrower than the minimum width vanishes into the regions either side; a thin tail leaves its blob; a small region joins the neighbour nearest its color; after both, no region is under the area limit and none is thinner than the width.');
  const w = 90, h = 60;
  // two halves crossed by a 3 px line of a third color
  const line = makeLabels(w, h, (x, y) => (Math.abs(y - 30) <= 1 ? 2 : x < 45 ? 0 : 1));
  const a = enforceWidth(line, w, h, 4);
  const left = a.labels.filter((v) => v === 2).length;
  check('a 3 px line under an 8 px minimum width vanishes', left === 0, `${left} line pixels left`);
  let shifted = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(y - 30) > 1 && a.labels[y * w + x] !== line[y * w + x]) shifted++;
  check('the halves either side are untouched', shifted === 0, `${shifted} pixels off the line changed`);

  // a 20 px disc with a 2 px tail, on a background
  const tail = makeLabels(w, h, (x, y) => (Math.hypot(x - 30, y - 30) < 12 || (x >= 30 && x < 80 && Math.abs(y - 30) < 1) ? 1 : 0));
  const t = enforceWidth(tail, w, h, 4);
  const tailLeft = t.labels.filter((v, i) => v === 1 && (i % w) > 46).length;
  const disc = t.labels.filter((v, i) => v === 1 && Math.hypot((i % w) - 30, ((i / w) | 0) - 30) < 9).length;
  const discRef = tail.filter((v, i) => Math.hypot((i % w) - 30, ((i / w) | 0) - 30) < 9).length;
  check('a thin tail leaves its disc', tailLeft === 0, `${tailLeft} tail pixels left`);
  check('the disc itself stays', disc === discRef, `${disc} of ${discRef}`);

  // small squares: one surrounded (only one neighbour), one between two colors
  const pal = [[0.2, 0, 0], [0.8, 0, 0], [0.5, 0.1, 0], [0.75, 0, 0.01]];
  const sq = makeLabels(w, h, (x, y) => {
    if (x >= 10 && x < 13 && y >= 10 && y < 13) return 3;   // inside region 0: must go to 0
    if (x >= 43 && x < 47 && y >= 40 && y < 44) return 3;   // on the 0|1 seam, color near 1: must go to 1
    return x < 45 ? 0 : 1;
  });
  const m = enforceArea(sq, w, h, labOf(sq, pal), pal, 30);
  check('a small region inside one neighbour joins it', m.labels[11 * w + 11] === 0, `became ${m.labels[11 * w + 11]}`);
  check('a small region between two joins the nearer color', m.labels[41 * w + 44] === 1 && m.labels[41 * w + 43] === 1, `became ${m.labels[41 * w + 44]}, ${m.labels[41 * w + 43]}`);
  check('nothing else changes', m.merged === 2, `${m.merged} merges`);

  // a noisy blob map through both limits
  const K = 6;
  const pal6 = Array.from({ length: K }, (_, k) => [k / K, 0.05 * Math.cos(k), 0.05 * Math.sin(k)]);
  const blobs = blobLabels(160, 120, K, 40, 0.06, 11);
  const minW = 6, minA = 60;
  const seg = segment(blobs, 160, 120, labOf(blobs, pal6), pal6, { minWidthPx: minW, minAreaPx: minA });
  const { id, count } = regionsOf(seg.colors, 160, 120);
  const sizes = new Array(count).fill(0);
  for (const v of id) sizes[v]++;
  check('the region ids are the 4-connected regions of the colors', count === seg.count && id.every((v, i) => v === seg.region[i]));
  check(`no region under ${minA} px`, Math.min(...sizes) >= minA, `smallest ${Math.min(...sizes)} px of ${count} regions`);
  // width: an opening a pixel under the limit rounds every corner (a few pixels
  // each, whatever the shape), but a sliver would come off as a long piece
  const rOpen = minW / 2 - 1;
  let worst = 0, removed = 0;
  for (let k = 0; k < K; k++) {
    const mk = Uint8Array.from(seg.colors, (v) => (v === k ? 1 : 0));
    const op = opening(mk, 160, 120, rOpen);
    const off = Uint8Array.from(mk, (v, i) => (v && !op[i] ? 1 : 0));
    const c = components(off, 160, 120);
    for (const n of c.sizes) { worst = Math.max(worst, n); removed += n; }
  }
  check('no sliver: what an opening a pixel under the limit removes is only corners', worst <= 3 * rOpen * rOpen,
    `largest piece removed ${worst} px (a corner is up to about ${3 * rOpen * rOpen}); ${removed} px in all`);
  check('every boundary pixel has a neighbour of another color', boundaryMask(seg.colors, 160, 120).some((v) => v));
}
