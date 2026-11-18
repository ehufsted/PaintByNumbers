// Settings, units, canvas presets, and where the image lies on the canvas.
//
// EVERYTHING INSIDE IS MILLIMETERS. Inches exist only at the app's edges: the
// fields a person types into and the numbers shown back. `toMm` / `fromMm` are
// the only conversions, so a design made in inches is the same design as one made
// in the equivalent millimeters (the harness checks it).
//
// THE IMAGE ON THE CANVAS. The canvas is widthMm wide. Its height is the image's
// aspect at that width, unless heightMm is given, in which case the image is
// scaled to COVER the canvas and centred (the parts outside are cropped, never
// stretched). `imageRect` says where the whole image lies, in mm, and may reach
// past the canvas on two sides. (Copied from Photo2Mosaic's pieceGeometry.)

import { toLinear, toEncoded, luminance } from './color.js';

export const MM_PER_IN = 25.4;
export const toMm = (v, units) => (units === 'in' ? v * MM_PER_IN : v);
export const fromMm = (v, units) => (units === 'in' ? v / MM_PER_IN : v);

/** A length for a note: '20 mm' or '0.787 in'. */
export const lenText = (mm, units) => (units === 'in'
  ? `${Math.round((mm / MM_PER_IN) * 1000) / 1000} in`
  : `${Math.round(mm * 100) / 100} mm`);

/** A length as a bare number in the units, for a field. */
export const fmtLen = (mm, units, dp = 2) => {
  const v = fromMm(mm, units);
  return String(Math.round(v * 10 ** dp) / 10 ** dp);
};

/**
 * Common canvas sizes for paint-by-numbers kits, long side by short side, mm.
 * The app turns a preset to the image's orientation.
 */
export const PRESETS = [
  { id: '8x10', label: '8 × 10 in', long: 254, short: 203.2 },
  { id: '11x14', label: '11 × 14 in', long: 355.6, short: 279.4 },
  { id: '12x16', label: '12 × 16 in', long: 406.4, short: 304.8 },
  { id: '16x20', label: '16 × 20 in', long: 508, short: 406.4 },
  { id: '30x40', label: '30 × 40 cm', long: 400, short: 300 },
  { id: '40x50', label: '40 × 50 cm', long: 500, short: 400 },
];

/** Working resolution: the long side of the work raster, px. */
export const PRECISION = { draft: 1000, normal: 1600, fine: 2400 };

export const DEFAULTS = {
  widthMm: 400,
  heightMm: 0,           // 0 = from the image's aspect
  units: 'mm',           // only for the lengths in notes; every number here is mm
  precision: 'normal',
  gamma: 1,
  brightness: 1,
  saturation: 1,
  // the palette (core/palette.js)
  paletteMode: 'auto',   // 'auto': N colors from the image | 'custom': `colors`
  autoN: 16,
  colors: [],            // [{hex, name}]
  order: 'light',        // numbering: 'light' (lightest is 1) | 'list' (as listed)
  // the level of detail
  simplify: 1.5,         // mm, the Kuwahara brush diameter before matching colors; 0 = off
  cleanup: 0.6,          // mm, sigma of the majority smoothing of the color map; 0 = off
  minWidth: 2.5,         // mm, the narrowest a region (or any part of one) may be
  minArea: 10,           // mm², the smallest region
  edgeSmooth: 0.6,       // mm, sigma of the smoothing along each boundary
  // the numbers (core/labels.js)
  minFont: 1.6,          // mm, the smallest number printed inside a region
  maxFont: 4,            // mm, the largest
  lineWidth: 0.25,       // mm: numbers keep half of it clear of the line
};

/**
 * The canvas size and the image's place on it.
 * @param {{width:number, height:number}} img
 * @returns {{W:number, H:number, imageRect:{x,y,w,h}}}
 */
export function pieceGeometry(img, s) {
  const W = s.widthMm;
  const auto = !(s.heightMm > 0);
  const H = auto ? (W * img.height) / img.width : s.heightMm;
  const scale = Math.max(W / img.width, H / img.height);
  const w = img.width * scale, h = img.height * scale;
  return { W, H, imageRect: { x: (W - w) / 2, y: (H - h) / 2, w, h } };
}

/**
 * Gamma, brightness and saturation, applied to the RAW pixels before anything
 * else, so the palette, the regions and the Source view all see the result.
 * Copied from Photo2Mosaic (from HalftoneCuttable): gamma is a darkness curve on
 * the encoded value, brightness a multiplier in linear light, saturation a move
 * toward or away from the pixel's own luminance. Returns `rgba` itself at the
 * defaults.
 */
export function applyTone(rgba, gamma = 1, brightness = 1, saturation = 1) {
  if (gamma === 1 && brightness === 1 && saturation === 1) return rgba;
  const { width: w, height: h, data } = rgba;
  const n = w * h;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = toLinear(1 - Math.pow(1 - i / 255, gamma));
  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0, q = 0; i < n; i++, q += 4) {
    let r = lut[data[q]], g = lut[data[q + 1]], b = lut[data[q + 2]];
    if (saturation !== 1) {
      const y = luminance(r, g, b);
      r = y + saturation * (r - y); g = y + saturation * (g - y); b = y + saturation * (b - y);
    }
    out[q] = 255 * toEncoded(clamp(r * brightness));
    out[q + 1] = 255 * toEncoded(clamp(g * brightness));
    out[q + 2] = 255 * toEncoded(clamp(b * brightness));
    out[q + 3] = data[q + 3];
  }
  return { width: w, height: h, data: out };
}
