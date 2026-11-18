// Copied from HalftoneCuttable's core/features.js: only the three helpers
// core/steer.js needs (the Kuwahara pre-filter's direction field). The rest of
// that file (edge points, region labels for the Voronoi web) is not used here.

import { makeImage, blurGaussian } from '../shim/image.js';

export function blur(im, sigma) {
  if (!(sigma > 0.3)) return im;
  return blurGaussian(im, 2 * Math.ceil(2.5 * sigma) + 1, sigma);
}

/** Bilinear sample of a w×h field at (x, y) in pixel-index coordinates, clamped to it. */
export function bilerp(F, w, h, x, y) {
  x = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = x | 0, y0 = y | 0, x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  return (F[y0 * w + x0] * (1 - fx) + F[y0 * w + x1] * fx) * (1 - fy) +
    (F[y1 * w + x0] * (1 - fx) + F[y1 * w + x1] * fx) * fy;
}

/** Central-difference gradient of a w×h field, clamped (Neumann) edges. */
export function centralGradient(u, w, h) {
  const ux = new Float64Array(w * h), uy = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : 0, yd = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0, xr = x < w - 1 ? x + 1 : w - 1;
      ux[y * w + x] = (u[y * w + xr] - u[y * w + xl]) / 2;
      uy[y * w + x] = (u[yd * w + x] - u[yu * w + x]) / 2;
    }
  }
  return { ux, uy };
}
