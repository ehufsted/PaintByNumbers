import { section, check, num } from './runner.js';
import { runPipeline } from '../src/pipeline.js';
import { generateSample } from '../src/app/samples.js';
import { patternSVG, paintedSVG, inkHex } from '../src/core/svg.js';
import { planHTML, pageWindows, OVERLAP, printable, PAPERS, MIN_LINE, MIN_FONT } from '../src/core/printout.js';
import { projectJSON, parseProject } from '../src/core/project.js';
import { DEFAULTS } from '../src/core/units.js';
import { defaultStyle } from '../src/core/style.js';

export function run() {
  section('core.output', 'The pattern and painted SVGs, the printable page, and project files. Predictions: the SVGs are true size in mm with every boundary drawn once; the 1:1 pages overlap and cover the pattern; a project round-trips its settings and refuses what is not one.');
  const plan = runPipeline(generateSample('rings').color, { widthMm: 150, precision: 'draft', autoN: 6 });
  const { W, H } = plan.piece;
  const html0 = () => planHTML(plan, { paper: 'a4', fit: true });
  const svg = patternSVG(plan, { lineWidth: 0.3, lineDark: 0.5, numDark: 1, numbers: true });
  check('pattern SVG is true size', svg.includes(`width="${W}mm"`) && svg.includes(`viewBox="0 0 ${W} ${H}"`));
  const lines = svg.split('<g id="lines"')[1].split('</g>')[0].match(/<path /g).length;
  check('every boundary is one path, drawn once', lines === plan.chains.length, `${lines} paths, ${plan.chains.length} chains`);
  const texts = (svg.match(/<text /g) || []).length;
  check('one number per region', texts === plan.regions.length, `${texts} numbers, ${plan.regions.length} regions`);
  check('ink greys from darkness', inkHex(0) === '#ffffff' && inkHex(1) === '#000000' && inkHex(0.5) === '#808080' && svg.includes('stroke="#808080"'));
  const t0 = plan.regions[0].label, m0 = svg.match(/<text x="([0-9.]+)" y="([0-9.]+)"/);
  check('numbers are placed by their baseline (no dominant-baseline, which editors ignore)',
    !svg.includes('dominant-baseline') && Math.abs(parseFloat(m0[2]) - (t0.y + 0.36 * t0.size)) < 2e-3, `y ${m0[2]} for a centre at ${t0.y}`);
  check('the printout offsets them in em, so a raised size stays centred', html0().includes('dy="0.36em"'));
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
  check('the pattern is written once and shown through &lt;use&gt;', (html.match(/id="pbn-lines"/g) || []).length === 1 && (html.match(/id="pbn-numbers"/g) || []).length === 1);
  const pageUses = (h) => h.split('class="page"').slice(1).map((pg) => pg.includes('#pbn-numbers'));
  const off = pageUses(html), on = pageUses(planHTML(plan, { paper: 'a4', fit: true, numbers1to1: true }));
  check('by default the 1:1 pages have no numbers; the summary and fit page do', off[0] && off[1] && off.slice(2).every((v) => !v), off.join());
  check('asked for, the 1:1 pages have them too', on.every((v) => v), on.join());
  const pg = html.split('class="page"').slice(1);
  const black = pg.map((p) => p.includes('--pbn-line:#000000;--pbn-num:#000000;'));
  check('the summary\'s pattern and the fit page print black; the 1:1 pages keep the greys', black[0] && black[1] && black.slice(2).every((v) => !v), black.join());
  check('the printout\'s inks fall back to the pattern\'s greys', html.includes('stroke:var(--pbn-line,#') && html.includes('fill:var(--pbn-num,#'));
  check('exported SVGs keep plain color attributes', !svg.includes('var('));
  // the fit page's scale, and the sizes it asks for
  const room = printable(PAPERS.a4), k = Math.min(room.w / W, (room.h + 8) / H);
  const fitStyle = pg[1].match(/style="(--pbn-line[^"]*)"/)[1];
  const v = (name) => parseFloat(fitStyle.match(new RegExp(`${name}:([0-9.]+)`))[1]);
  check('the fit page: lines at least MIN_LINE and numbers at least MIN_FONT as printed',
    v('--pbn-lw') * k >= MIN_LINE - 1e-3 && v('--pbn-fs') * k >= MIN_FONT - 1e-2 && v('--pbn-fs') >= plan.regions[0].label.size,
    `line ${num(v('--pbn-lw') * k)} mm, number ${num(v('--pbn-fs') * k)} mm on paper (scale ${num(k)})`);
  check('the printout sets the number size once, on the group', !/<text [^>]*font-size/.test(html.split('id="pbn-numbers"')[1].split('</defs>')[0]) && html.includes('font-size:calc(var(--pbn-fs,'));

  const style = defaultStyle();
  style.on.median = true; style.params.median.radius = 1.2; style.order.reverse();
  const s = { ...DEFAULTS, paletteMode: 'custom', colors: [{ hex: '#112233', name: 'navy' }], minWidth: 3.3, order: 'list', mergeOn: false, style };
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
