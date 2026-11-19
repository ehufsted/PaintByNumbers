// A project file: everything needed to make the same design again.
//
//   { app: 'PaintByNumbers', version, savedAt,
//     image: { kind: 'sample', name } | { kind: 'file', name, dataURL },
//     units, settings: {...units.DEFAULTS, colors: [{hex, name}], style (core/style.js)},
//     display: {lineDark, numDark, numbers, coverage, grid, gridMm} }
//
// THE PLAN IS NOT SAVED. It is deterministic (k-means is seeded), so the same
// image and settings rebuild it exactly; saving it would only make the file
// larger and let it disagree with its own settings. The IMAGE is the original
// file's bytes (a data URL), not re-encoded pixels, so a lossy re-encode cannot
// move a single boundary. A sample is saved by name. (As Photo2Mosaic's.)
//
// Loading is untrusted input: every field is checked, anything unusable is
// replaced by its default with a reason, and only a file that is not a project
// at all, or is from a newer version, is refused.

import { normalizeHex } from './color.js';
import { DEFAULTS, PRECISION } from './units.js';
import { normalizeStyle } from './style.js';

export const PROJECT_VERSION = 1;
export const APP = 'PaintByNumbers';

/** The numeric settings and their valid ranges. */
const NUMS = {
  widthMm: (x) => x > 0, heightMm: (x) => x >= 0, gamma: (x) => x > 0, brightness: (x) => x > 0,
  saturation: (x) => x >= 0, autoN: (x) => Number.isInteger(x) && x >= 1 && x <= 60, mergeDE: (x) => x >= 0,
  cleanup: (x) => x >= 0, minWidth: (x) => x >= 0, minArea: (x) => x >= 0,
  edgeSmooth: (x) => x >= 0, fontSize: (x) => x > 0, lineWidth: (x) => x >= 0,
};

export const DISPLAY = { lineDark: 0.45, numDark: 0.6, numbers: true, coverage: 1.5, grid: false, gridMm: 25 };

/** The project as JSON text. `p` is the shape above (savedAt is filled in). */
export function projectJSON(p) {
  return JSON.stringify({ app: APP, version: PROJECT_VERSION, savedAt: new Date().toISOString(), ...p }, null, 1);
}

/**
 * @param {string|object} json
 * @returns {{project: {image, units, settings, display}, problems: string[]}}
 */
export function parseProject(json) {
  let o = json;
  if (typeof o === 'string') {
    try { o = JSON.parse(o); } catch (e) { throw new Error(`not JSON: ${e.message}`); }
  }
  if (!o || typeof o !== 'object' || o.app !== APP) throw new Error('not a PaintByNumbers project');
  if (!(o.version >= 1)) throw new Error('not a PaintByNumbers project (no version)');
  if (o.version > PROJECT_VERSION) throw new Error(`made by a newer version of the app (project version ${o.version}, this app reads up to ${PROJECT_VERSION})`);
  const problems = [];

  let image = null;
  const im = o.image || {};
  if (im.kind === 'sample' && typeof im.name === 'string') image = { kind: 'sample', name: im.name };
  else if (im.kind === 'file' && typeof im.dataURL === 'string' && /^data:image\//.test(im.dataURL)) image = { kind: 'file', name: String(im.name || 'image'), dataURL: im.dataURL };
  else problems.push('no usable image in the project');

  const src = o.settings && typeof o.settings === 'object' ? { ...o.settings } : {};
  // the first saves had a smallest and largest number size: the smallest is the one size now
  if (src.fontSize === undefined && src.minFont !== undefined) src.fontSize = src.minFont;
  const settings = { ...DEFAULTS, colors: [] };
  for (const [k, ok] of Object.entries(NUMS)) {
    if (src[k] === undefined) continue;
    const x = Number(src[k]);
    if (src[k] !== null && isFinite(x) && ok(x)) settings[k] = x;
    else problems.push(`${k}: unusable, using ${DEFAULTS[k]}`);
  }
  settings.mergeOn = typeof src.mergeOn === 'boolean' ? src.mergeOn : DEFAULTS.mergeOn;
  const st = normalizeStyle(src.style);
  settings.style = st.style;
  problems.push(...st.problems);
  settings.precision = PRECISION[src.precision] ? src.precision : DEFAULTS.precision;
  settings.paletteMode = src.paletteMode === 'custom' ? 'custom' : 'auto';
  settings.order = src.order === 'list' ? 'list' : 'light';
  if (Array.isArray(src.colors)) {
    src.colors.forEach((c, i) => {
      const hex = normalizeHex(c && c.hex);
      if (hex) settings.colors.push({ hex, name: String((c && c.name) || '').slice(0, 60) });
      else problems.push(`color ${i + 1}: not a color, left out`);
    });
  }
  if (settings.paletteMode === 'custom' && !settings.colors.length) { problems.push('the custom palette is empty: colors from the image instead'); settings.paletteMode = 'auto'; }

  const d = o.display && typeof o.display === 'object' ? o.display : {};
  const unit = (v, def) => (isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1 ? Number(v) : def);
  const display = {
    lineDark: unit(d.lineDark, DISPLAY.lineDark),
    numDark: unit(d.numDark, DISPLAY.numDark),
    numbers: typeof d.numbers === 'boolean' ? d.numbers : DISPLAY.numbers,
    coverage: isFinite(Number(d.coverage)) && Number(d.coverage) > 0 ? Number(d.coverage) : DISPLAY.coverage,
    grid: typeof d.grid === 'boolean' ? d.grid : DISPLAY.grid,
    gridMm: isFinite(Number(d.gridMm)) && Number(d.gridMm) >= 2 ? Number(d.gridMm) : DISPLAY.gridMm,
  };
  return { project: { image, units: o.units === 'in' ? 'in' : 'mm', settings, display }, problems };
}
