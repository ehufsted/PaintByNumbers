// Geometry on regions: a region is a list of rings (flat [x, y, ...] arrays,
// closing point not repeated), its outline and its holes, read EVEN-ODD: a point
// is inside when a ray from it crosses the rings an odd number of times. That
// needs no ring to know whether it is a hole, so it holds for any region the
// planar map (core/planar.js) puts together.

/** Even-odd point-in-region. */
export function inRings(x, y, rings) {
  let inside = false;
  for (const p of rings) {
    const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Squared distance from (x, y) to segment a-b. */
export function segDist2(x, y, ax, ay, bx, by) {
  let dx = bx - ax, dy = by - ay;
  if (dx !== 0 || dy !== 0) {
    const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) { ax = bx; ay = by; } else if (t > 0) { ax += dx * t; ay += dy * t; }
  }
  dx = x - ax; dy = y - ay;
  return dx * dx + dy * dy;
}

/** Signed distance to the region's boundary: positive inside, negative outside. */
export function ringsDist(x, y, rings) {
  let inside = false, min = Infinity;
  for (const p of rings) {
    const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      const d = segDist2(x, y, xi, yi, xj, yj);
      if (d < min) min = d;
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(min);
}

/** [x0, y0, x1, y1] over every ring. */
export function ringsBox(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of rings) {
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
    }
  }
  return [x0, y0, x1, y1];
}

/** Area of a region (outline less holes): the absolute shoelace of each ring, holes subtracted by sign. */
export function ringsArea(rings) {
  let s = 0;
  for (const p of rings) {
    const n = p.length / 2;
    let a = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) a += p[2 * j] * p[2 * i + 1] - p[2 * i] * p[2 * j + 1];
    s += a / 2;
  }
  return Math.abs(s);
}
