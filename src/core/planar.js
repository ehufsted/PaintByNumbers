// From a region map to shapes: the boundaries as a PLANAR MAP, each shared edge
// smoothed once.
//
// WHY NOT ONE POLYGON PER REGION. Trace and smooth each region's outline on its
// own and two neighbours smooth their common edge two different ways: slivers of
// gap and overlap appear all along it, and on a pattern every boundary prints as
// a double line. So the boundaries are found ONCE, as CHAINS between NODES, and
// each region's outline is put together from the chains around it. A chain is
// smoothed once and both regions use the same curve, so the regions tile the
// canvas exactly, however much it is smoothed (as long as no chain crosses
// another; the harness checks that).
//
// THE LATTICE. Boundaries run along pixel edges, between the corners of the
// grid: (w + 1) × (h + 1) corners. An edge is a boundary when the pixels on its
// two sides are in different regions; outside the canvas counts as region -1,
// so the canvas edge is a boundary too. A corner with 3 or 4 boundary edges is a
// NODE (three regions meet, or two meet diagonally), and a chain runs from node
// to node through corners of exactly two. A region inside another with nothing
// else touching it is bounded by one CLOSED chain with no node.
//
// LEFT AND RIGHT. A chain records the region on each side of it as walked: the
// LEFT is the side (dy, -dx) of a step (dx, dy), in the grid's y-down
// coordinates. A region's ring is its chains walked with it on the left (a
// chain with it on the right, backwards). Where a region touches itself
// diagonally at a node, the ring takes the LEFT turn: that hugs the pixel it
// came along, so diagonal pixels are not joined, which is what 4-connected
// regions (core/segment.js) mean.
//
// SMOOTHING. Each chain's points are smoothed by a Gaussian along the chain with
// its two end nodes pinned (an odd reflection about each end, which holds the
// end exactly), or around the loop for a closed chain; then simplified
// (Douglas-Peucker). Chains along the canvas edge are not smoothed (that would
// round the canvas's corners), only stripped of their collinear points.

/**
 * @param {Int32Array} region  region id per pixel, w×h
 * @returns {{chains: Array<{pts:number[], a:number, b:number, closed:boolean, n0:number, n1:number, d0:number[], d1:number[]}>,
 *            rings: Array<Array<Array<{c:number, rev:boolean}>>>}}
 *   pts: corner coordinates (grid px), flat [x, y, ...], the last point not
 *   repeated on a closed chain; a / b: region on the left / right; n0, n1: end
 *   nodes as corner indices; d0 / d1: the first and last step.
 *   rings[r]: region r's rings, each a list of chains in order.
 */
export function planarMap(region, w, h) {
  const W1 = w + 1;
  const R = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : region[y * w + x]);
  // boundary flags: horizontal edge (x, y) from corner (x, y) to (x + 1, y),
  // between pixels (x, y - 1) above and (x, y) below; vertical edge (x, y) from
  // corner (x, y) to (x, y + 1), between pixels (x - 1, y) and (x, y)
  const HN = (h + 1) * w;
  const isB = new Uint8Array(HN + h * W1);
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) if (R(x, y - 1) !== R(x, y)) isB[y * w + x] = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++) if (R(x - 1, y) !== R(x, y)) isB[HN + y * W1 + x] = 1;

  // the boundary steps out of a corner: [edge id, dx, dy]
  const steps = (cx, cy) => {
    const out = [];
    if (cx < w && isB[cy * w + cx]) out.push([cy * w + cx, 1, 0]);
    if (cx > 0 && isB[cy * w + cx - 1]) out.push([cy * w + cx - 1, -1, 0]);
    if (cy < h && isB[HN + cy * W1 + cx]) out.push([HN + cy * W1 + cx, 0, 1]);
    if (cy > 0 && isB[HN + (cy - 1) * W1 + cx]) out.push([HN + (cy - 1) * W1 + cx, 0, -1]);
    return out;
  };
  const degree = (cx, cy) => steps(cx, cy).length;
  // regions left and right of a step out of (cx, cy)
  const sides = (cx, cy, dx, dy) => {
    if (dx === 1) return [R(cx, cy - 1), R(cx, cy)];
    if (dx === -1) return [R(cx - 1, cy), R(cx - 1, cy - 1)];
    if (dy === 1) return [R(cx, cy), R(cx - 1, cy)];
    return [R(cx - 1, cy - 1), R(cx, cy - 1)];
  };

  const seen = new Uint8Array(isB.length);
  const chains = [];
  const walk = (cx, cy, first, closedStart) => {
    let [e, dx, dy] = first;
    const [a, b] = sides(cx, cy, dx, dy);
    const pts = [cx, cy];
    const n0 = cy * W1 + cx, d0 = [dx, dy];
    let px = cx, py = cy, last = [dx, dy];
    for (;;) {
      seen[e] = 1;
      px += dx; py += dy;
      last = [dx, dy];
      if (closedStart && px === cx && py === cy) {
        chains.push({ pts, a, b, closed: true, n0: -1, n1: -1, d0, d1: last });
        return;
      }
      pts.push(px, py);
      if (!closedStart && degree(px, py) !== 2) break;
      // the other boundary edge at this corner
      const nx = steps(px, py).find((s) => s[0] !== e);
      [e, dx, dy] = nx;
    }
    chains.push({ pts, a, b, closed: false, n0, n1: py * W1 + px, d0, d1: last });
  };
  // open chains, from every node
  for (let cy = 0; cy <= h; cy++) {
    for (let cx = 0; cx <= w; cx++) {
      const st = steps(cx, cy);
      if (st.length < 3) continue;
      for (const s of st) if (!seen[s[0]]) walk(cx, cy, s, false);
    }
  }
  // closed chains: what is left (corners of degree 2 all round)
  for (let e = 0; e < isB.length; e++) {
    if (!isB[e] || seen[e]) continue;
    let cx, cy, d;
    if (e < HN) { cx = e % w; cy = (e / w) | 0; d = [e, 1, 0]; } else { const k = e - HN; cx = k % W1; cy = (k / W1) | 0; d = [e, 0, 1]; }
    walk(cx, cy, d, true);
  }

  // rings: per region, its half-chains linked node to node
  let nReg = 0;
  for (let i = 0; i < region.length; i++) if (region[i] + 1 > nReg) nReg = region[i] + 1;
  const halves = Array.from({ length: nReg }, () => []);
  chains.forEach((c, i) => {
    if (c.a >= 0) halves[c.a].push({ c: i, rev: false, s: c.n0, e: c.n1, din: c.d0, dout: c.d1 });
    if (c.b >= 0) halves[c.b].push({ c: i, rev: true, s: c.n1, e: c.n0, din: [-c.d1[0], -c.d1[1]], dout: [-c.d0[0], -c.d0[1]] });
  });
  const rings = halves.map((hs) => {
    const out = [];
    const byStart = new Map();
    for (const h of hs) {
      if (chains[h.c].closed) { out.push([{ c: h.c, rev: h.rev }]); continue; }
      if (!byStart.has(h.s)) byStart.set(h.s, []);
      byStart.get(h.s).push(h);
    }
    const used = new Set();
    for (const h0 of hs) {
      if (chains[h0.c].closed || used.has(h0)) continue;
      used.add(h0);
      const ring = [{ c: h0.c, rev: h0.rev }];
      let cur = h0;
      for (let guard = 0; guard <= hs.length; guard++) {
        const cands = (byStart.get(cur.e) || []).filter((h) => h === h0 || !used.has(h));
        let pick = null, ps = Infinity;
        for (const h of cands) {
          const sc = turnScore(cur.dout, h.din);
          if (sc < ps) { ps = sc; pick = h; }
        }
        if (!pick || pick === h0) break;
        used.add(pick);
        ring.push({ c: pick.c, rev: pick.rev });
        cur = pick;
      }
      out.push(ring);
    }
    return out;
  });
  return { chains, rings };
}

/** Left turn 0, straight 1, right 2, back 3 (y-down: a left turn has cross < 0). */
function turnScore(din, dout) {
  const cross = din[0] * dout[1] - din[1] * dout[0];
  const dot = din[0] * dout[0] + din[1] * dout[1];
  if (cross < 0) return 0;
  if (cross > 0) return 2;
  return dot > 0 ? 1 : 3;
}

/**
 * Smooth and simplify every chain, in place on a copy of its points.
 * @param {number} sigma  px along the chain; 0 leaves the pixel staircase
 * @param {number} tol    Douglas-Peucker tolerance, px
 * @returns {number[][]} new points per chain
 */
export function smoothChains(chains, sigma, tol = 0.2) {
  return chains.map((c) => {
    const border = c.a < 0 || c.b < 0;
    let p = c.pts;
    if (!border && sigma > 0) p = gaussChain(p, sigma, c.closed);
    return border ? dropCollinear(p, c.closed) : simplify(p, tol, c.closed);
  });
}

/** Gaussian along a polyline: ends pinned (odd reflection) or around a loop. */
export function gaussChain(pts, sigma, closed) {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  // a kernel no longer than the chain allows (reflection only reaches one chain length)
  const s = Math.min(sigma, closed ? n / 6 : (n - 1) / 3);
  if (!(s > 0.3)) return pts.slice();
  const R = Math.ceil(3 * s);
  const k = [];
  let sum = 0;
  for (let i = -R; i <= R; i++) { const v = Math.exp(-(i * i) / (2 * s * s)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const at = closed
    ? (i, d) => pts[2 * (((i % n) + n) % n) + d]
    : (i, d) => {
      if (i < 0) return 2 * pts[d] - pts[2 * -i + d];
      if (i > n - 1) return 2 * pts[2 * (n - 1) + d] - pts[2 * (2 * (n - 1) - i) + d];
      return pts[2 * i + d];
    };
  const out = new Array(pts.length);
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let j = -R; j <= R; j++) { const wv = k[j + R]; x += wv * at(i + j, 0); y += wv * at(i + j, 1); }
    out[2 * i] = x; out[2 * i + 1] = y;
  }
  if (!closed) { out[0] = pts[0]; out[1] = pts[1]; out[2 * n - 2] = pts[2 * n - 2]; out[2 * n - 1] = pts[2 * n - 1]; }
  return out;
}

/** Douglas-Peucker, ends kept; a closed loop is split at its point farthest from the first. */
export function simplify(pts, tol, closed) {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  const dp = (i0, i1) => {
    const stack = [[i0, i1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      if (b <= a + 1) continue;
      const ax = pts[2 * a], ay = pts[2 * a + 1], bx = pts[2 * b], by = pts[2 * b + 1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      let best = -1, bd = -1;
      for (let i = a + 1; i < b; i++) {
        const px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay;
        let d;
        if (L2 === 0) d = px * px + py * py;
        else { const t = (px * dx + py * dy) / L2; d = (px - t * dx) ** 2 + (py - t * dy) ** 2; }
        if (d > bd) { bd = d; best = i; }
      }
      if (bd > tol * tol) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
  };
  keep[0] = 1;
  if (closed) {
    let far = 1, fd = -1;
    for (let i = 1; i < n; i++) { const d = (pts[2 * i] - pts[0]) ** 2 + (pts[2 * i + 1] - pts[1]) ** 2; if (d > fd) { fd = d; far = i; } }
    keep[far] = 1;
    // the loop as two open halves: 0..far and far..n (n = 0 again)
    const ext = pts.concat([pts[0], pts[1]]);
    const save = pts;
    pts = ext;
    dp(0, far); dp(far, n);
    pts = save;
  } else {
    keep[n - 1] = 1;
    dp(0, n - 1);
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

/** Remove points that sit on the straight line through their neighbours (pixel staircases on the canvas edge). */
export function dropCollinear(pts, closed) {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) { out.push(pts[2 * i], pts[2 * i + 1]); continue; }
    const a = ((i - 1) + n) % n, b = (i + 1) % n;
    const cross = (pts[2 * i] - pts[2 * a]) * (pts[2 * b + 1] - pts[2 * a + 1]) - (pts[2 * i + 1] - pts[2 * a + 1]) * (pts[2 * b] - pts[2 * a]);
    if (Math.abs(cross) > 1e-9) out.push(pts[2 * i], pts[2 * i + 1]);
  }
  return out.length >= 4 ? out : pts.slice();
}

/**
 * A ring's points from its chains, as a flat [x, y, ...] without the closing
 * point. An open chain's last point is the next one's first, so it is dropped;
 * a closed chain (a ring on its own) repeats none.
 */
export function ringPoints(ring, pts, chains) {
  const out = [];
  for (const { c, rev } of ring) {
    const p = pts[c];
    const n = p.length / 2;
    const m = chains[c].closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const j = rev ? (chains[c].closed ? (n - i) % n : n - 1 - i) : i;
      out.push(p[2 * j], p[2 * j + 1]);
    }
  }
  return out;
}

/** Shoelace area of a flat ring (y-down: a ring with its region on the left is negative). */
export function ringArea(p) {
  let s = 0;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) s += (p[2 * j] - p[2 * i]) * (p[2 * j + 1] + p[2 * i + 1]);
  return s / 2;
}
