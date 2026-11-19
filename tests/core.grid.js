import { section, check } from './runner.js';
import { gridLetters, gridLines, gridLabels, gridSVG } from '../src/core/grid.js';
import { planHTML, pageWindows, printable, PAPERS } from '../src/core/printout.js';
import { patternSVG } from '../src/core/svg.js';
import { runPipeline } from '../src/pipeline.js';
import { generateSample } from '../src/app/samples.js';

export function run() {
  section('core.grid', 'The pencil transfer grid. Predictions: rows run A..Z, AA..; columns 1, 2, 3; the grid starts at the canvas corner, so every split page labels the squares it shows the same way the canvas does.');
  check('row letters', [0, 1, 25, 26, 27, 51, 52, 701, 702].map(gridLetters).join() === 'A,B,Z,AA,AB,AZ,BA,ZZ,AAA');
  const g = gridLines(100, 60, 25);
  check('lines at multiples of the spacing, none on the edges', g.xs.join() === '25,50,75' && g.ys.join() === '25,50' && g.cols === 4 && g.rows === 3);
  const all = gridLabels(100, 60, 25, { x0: 0, y0: 0, x1: 100, y1: 60 });
  check('one label per column and row, at the square centres', all.cols.map((c) => `${c.text}@${c.x}`).join() === '1@12.5,2@37.5,3@62.5,4@87.5' &&
    all.rows.map((r) => `${r.text}@${r.y}`).join() === 'A@12.5,B@37.5,C@55', JSON.stringify(all));
  const right = gridLabels(100, 60, 25, { x0: 45, y0: 30, x1: 100, y1: 60 });
  check('a window labels only the squares whose centres it shows', right.cols.map((c) => c.text).join() === '3,4' && right.rows.map((r) => r.text).join() === 'B,C');
  const svg = gridSVG(100, 60, 25, { x0: 0, y0: 0, x1: 100, y1: 60 }, { fs: 3, lw: 0.15 });
  check('grid SVG: 5 lines and 7 labels', (svg.match(/<path /g) || []).length === 5 && (svg.match(/<text /g) || []).length === 7);

  const plan = runPipeline(generateSample('rings').color, { widthMm: 500, precision: 'rough', autoN: 6 });
  const { W, H } = plan.piece;
  check('Pattern SVG carries the grid when asked, not otherwise', patternSVG(plan, { grid: 25 }).includes('class="grid"') && !patternSVG(plan, {}).includes('class="grid"'));
  const html = planHTML(plan, { paper: 'letter', fit: true, grid: 25 });
  const pages = html.split('class="page"').slice(1);
  const room = printable(PAPERS.letter);
  const pw = pageWindows(W, H, room.w, room.h);
  check('the grid is on the fit page and every 1:1 page, not the summary', !pages[0].includes('class="grid"') && pages.slice(1).every((p) => p.includes('class="grid"')) && pages.length === 2 + pw.windows.length,
    `${pages.length} pages`);
  const c2 = pages[2 + 1];   // the second 1:1 page: the window right of the first
  const lab = gridLabels(W, H, 25, pw.windows[1]);
  check('a split page labels its own squares', lab.cols.length > 0 && lab.cols.every((c) => c2.includes(`>${c.text}</text>`)) && pw.windows[1].x0 > 0, `columns ${lab.cols.map((c) => c.text).join(' ')}`);
}
