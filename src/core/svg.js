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

const NS = 'http://www.w3.org/2000/svg';
export const FONT = 'Arial, Helvetica, sans-serif';

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

/** Path data of a chain. */
export function chainPathD(c) {
  let d = '';
  for (let i = 0; i < c.pts.length; i += 2) d += `${i ? 'L' : 'M'}${fmt(c.pts[i])} ${fmt(c.pts[i + 1])}`;
  return c.closed ? `${d}Z` : d;
}

/** Pattern display settings, with defaults. */
export const PATTERN = { lineWidth: 0.25, lineDark: 0.45, numDark: 0.6, numbers: true, color: false };

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
    out.push('<g id="fills" stroke="none" fill-rule="evenodd">');
    for (const r of plan.regions) out.push(`<path d="${regionPathD(r.rings)}" fill="${plan.palette[r.c].hex}"/>`);
    out.push('</g>');
  }
  out.push(`<g id="lines" fill="none" stroke="${inkHex(p.lineDark)}" stroke-width="${fmt(p.lineWidth)}" stroke-linejoin="round" stroke-linecap="round">`);
  for (const c of plan.chains) out.push(`<path d="${chainPathD(c)}"/>`);
  out.push('</g>');
  return out.join('\n');
}

export function patternNumbers(plan, o = {}) {
  const p = { ...PATTERN, ...o };
  const num = inkHex(p.numDark);
  const out = [];
  const lw = Math.max(0.08, 0.6 * p.lineWidth);
  out.push(`<g id="leaders" stroke="${num}" stroke-width="${fmt(lw)}" fill="${num}">`);
  for (const r of plan.regions) {
    const l = r.label;
    if (!l.leader) continue;
    const [x0, y0] = leaderStart(l);
    out.push(`<path d="M${fmt(x0)} ${fmt(y0)}L${fmt(l.leader.x)} ${fmt(l.leader.y)}"/>`,
      `<circle cx="${fmt(l.leader.x)}" cy="${fmt(l.leader.y)}" r="${fmt(Math.max(0.2, 1.2 * lw))}" stroke="none"/>`);
  }
  out.push('</g>');
  out.push(`<g id="numbers" font-family="${FONT}" text-anchor="middle" dominant-baseline="central" fill="${num}">`);
  for (const r of plan.regions) {
    const l = r.label;
    out.push(`<text x="${fmt(l.x)}" y="${fmt(l.y)}" font-size="${fmt(l.size, 2)}">${escapeXml(l.text)}</text>`);
  }
  out.push('</g>');
  return out.join('\n');
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

/** The printable pattern at true size. */
export function patternSVG(plan, o = {}) {
  return wrap(plan, o.title || 'paint by numbers', patternBody(plan, o));
}

/** The painted result at true size: every region in its color, optionally numbered. */
export function paintedSVG(plan, o = {}) {
  const parts = ['<g id="fills" fill-rule="evenodd" stroke-linejoin="round">'];
  // each region stroked thinly in its own color as well, so no hairline of
  // background shows between neighbours where a renderer anti-aliases both edges
  for (const r of plan.regions) {
    const c = plan.palette[r.c].hex;
    parts.push(`<path d="${regionPathD(r.rings)}" fill="${c}" stroke="${c}" stroke-width="0.1"/>`);
  }
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
