// The work raster: the canvas as a grid of square-ish pixels, the image resampled
// onto it, and the conversions every later stage works in.
//
// ONE GRID FOR EVERYTHING. The color map, the detail limits and the boundaries
// are all found on this grid, and only then turned into shapes in mm
// (core/planar.js), so its pixel size is the finest detail the design can hold.
// It is set by the canvas's long side and the precision (units.js PRECISION),
// not by the image: a small image on a big canvas is upsampled, a huge one
// averaged down.
//
// Resampling is an AREA AVERAGE in linear light where a grid pixel covers more
// than one image pixel (so fine texture averages to the color the eye sees), and
// bilinear where it covers less.

import { LINEAR_LUT, toEncoded, rgbToOKLab } from './color.js';

/**
 * @param {{width, height, data}} rgba  the toned image
 * @param {{W, H, imageRect}} geo        units.js pieceGeometry
 * @param {number} longPx                the grid's long side, px
 * @returns {{w, h, sx, sy, rgba}}       sx, sy: mm per grid pixel; rgba encoded, w×h
 */
export function workRaster(rgba, geo, longPx) {
  const { W, H, imageRect: R } = geo;
  const p = Math.max(W, H) / Math.max(8, longPx);
  const w = Math.max(2, Math.round(W / p)), h = Math.max(2, Math.round(H / p));
  const sx = W / w, sy = H / h;
  const iw = rgba.width, ih = rgba.height, src = rgba.data;
  // image px per grid px
  const kx = (sx * iw) / R.w, ky = (sy * ih) / R.h;
  const out = new Uint8ClampedArray(w * h * 4);
  const shrink = kx > 1 || ky > 1;
  let integ = null;
  if (shrink) {
    // summed-area tables of the linear channels
    integ = [0, 1, 2].map(() => new Float64Array((iw + 1) * (ih + 1)));
    for (let y = 0; y < ih; y++) {
      const r0 = [0, 0, 0];
      for (let x = 0; x < iw; x++) {
        const q = 4 * (y * iw + x);
        for (let c = 0; c < 3; c++) {
          r0[c] += LINEAR_LUT[src[q + c]];
          integ[c][(y + 1) * (iw + 1) + x + 1] = integ[c][y * (iw + 1) + x + 1] + r0[c];
        }
      }
    }
  }
  const at = (x, y, c) => LINEAR_LUT[src[4 * (y * iw + x) + c]];
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      // the grid pixel's footprint, in image pixels
      const u0 = ((gx * sx - R.x) / R.w) * iw, u1 = (((gx + 1) * sx - R.x) / R.w) * iw;
      const v0 = ((gy * sy - R.y) / R.h) * ih, v1 = (((gy + 1) * sy - R.y) / R.h) * ih;
      const rgb = [0, 0, 0];
      if (shrink) {
        const x0 = clampI(Math.floor(u0), 0, iw - 1), x1 = clampI(Math.ceil(u1), x0 + 1, iw);
        const y0 = clampI(Math.floor(v0), 0, ih - 1), y1 = clampI(Math.ceil(v1), y0 + 1, ih);
        const n = (x1 - x0) * (y1 - y0);
        for (let c = 0; c < 3; c++) {
          const I = integ[c], s = iw + 1;
          rgb[c] = (I[y1 * s + x1] - I[y0 * s + x1] - I[y1 * s + x0] + I[y0 * s + x0]) / n;
        }
      } else {
        const u = clampF((u0 + u1) / 2 - 0.5, 0, iw - 1), v = clampF((v0 + v1) / 2 - 0.5, 0, ih - 1);
        const xa = Math.floor(u), ya = Math.floor(v), xb = Math.min(iw - 1, xa + 1), yb = Math.min(ih - 1, ya + 1);
        const fx = u - xa, fy = v - ya;
        for (let c = 0; c < 3; c++) {
          rgb[c] = (at(xa, ya, c) * (1 - fx) + at(xb, ya, c) * fx) * (1 - fy) + (at(xa, yb, c) * (1 - fx) + at(xb, yb, c) * fx) * fy;
        }
      }
      const q = 4 * (gy * w + gx);
      out[q] = 255 * toEncoded(rgb[0]); out[q + 1] = 255 * toEncoded(rgb[1]); out[q + 2] = 255 * toEncoded(rgb[2]);
      out[q + 3] = 255;
    }
  }
  return { w, h, sx, sy, rgba: { width: w, height: h, data: out } };
}

const clampI = (v, a, b) => (v < a ? a : v > b ? b : v);
const clampF = clampI;

/** Encoded RGBA -> OKLab, interleaved Float32Array(3N). */
export function toOKLab(rgba) {
  const n = rgba.width * rgba.height, d = rgba.data;
  const lab = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const q = 4 * i;
    const L = rgbToOKLab(LINEAR_LUT[d[q]], LINEAR_LUT[d[q + 1]], LINEAR_LUT[d[q + 2]]);
    lab[3 * i] = L[0]; lab[3 * i + 1] = L[1]; lab[3 * i + 2] = L[2];
  }
  return lab;
}
