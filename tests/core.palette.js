import { section, check, num, makeRGBA } from './runner.js';
import { autoPalette, numberPalette, closePairs, hexLab } from '../src/core/palette.js';
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

  const cols = [{ hex: '#333333' }, { hex: '#eeeeee' }, { hex: '#888888' }];
  const light = numberPalette(cols, 'light');
  check('light order: lightest is 1', light.map((p) => p.hex).join() === '#eeeeee,#888888,#333333' && light[0].num === 1 && light[2].num === 3);
  const list = numberPalette(cols, 'list');
  check('list order keeps the list', list.map((p) => p.hex).join() === '#333333,#eeeeee,#888888' && list.map((p) => p.from).join() === '0,1,2');
  const close = closePairs(numberPalette([{ hex: '#808080' }, { hex: '#828282' }, { hex: '#000000' }]));
  check('two near-identical greys are flagged, black is not', close.length === 1 && close[0].dE < 3, close.map((c) => num(c.dE, 2)).join(', '));
}
