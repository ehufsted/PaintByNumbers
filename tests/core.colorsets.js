import { section, check, num } from './runner.js';
import { COLOR_SETS, colorSet } from '../src/core/colorsets.js';
import { normalizeHex } from '../src/core/color.js';
import { hexLab, closePairs, numberPalette } from '../src/core/palette.js';

export function run() {
  section('core.colorsets', 'The predefined color sets. Predictions: every color is a valid hex with a unique name in its set; the 16-crayon box is the 8 plus 8; the greys are evenly spaced in lightness from white to black; no set has two colors too alike to tell apart.');
  const sizes = Object.fromEntries(COLOR_SETS.map((s) => [s.id, s.colors.length]));
  check('set sizes', JSON.stringify(sizes) === JSON.stringify({ minimal: 5, primaries: 5, crayons8: 8, crayons16: 16, greys: 7, artist: 12, earth: 12 }), JSON.stringify(sizes));
  const bad = COLOR_SETS.flatMap((s) => s.colors.filter((c) => normalizeHex(c.hex) !== c.hex).map((c) => `${s.id}:${c.hex}`));
  check('every color is a valid lower-case hex', bad.length === 0, bad.join(' '));
  const dupNames = COLOR_SETS.filter((s) => new Set(s.colors.map((c) => c.name)).size !== s.colors.length).map((s) => s.id);
  check('names are unique within each set', dupNames.length === 0, dupNames.join(' '));
  const c8 = colorSet('crayons8'), c16 = colorSet('crayons16');
  check('the 16-crayon box starts with the 8', c8.every((c, i) => c.hex === c16[i].hex && c.name === c16[i].name));
  const L = colorSet('greys').map((c) => hexLab(c.hex)[0]);
  const steps = L.slice(1).map((v, i) => L[i] - v);
  check('greys: white to black in even lightness steps', Math.abs(L[0] - 1) < 1e-3 && Math.abs(L[6]) < 1e-3 && Math.max(...steps) - Math.min(...steps) < 0.01,
    `steps ${steps.map((s) => num(s, 3)).join(' ')}`);
  const close = COLOR_SETS.map((s) => [s.id, closePairs(numberPalette(s.colors)).length]).filter(([, n]) => n);
  check('no set has two colors under 3 ΔE apart', close.length === 0, close.map(([id, n]) => `${id}: ${n}`).join(', '));
  const copy = colorSet('minimal');
  copy[0].hex = '#123456';
  check('a set is handed out as a copy', colorSet('minimal')[0].hex === '#ff0000');
}
