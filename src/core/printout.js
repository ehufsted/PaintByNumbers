// The printable design: one self-contained HTML page, opened in its own window
// and saved as PDF through the browser's print dialog (so no PDF library).
// Its layout is Photo2Mosaic's printable plan.
//
//   summary   the painted preview, the color key (swatch, number, name, area,
//             a paint estimate) and how to paint it
//   fit       the whole pattern scaled to one page, as a guide
//   pattern   the pattern at 1:1, split into a grid of pages that overlap by
//             OVERLAP mm, each captioned with its place in the grid, to trace
//             or transfer onto the canvas
//
// NUMBERS. The summary's small pattern and the fit page always carry the
// numbers: they are the guide to which color goes where. The 1:1 pages carry
// them only when asked (opts.numbers1to1): a pattern traced or transferred onto
// the canvas is often wanted as bare lines, painted from the guide.
//
// INK. The 1:1 pages print in the pattern's own greys (paint has to cover
// them). The summary's small pattern and the fit page are guides read on
// paper, so they print in black on white (the inks are CSS variables, set per
// view).
//
// The pattern is written ONCE, as two hidden <svg> symbols (the lines, and the
// numbers with their leaders), and every page shows its own window of them
// through <use>, so a pattern of many pages is not copied once per page.
//
// PAGES ARE SIZED IN mm, and the 1:1 pages only stay 1:1 when printed at 100%
// ("actual size", not "fit to page"); every one carries a 50 mm bar to check that
// with a ruler. DOM-free: the app adds only the preview image's data URL.

import { patternLines, patternNumbers, fmt, escapeXml } from './svg.js';
import { fromMm } from './units.js';

export const PAPERS = {
  letter: { w: 215.9, h: 279.4, label: 'Letter' },
  a4: { w: 210, h: 297, label: 'A4' },
  tabloid: { w: 279.4, h: 431.8, label: 'Tabloid / Ledger' },
  a3: { w: 297, h: 420, label: 'A3' },
};
const MARGIN = 10;      // mm, all round
const CAPTION = 9;      // mm reserved at the top of a page for its caption
export const OVERLAP = 10;

/** The printable area of a page, mm: what pattern pages are cut to. */
export const printable = (paper) => ({ w: paper.w - 2 * MARGIN, h: paper.h - 2 * MARGIN - CAPTION - 8 });

/**
 * How a w × h pattern splits onto pages of printable pw × ph: {cols, rows, windows}.
 * Windows overlap by OVERLAP mm and together cover the pattern exactly.
 * (Copied from Photo2Mosaic.)
 */
export function pageWindows(w, h, pw, ph) {
  const split = (len, room) => {
    if (len <= room + 1e-6) return [[0, len]];
    const n = Math.ceil((len - OVERLAP) / (room - OVERLAP));
    const step = (len - room) / (n - 1);
    return [...Array(n).keys()].map((i) => [i * step, i * step + room]);
  };
  const xs = split(w, pw), ys = split(h, ph);
  const windows = [];
  ys.forEach((y, r) => xs.forEach((x, c) => windows.push({ r, c, x0: x[0], x1: x[1], y0: y[0], y1: y[1] })));
  return { cols: xs.length, rows: ys.length, windows };
}

/** '12.5' in the units, for text. */
export const fmtLen = (mm, units, dp) => {
  const v = fromMm(mm, units);
  const d = dp ?? (units === 'in' ? 2 : 0);
  return String(Math.round(v * 10 ** d) / 10 ** d);
};

/** An area in cm² or in², for text. */
export const areaText = (mm2, units) => (units === 'in'
  ? `${(mm2 / 645.16).toFixed(mm2 / 645.16 < 10 ? 1 : 0)} in²`
  : `${(mm2 / 100).toFixed(mm2 / 100 < 10 ? 1 : 0)} cm²`);

/** Paint for an area, ml, at `perHundred` ml per 100 cm². */
export const paintMl = (mm2, perHundred) => (mm2 / 10000) * perHundred;

/**
 * @param {object} plan
 * @param {{paper?:string, units?:'mm'|'in', summary?:boolean, fit?:boolean, pattern?:boolean,
 *          numbers1to1?:boolean, previewURL?:string, title?:string, display?:object, coverage?:number}} opts
 *   display: the pattern's look (svg.js PATTERN; its numbers flag is not used here);
 *   numbers1to1: numbers on the 1:1 pages too; coverage: ml of paint per 100 cm²
 */
export function planHTML(plan, opts = {}) {
  const paper = PAPERS[opts.paper] || PAPERS.letter;
  const units = opts.units === 'in' ? 'in' : 'mm';
  const L = (mm, dp) => fmtLen(mm, units, dp);
  const room = printable(paper);
  const title = opts.title || 'Paint by numbers';
  const { W, H } = plan.piece;
  const display = { ...(opts.display || {}), color: false, cssVars: true };
  const pages = [];
  const page = (caption, body) => pages.push(
    `<section class="page"><div class="cap">${escapeXml(caption)}</div><div class="body">${body}</div></section>`);
  const BLACK = '--pbn-line:#000000;--pbn-num:#000000;';
  const view = (x0, y0, w, h, css, numbers = true) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x0)} ${fmt(y0)} ${fmt(w)} ${fmt(h)}" style="${css}"><use href="#pbn-lines"/>` +
    `${numbers ? '<use href="#pbn-numbers"/>' : ''}</svg>`;
  const bar = '<svg class="bar" width="70mm" height="6mm" viewBox="0 0 70 6"><path d="M0 3h50M0 1v4M50 1v4" stroke="#000" stroke-width="0.3" fill="none"/>' +
    '<text x="52" y="4.2" font-size="3" font-family="Arial, Helvetica, sans-serif">50 mm</text></svg>';

  if (opts.summary !== false) {
    const used = plan.palette.filter((p) => p.used);
    const cov = opts.coverage ?? 1.5;
    const rows = plan.palette.map((p) => `<tr class="${p.used ? '' : 'off'}"><td class="n">${p.num}</td>` +
      `<td><span class="sw" style="background:${p.hex}"></span></td><td>${escapeXml(p.name || '')}</td><td class="mono">${p.hex}</td>` +
      `<td class="r">${p.regions}</td><td class="r">${areaText(p.area, units)}</td>` +
      `<td class="r">${((100 * p.area) / (W * H)).toFixed(1)}%</td><td class="r">${p.used ? paintMl(p.area, cov).toFixed(1) : '—'}</td></tr>`).join('');
    const prev = opts.previewURL ? `<img class="preview" src="${opts.previewURL}" alt="painted preview">` : '';
    const notes = plan.notes.length ? `<ul class="notes">${plan.notes.map((n) => `<li>${escapeXml(n)}</li>`).join('')}</ul>` : '';
    page(title, `<h1>${escapeXml(title)}</h1>` +
      `<p>Canvas <b>${L(W)} × ${L(H)} ${units}</b> · ${plan.regions.length} regions · ${used.length} colors</p>` +
      `<div class="two">${prev}${view(0, 0, W, H, `${BLACK}width:48%;border:0.2mm solid #999`)}</div>` +
      `<table class="key"><thead><tr><th>#</th><th></th><th>Name</th><th>Color</th><th class="r">Regions</th><th class="r">Area</th><th class="r">Share</th><th class="r">Paint, ml</th></tr></thead><tbody>${rows}</tbody></table>` +
      `<p class="small">Paint estimate: ${cov} ml per 100 cm², one coat; buy more for a second coat over the lines. ` +
      'Paint light to dark, starting with 1: a darker color covers a lighter slip, not the other way round.</p>' + notes);
  }
  if (opts.fit) {
    const k = Math.min(room.w / W, (room.h + 8) / H);
    page(`${title} · whole pattern (scaled to fit)`, view(0, 0, W, H, `${BLACK}width:${fmt(W * k)}mm;height:${fmt(H * k)}mm`));
  }
  if (opts.pattern !== false) {
    const pw = pageWindows(W, H, room.w, room.h);
    for (const wd of pw.windows) {
      const w = wd.x1 - wd.x0, h = wd.y1 - wd.y0;
      const where = pw.windows.length > 1 ? ` · page ${wd.r + 1}-${wd.c + 1} of ${pw.rows} × ${pw.cols} (overlap ${OVERLAP} mm)` : '';
      page(`${title} · pattern at 1:1${where} · top ↑`,
        view(wd.x0, wd.y0, w, h, `width:${fmt(w)}mm;height:${fmt(h)}mm;outline:0.2mm dashed #bbb`, !!opts.numbers1to1) + bar);
    }
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(title)}</title><style>
@page { size: ${paper.w}mm ${paper.h}mm; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font: 10pt/1.35 Arial, Helvetica, sans-serif; color: #000; background: #888; }
.page { width: ${paper.w}mm; height: ${paper.h}mm; padding: ${MARGIN}mm; background: #fff; margin: 0 auto 6mm; overflow: hidden; page-break-after: always; }
.cap { height: ${CAPTION}mm; font-size: 8pt; color: #444; }
h1 { font-size: 15pt; margin: 0 0 2mm; }
.two { display: flex; gap: 4%; align-items: flex-start; margin: 3mm 0; }
.preview { width: 48%; border: 0.2mm solid #999; }
table.key { border-collapse: collapse; width: 100%; font-size: 9pt; }
table.key th { text-align: left; font-weight: normal; color: #555; border-bottom: 0.3mm solid #000; padding: 1mm; }
table.key td { padding: 0.8mm 1mm; border-bottom: 0.1mm solid #ccc; }
table.key tr.off td { color: #999; }
.r { text-align: right; } .n { font-weight: bold; } .mono { font-family: Consolas, monospace; }
.sw { display: inline-block; width: 9mm; height: 5mm; border: 0.2mm solid #000; vertical-align: middle; }
.small { font-size: 8pt; color: #333; } .notes { font-size: 8pt; color: #333; padding-left: 5mm; }
.bar { display: block; margin-top: 2mm; }
@media print { body { background: #fff; } .page { margin: 0; } }
</style></head><body>
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute"><defs><g id="pbn-lines">${patternLines(plan, display)}</g><g id="pbn-numbers">${patternNumbers(plan, display)}</g></defs></svg>
${pages.join('\n')}
</body></html>`;
}
