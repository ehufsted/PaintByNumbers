import { section, check, num } from './runner.js';
import { runPipeline } from '../src/pipeline.js';
import { generateSample } from '../src/app/samples.js';
import { patternSVG, paintedSVG, inkHex } from '../src/core/svg.js';
import { planHTML, pageWindows, OVERLAP } from '../src/core/printout.js';
import { projectJSON, parseProject } from '../src/core/project.js';
import { DEFAULTS } from '../src/core/units.js';

export function run() {
  section('core.output', 'The pattern and painted SVGs, the printable page, and project files. Predictions: the SVGs are true size in mm with every boundary drawn once; the 1:1 pages overlap and cover the pattern; a project round-trips its settings and refuses what is not one.');
  const plan = runPipeline(generateSample('rings').color, { widthMm: 150, precision: 'draft', autoN: 6 });
  const { W, H } = plan.piece;
  const svg = patternSVG(plan, { lineWidth: 0.3, lineDark: 0.5, numDark: 1, numbers: true });
  check('pattern SVG is true size', svg.includes(`width="${W}mm"`) && svg.includes(`viewBox="0 0 ${W} ${H}"`));
  const lines = svg.split('<g id="lines"')[1].split('</g>')[0].match(/<path /g).length;
  check('every boundary is one path, drawn once', lines === plan.chains.length, `${lines} paths, ${plan.chains.length} chains`);
  const texts = (svg.match(/<text /g) || []).length;
  check('one number per region', texts === plan.regions.length, `${texts} numbers, ${plan.regions.length} regions`);
  check('ink greys from darkness', inkHex(0) === '#ffffff' && inkHex(1) === '#000000' && inkHex(0.5) === '#808080' && svg.includes('stroke="#808080"'));
  check('numbers off leaves none', !patternSVG(plan, { numbers: false }).includes('<text '));
  const painted = paintedSVG(plan);
  check('painted SVG: one filled path per region', (painted.match(/<path /g) || []).length === plan.regions.length);

  const pw = pageWindows(500, 300, 195.9, 242.4);
  let gapOk = true;
  const xs = [...new Set(pw.windows.map((w) => w.x0))].sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    const prev = pw.windows.find((w) => w.x0 === xs[i - 1]);
    if (prev.x1 - xs[i] < OVERLAP - 1e-9) gapOk = false;
  }
  check('1:1 pages overlap by at least the overlap and cover the pattern', gapOk && Math.min(...pw.windows.map((w) => w.x0)) === 0 && Math.abs(Math.max(...pw.windows.map((w) => w.x1)) - 500) < 1e-9,
    `${pw.cols} Ã— ${pw.rows} pages`);
  const html = planHTML(plan, { paper: 'a4', fit: true });
  const pages = (html.match(/class="page"/g) || []).length;
  const win = pageWindows(W, H, 190, 297 - 20 - 9 - 8);
  check('the printout has the summary, the fit page and every 1:1 page', pages === 2 + win.windows.length, `${pages} pages`);
  check('the pattern is written once and shown through &lt;use&gt;', (html.match(/id="pbn-pattern"/g) || []).length === 1 && html.includes('href="#pbn-pattern"'));

  const s = { ...DEFAULTS, paletteMode: 'custom', colors: [{ hex: '#112233', name: 'navy' }], minWidth: 3.3, order: 'list' };
  const text = projectJSON({ image: { kind: 'sample', name: 'rings' }, units: 'in', settings: s, display: { lineDark: 0.3, numDark: 0.9, numbers: false, coverage: 2 } });
  const back = parseProject(text);
  check('a project round-trips', back.problems.length === 0 && JSON.stringify(back.project.settings) === JSON.stringify(s) &&
    back.project.units === 'in' && back.project.display.numbers === false && back.project.image.name === 'rings', back.problems.join('; '));
  const bad = parseProject({ app: 'PaintByNumbers', version: 1, image: { kind: 'sample', name: 'x' }, settings: { minWidth: -2, colors: [{ hex: 'zz' }], paletteMode: 'custom' } });
  check('bad values fall back, with reasons', bad.project.settings.minWidth === DEFAULTS.minWidth && bad.project.settings.paletteMode === 'auto' && bad.problems.length === 3, bad.problems.join('; '));
  let threw = '';
  try { parseProject({ app: 'Photo2Mosaic', version: 1 }); } catch (e) { threw = e.message; }
  check('another app\'s file is refused', /not a PaintByNumbers project/.test(threw), threw);
  try { parseProject({ app: 'PaintByNumbers', version: 99 }); } catch (e) { threw = e.message; }
  check('a newer version is refused', /newer version/.test(threw), threw);
  void num;
}
