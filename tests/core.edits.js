import { section, check, makeLabels, coverage, randomPoints } from './runner.js';
import { applyEdits, parseEdits } from '../src/core/edits.js';
import { numberPalette } from '../src/core/palette.js';
import { runPipeline } from '../src/pipeline.js';
import { generateSample } from '../src/app/samples.js';
import { inRings } from '../src/core/geom.js';

export function run() {
  section('core.edits', 'Hand edits. Predictions: a recolor fills exactly the region under the point; a merge gives a region its neighbour\'s color; a brush paints a capsule; a color no longer in the palette goes to the nearest; after edits the regions still tile the canvas.');
  const pal = numberPalette([{ hex: '#ff0000' }, { hex: '#00ff00' }, { hex: '#0000ff' }], 'list');
  const g = { w: 20, h: 10, sx: 1, sy: 1 };
  // left half 0 with a 3×3 island of 2, right half 1
  const map = makeLabels(20, 10, (x, y) => (x >= 3 && x < 6 && y >= 3 && y < 6 ? 2 : x < 10 ? 0 : 1));
  const count = (m, v) => m.filter((c) => c === v).length;
  const r = applyEdits(map, g, pal, [{ op: 'recolor', x: 4.5, y: 4.5, hex: '#00ff00' }]);
  check('recolor fills exactly the region under the point', count(r.colors, 1) === 100 + 9 && count(r.colors, 2) === 0 && r.applied === 1);
  const m = applyEdits(map, g, pal, [{ op: 'merge', x: 1, y: 1, x2: 15, y2: 5 }]);
  check('merge: the left region takes the right one\'s color, the island stays', count(m.colors, 1) === 200 - 9 && count(m.colors, 2) === 9);
  const b = applyEdits(map, g, pal, [{ op: 'brush', hex: '#0000fe', r: 1.5, pts: [12, 5, 17, 5] }]);
  const painted = [...b.colors].map((c, i) => (c === 2 && (i % 20) >= 10 ? 1 : 0)).reduce((a, v) => a + v, 0);
  check('brush paints a capsule, in the nearest palette color', painted >= 15 && painted <= 30 && b.colors[5 * 20 + 14] === 2, `${painted} pixels`);
  const same = applyEdits(map, g, pal, [{ op: 'recolor', x: 1, y: 1, hex: '#ff0000' }]);
  check('an edit that changes nothing is not counted', same.applied === 0);

  const p = parseEdits([{ op: 'recolor', x: 1, y: 2, hex: 'abc' }, { op: 'nope' }, { op: 'brush', hex: '#fff', r: 2, pts: [1, 2, 3] }, { op: 'merge', x: 1, y: 2, x2: 3, y2: NaN }]);
  check('edits from a file: valid ones kept, the rest dropped', p.edits.length === 1 && p.edits[0].hex === '#aabbcc' && p.dropped === 3);

  // through the pipeline: recolor the region under the canvas centre
  const img = generateSample('rings').color;
  const base = { widthMm: 200, precision: 'rough', autoN: 6 };
  const plain = runPipeline(img, base);
  const cx = 100, cy = 100;
  const at = (plan) => plan.regions.find((rg) => inRings(cx, cy, rg.rings));
  const before = at(plain);
  const other = plain.palette.find((q, i) => i !== before.c);
  const edited = runPipeline(img, { ...base, edits: [{ op: 'recolor', x: cx, y: cy, hex: other.hex }] });
  const after = at(edited);
  check('through the pipeline: the region at the point has the new color', edited.palette[after.c].hex === other.hex && edited.stats.edits === 1);
  const cov = coverage(edited.regions, randomPoints(2000, edited.piece.W, edited.piece.H, 3));
  check('after edits the regions still tile the canvas', cov.one === 2000, `${cov.none} in none, ${cov.many} in two+`);
  const brushed = runPipeline(img, { ...base, edits: [{ op: 'brush', hex: '#ff00ff', r: 3, pts: [20, 20, 180, 180] }] });
  const cov2 = coverage(brushed.regions, randomPoints(2000, brushed.piece.W, brushed.piece.H, 4));
  check('a brush stroke across the canvas: still tiled, every region numbered', cov2.one === 2000 && brushed.regions.every((rg) => rg.label && isFinite(rg.label.x)));
  const cache = {};
  runPipeline(img, base, { cache, imageKey: 1 });
  const bKey = cache.B.key;
  runPipeline(img, { ...base, edits: [{ op: 'recolor', x: cx, y: cy, hex: other.hex }] }, { cache, imageKey: 1 });
  check('an edit re-runs from the edits on, not the regions', cache.B.key === bKey && cache.E && cache.E.val.edits === 1);
}
