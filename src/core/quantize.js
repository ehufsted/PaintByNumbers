// Every pixel to a palette color, and the first clean-up of the color map.
//
// NEAREST IN OKLab, NO DITHER. A paint-by-numbers region is one flat color, so a
// pixel simply takes the palette color it looks most like. Dithering would trade
// a color error for a speckle of one-pixel regions, every one of which the
// detail limits would then have to remove again.
//
// MAJORITY SMOOTHING. Where two colors are about equally near (a soft gradient,
// sensor noise, JPEG blocks) the raw map is a salt-and-pepper of both. Each
// pixel instead takes the color that is most common around it, weighted by a
// Gaussian of sigma `cleanup`: the map's one-hot planes are blurred and the
// largest wins. That removes the speckle and rounds jagged edges without moving
// a straight boundary (on either side of one, the majority is its own color).
// The blur is three box passes (a close Gaussian, at a cost independent of
// sigma), and runs only over each color's bounding box grown by the kernel.

/**
 * @param {Float32Array} lab  interleaved OKLab, 3 per pixel
 * @param {number[][]} pal    OKLab per palette entry
 * @returns {Uint16Array} palette index per pixel
 */
export function nearestColors(lab, pal) {
  const n = lab.length / 3, K = pal.length;
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const L = lab[3 * i], a = lab[3 * i + 1], b = lab[3 * i + 2];
    let best = 0, bd = Infinity;
    for (let k = 0; k < K; k++) {
      const p = pal[k];
      const d = (L - p[0]) ** 2 + (a - p[1]) ** 2 + (b - p[2]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    out[i] = best;
  }
  return out;
}

/** Box widths for three passes approximating a Gaussian of sigma (Kovesi). */
function boxRadii(sigma) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  return [0, 1, 2].map((i) => ((i < m ? wl : wu) - 1) / 2);
}

/** One horizontal box pass of radius r over rows y0..y1, columns x0..x1 (clamped at the window's ends). */
function boxH(src, dst, w, x0, x1, y0, y1, r) {
  const n = 2 * r + 1;
  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(x1, Math.max(x0, x0 + k))];
    for (let x = x0; x <= x1; x++) {
      dst[row + x] = acc / n;
      acc += src[row + Math.min(x1, x + r + 1)] - src[row + Math.max(x0, x - r)];
    }
  }
}

function boxV(src, dst, w, x0, x1, y0, y1, r) {
  const n = 2 * r + 1;
  for (let x = x0; x <= x1; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[Math.min(y1, Math.max(y0, y0 + k)) * w + x];
    for (let y = y0; y <= y1; y++) {
      dst[y * w + x] = acc / n;
      acc += src[Math.min(y1, y + r + 1) * w + x] - src[Math.max(y0, y - r) * w + x];
    }
  }
}

/**
 * The Gaussian-weighted majority color around every pixel.
 * @param {Uint16Array} labels  palette index per pixel
 * @param {number} sigma        px; below 0.5 nothing changes
 * @returns {Uint16Array} a new map
 */
export function majoritySmooth(labels, w, h, K, sigma) {
  if (!(sigma >= 0.5)) return Uint16Array.from(labels);
  const radii = boxRadii(sigma);
  const reach = radii.reduce((a, r) => a + r, 0);
  // each color's bounding box
  const box = Array.from({ length: K }, () => [w, h, -1, -1]);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const b = box[labels[i]];
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
    }
  }
  const best = new Float32Array(w * h).fill(-1);
  const out = Uint16Array.from(labels);
  const A = new Float32Array(w * h), B = new Float32Array(w * h);
  for (let k = 0; k < K; k++) {
    if (box[k][2] < 0) continue;
    const x0 = Math.max(0, box[k][0] - reach), y0 = Math.max(0, box[k][1] - reach);
    const x1 = Math.min(w - 1, box[k][2] + reach), y1 = Math.min(h - 1, box[k][3] + reach);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) A[y * w + x] = labels[y * w + x] === k ? 1 : 0;
    for (const r of radii) {
      if (r < 1) continue;
      boxH(A, B, w, x0, x1, y0, y1, r);
      boxV(B, A, w, x0, x1, y0, y1, r);
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        // strictly greater: a tie keeps the color met first (the lower index),
        // so the result does not depend on floating-point noise between equals
        if (A[i] > best[i] + 1e-6) { best[i] = A[i]; out[i] = k; }
      }
    }
  }
  return out;
}
