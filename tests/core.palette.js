import { section, check, num, makeRGBA } from './runner.js';
import { autoPalette, numberPalette, closePairs, hexLab, mergeClusters } from '../src/core/palette.js';
import { deltaE } from '../src/core/color.js';

export function run() {
  section('core.palette', 'Colors from the image (k-means in OKLab, seeded), numbering light to dark, and the close-colors warning. Prediction: four flat quadrants give back their four colors.');
  const Q = [[230, 40, 40], [40, 160, 60], [30, 50, 200], [240, 230, 200]];
  const img = makeRGBA(60, 40, (x, y) => Q[(x < 30 ? 0 : 1) + (y < 20 ? 0 : 2)]);
  const pal = autoPalette(img, 4);
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const miss = Q.map((c) => Math.min(...pal.map((p) => deltaE(hexLab(p.hex), hexLab(hex(c))))));
  check('four quadrants give their four colors', pal.length === 4 && Math.max(...miss) < 1, `worst ΔE ${num(Math.max(...miss), 2)}`);
  check('shares sum to 1, largest first', Math.abs(pal.reduce((a, p) => a + p.share, 0) - 1) < 1e-9 && pal.every((p, i) => i === 0 || p.share <= pal[i - 1].share));
  check('the same image gives the same palette', JSON.stringify(autoPalette(img, 4)) === JSON.stringify(pal));
  const flat = autoPalette(makeRGBA(10, 10, () => [100, 100, 100]), 6);
  check('a flat image asked for 6 colors gives 1', flat.length === 1, `${flat.length}`);

  // merging: two big near-identical colors and three small distinct ones
  const S = [[200, 60, 50, 0.4], [203, 63, 52, 0.4], [40, 120, 200, 0.07], [60, 170, 70, 0.07], [240, 220, 90, 0.06]];
  const stripes = makeRGBA(200, 50, (x) => {
    let t = x / 200;
    for (const c of S) { if (t < c[3]) return c; t -= c[3]; }
    return S[4];
  });
  const merged = autoPalette(stripes, 4, 1, 4);
  const labs = merged.map((p) => hexLab(p.hex));
  let minGap = Infinity;
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) minGap = Math.min(minGap, deltaE(labs[i], labs[j]));
  const small = S.slice(2).map((c) => Math.min(...labs.map((l) => deltaE(l, hexLab(hex(c.slice(0, 3)))))));
  check('merging: 4 colors, every two at least 4 ΔE apart', merged.length === 4 && minGap >= 3.9, `${merged.length} colors, closest ${num(minGap, 2)}`);
  check('merging: the freed slot goes to the small distinct colors', Math.max(...small) < 2, `worst ${num(Math.max(...small), 2)} ΔE`);
  const mc = mergeClusters({ centers: [[0.5, 0, 0], [0.51, 0, 0], [0.9, 0, 0]], mass: [0.25, 0.75, 0] }, 4);
  check('mergeClusters: a close pair becomes its weighted mean', mc.centers.length === 2 && Math.abs(mc.centers[0][0] - 0.5075) < 1e-12);
  // fewer distinct colors than asked: the refill gives up instead of running to 3N
  let seedN = 7;
  const rnd = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
  const twoTone = makeRGBA(200, 100, (x) => (x < 100 ? [60, 60, 70] : [200, 190, 170]).map((v) => v + (rnd() - 0.5) * 16));
  const t0 = Date.now();
  const tt = autoPalette(twoTone, 40, 1, 4);
  check('two tones with noise, 40 asked: their 2 colors, without running on to 3N clusters', tt.length === 2 && Date.now() - t0 < 2000, `${tt.length} colors in ${Date.now() - t0} ms`);
  const flat4 = autoPalette(makeRGBA(10, 10, () => [100, 100, 100]), 4, 1, 4);
  check('merging on a flat image still gives its one color', flat4.length === 1);

  const cols = [{ hex: '#333333' }, { hex: '#eeeeee' }, { hex: '#888888' }];
  const light = numberPalette(cols, 'light');
  check('light order: lightest is 1', light.map((p) => p.hex).join() === '#eeeeee,#888888,#333333' && light[0].num === 1 && light[2].num === 3);
  const list = numberPalette(cols, 'list');
  check('list order keeps the list', list.map((p) => p.hex).join() === '#333333,#eeeeee,#888888' && list.map((p) => p.from).join() === '0,1,2');
  const close = closePairs(numberPalette([{ hex: '#808080' }, { hex: '#828282' }, { hex: '#000000' }]));
  check('two near-identical greys are flagged, black is not', close.length === 1 && close[0].dE < 3, close.map((c) => num(c.dE, 2)).join(', '));
}
