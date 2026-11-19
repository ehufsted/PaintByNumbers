// SVG writers: the printable pattern and the painted result, at true size.
//
// MILLIMETERS WITH A MATCHING viewBox, so a file prints and imports at its true
// size. The pattern draws EVERY BOUNDARY ONCE, from the plan's chains (two
// neighbours share one line, never two), then the numbers, and for a number
// placed outside its region, the leader line and a dot inside it.
//
// INK. Lines and numbers are grey, set by a darkness from 0 (white) to 1
// (black): paint has to cover them, and a light grey line is covered by one coat
// of even a pale color where black shows through. Numbers can be darker than the
// lines, to stay readable at small sizes.

import { gridSVG, gridFont } from './grid.js';

const NS = 'http://www.w3.org/2000/svg';
export const FONT = 'Arial, Helvetica, sans-serif';

/**
 * A number is centred on its point by its BASELINE, not by dominant-baseline,
 * which Illustrator, cutter software and some Inkscape versions ignore (they
 * would set every number a third of its height too high). Digits are about
 * 0.72 em tall (core/labels.js), so the baseline is 0.36 em below the centre.
 */
export const BASELINE = 0.36;

export const fmt = (v, dp = 3) => {
  if (!isFinite(v)) return '0';
  const s = v.toFixed(dp);
  const t = s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
  return t === '-0' ? '0' : t;
};

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Grey of a darkness 0 (white) .. 1 (black), as '#rrggbb'. */
export function inkHex(dark) {
  const v = Math.round(255 * (1 - Math.max(0, Math.min(1, dark))));
  const h = v.toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}

/** Path data of a region: every ring, closed (fill it with fill-rule evenodd). */
export function regionPathD(rings) {
  let d = '';
  for (const p of rings) {
    for (let i = 0; i < p.length; i += 2) d += `${i ? 'L' : 'M'}${fmt(p[i])} ${fmt(p[i + 1])}`;
    d += 'Z';
  }
  return d;
}

/**
 * Gradient fills as <defs>: one linearGradient per blend region, in canvas mm
 * (userSpaceOnUse), from its c0 paint to its c1 paint. `fillOf` names a
 * region's fill: its paint, or url(#pbn-g<i>).
 */
export function gradientDefs(plan) {
  const out = [];
  plan.regions.forEach((r, i) => {
    const f = r.fill;
    if (!f || f.type !== 'gradient') return;
    out.push(`<linearGradient id="pbn-g${i}" gradientUnits="userSpaceOnUse" x1="${fmt(f.x0)}" y1="${fmt(f.y0)}" x2="${fmt(f.x1)}" y2="${fmt(f.y1)}">` +
      `<stop offset="0" stop-color="${plan.palette[f.c0].hex}"/><stop offset="1" stop-color="${plan.palette[f.c1].hex}"/></linearGradient>`);
  });
  return out.length ? `<defs>${out.join('')}</defs>` : '';
}
export const fillOf = (plan, r, i) => (r.fill && r.fill.type === 'gradient' ? `url(#pbn-g${i})` : plan.palette[r.c].hex);

/** Path data of a chain. */
export function chainPathD(c) {
  let d = '';
  for (let i = 0; i < c.pts.length; i += 2) d += `${i ? 'L' : 'M'}${fmt(c.pts[i])} ${fmt(c.pts[i + 1])}`;
  return c.closed ? `${d}Z` : d;
}

/** Pattern display settings, with defaults. */
export const PATTERN = { lineWidth: 0.25, lineDark: 0.45, numDark: 0.6, numbers: true, color: false, cssVars: false };

/**
 * Presentation as SVG attributes: [prop, value, custom property] triples. With
 * cssVars (the printout only) they become one style reading each custom
 * property, the value as its fallback: custom properties inherit into <use>, so
 * one copy of the pattern can be shown grey at its own sizes on the 1:1 pages
 * and black, with a floor on line width and number size, on the scaled views.
 * Lengths (`px` true) are user units, so the style multiplies by 1px (one user
 * unit). Exported SVGs keep plain attributes, which every editor reads.
 */
const attrs = (cssVars, list) => (cssVars
  ? `style="${list.map(([prop, v, name, px]) => (px ? `${prop}:calc(var(${name},${v})*1px)` : `${prop}:var(${name},${v})`)).join(';')}"`
  : list.map(([prop, v]) => `${prop}="${v}"`).join(' '));

/**
 * The pattern's elements (no <svg> wrapper): optional color fills, the boundary
 * lines, and the numbers with their leaders. patternLines and patternNumbers are
 * its two halves, which the printout uses apart (1:1 pages may leave the
 * numbers off).
 */
export function patternBody(plan, o = {}) {
  const p = { ...PATTERN, ...o };
  return patternLines(plan, p) + (p.numbers ? `\n${patternNumbers(plan, p)}` : '');
}

export function patternLines(plan, o = {}) {
  const p = { ...PATTERN, ...o };
  const out = [];
  if (p.color) {
    out.push(gradientDefs(plan), '<g id="fills" stroke="none" fill-rule="evenodd">');
    plan.regions.forEach((r, i) => out.push(`<path d="${regionPathD(r.rings)}" fill="${fillOf(plan, r, i)}"/>`));
    out.push('</g>');
  }
  const a = attrs(p.cssVars, [['stroke', inkHex(p.lineDark), '--pbn-line'], ['stroke-width', fmt(p.lineWidth), '--pbn-lw', true]]);
  out.push(`<g id="lines" fill="none" ${a} stroke-linejoin="round" stroke-linecap="round">`);
  for (const c of plan.chains) out.push(`<path d="${chainPathD(c)}"/>`);
  out.push('</g>');
  return out.join('\n');
}

export function patternNumbers(plan, o = {}) {
  const p = { ...PATTERN, ...o };
  const num = inkHex(p.numDark);
  const out = [];
  const lw = Math.max(0.08, 0.6 * p.lineWidth);
  const dot = Math.max(0.2, 1.2 * lw);
  out.push(`<g id="leaders" ${attrs(p.cssVars, [['stroke', num, '--pbn-num'], ['fill', num, '--pbn-num'], ['stroke-width', fmt(lw), '--pbn-llw', true]])}>`);
  for (const r of plan.regions) {
    const l = r.label;
    if (l.second) {
      // a blend: a dashed line between its two numbers
      const [a, b] = blendLine(l, l.second);
      if (a) out.push(`<path d="M${fmt(a[0])} ${fmt(a[1])}L${fmt(b[0])} ${fmt(b[1])}" fill="none" stroke-dasharray="${fmt(3 * lw)} ${fmt(2 * lw)}"/>`);
    }
    if (!l.leader) continue;
    const [x0, y0] = leaderStart(l);
    out.push(`<path d="M${fmt(x0)} ${fmt(y0)}L${fmt(l.leader.x)} ${fmt(l.leader.y)}"/>`,
      `<circle cx="${fmt(l.leader.x)}" cy="${fmt(l.leader.y)}" ${attrs(p.cssVars, [['r', fmt(dot), '--pbn-dot', true]])} stroke="none"/>`);
  }
  out.push('</g>');
  // every number is one size (core/labels.js), so with cssVars it is set once,
  // on the group, where a view can raise it
  const fs = plan.regions.length ? plan.regions[0].label.size : 2;
  const uniform = p.cssVars && plan.regions.every((r) => r.label.size === fs);
  const grp = uniform ? attrs(true, [['fill', num, '--pbn-num'], ['font-size', fmt(fs, 2), '--pbn-fs', true]]) : attrs(p.cssVars, [['fill', num, '--pbn-num']]);
  out.push(`<g id="numbers" font-family="${FONT}" text-anchor="middle" ${grp}>`);
  for (const r of plan.regions) {
    const l = r.label;
    // with the size a CSS variable (the printout), the offset is in em so it follows a raised size
    for (const q of l.second ? [l, l.second] : [l]) {
      const pos = uniform ? `y="${fmt(q.y)}" dy="${BASELINE}em"` : `y="${fmt(q.y + BASELINE * q.size)}" font-size="${fmt(q.size, 2)}"`;
      out.push(`<text x="${fmt(q.x)}" ${pos}>${escapeXml(q.text)}</text>`);
    }
  }
  out.push('</g>');
  return out.join('\n');
}

/** A blend's dashed line: from the edge of one number's circle to the other's; [null] when they touch. */
export function blendLine(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  const ra = 0.7 * a.size, rb = 0.7 * b.size;
  if (d <= ra + rb) return [null, null];
  return [[a.x + (dx / d) * ra, a.y + (dy / d) * ra], [b.x - (dx / d) * rb, b.y - (dy / d) * rb]];
}

/** Where a leader line leaves its number: the edge of the number's circle, toward the dot. */
export function leaderStart(l) {
  const dx = l.leader.x - l.x, dy = l.leader.y - l.y, d = Math.hypot(dx, dy) || 1;
  const r = 0.55 * l.size;
  return [l.x + (dx / d) * r, l.y + (dy / d) * r];
}

const wrap = (plan, title, body) => {
  const { W, H } = plan.piece;
  return [
    `<svg xmlns="${NS}" version="1.1" width="${fmt(W)}mm" height="${fmt(H)}mm" viewBox="0 0 ${fmt(W)} ${fmt(H)}">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="#ffffff"/>`,
    body,
    '</svg>',
  ].join('\n');
};

/** The printable pattern at true size; `grid` (mm, 0 = none) adds the pencil transfer grid. */
export function patternSVG(plan, o = {}) {
  const { W, H } = plan.piece;
  const grid = o.grid > 0 ? `\n${gridSVG(W, H, o.grid, { x0: 0, y0: 0, x1: W, y1: H }, { fs: gridFont(o.grid), lw: 0.15 })}` : '';
  return wrap(plan, o.title || 'paint by numbers', patternBody(plan, o) + grid);
}

/** The painted result at true size: every region in its color, optionally numbered. */
export function paintedSVG(plan, o = {}) {
  const parts = [gradientDefs(plan), '<g id="fills" fill-rule="evenodd" stroke-linejoin="round">'];
  // each region stroked thinly in its own color as well, so no hairline of
  // background shows between neighbours where a renderer anti-aliases both edges
  plan.regions.forEach((r, i) => {
    const c = fillOf(plan, r, i);
    parts.push(`<path d="${regionPathD(r.rings)}" fill="${c}" stroke="${c}" stroke-width="0.1"/>`);
  });
  parts.push('</g>');
  return wrap(plan, o.title || 'painted', parts.join('\n'));
}

/** Trigger a download of any text. The only DOM-touching function in core/. */
export function downloadFile(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
