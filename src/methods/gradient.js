// Flat + gradients: flat regions as Flat color makes them, and where the image is
// a smooth blend (a sky, a cheek, a wall in soft light), one region painted as a
// blend between two palette colors instead of bands (core/gradients.js).
//
// The regions are found exactly as Flat color finds them; `group` then runs on
// the result (after any hand edits) and joins band-boundary neighbours into
// gradient regions. Each gradient region is numbered with BOTH its colors, one
// near each end, joined by a dashed line: blend from one to the other.

import flat from './flat.js';
import { findGradients } from '../core/gradients.js';

export default {
  id: 'gradient',
  label: 'Flat + gradients',
  blurb: 'Smooth blends in the image (skies, soft shading) become one region painted as a blend through a few neighbouring colors, straight or round a centre, numbered with each color and a dashed line; the rest stays flat.',
  params: [
    { key: 'strictness', label: 'Strictness', type: 'select', def: 'normal', options: [['strict', 'Strict'], ['normal', 'Normal'], ['loose', 'Loose']],
      hint: 'how closely a blend must match the image (against the flat bands it replaces), how well it must fit, and how far apart neighbouring paints may be' },
    { key: 'maxPaints', label: 'Paints per blend', type: 'range', min: 2, max: 6, step: 1, def: 4,
      hint: 'the most colors one blend may run through, in order' },
    { key: 'radial', label: 'Round blends (around a centre) too', type: 'checkbox', def: true,
      hint: 'blends that run outward from a centre, like shading round a highlight, as well as straight ones' },
    { key: 'blend', label: 'Blend below', type: 'range', min: 0.1, max: 0.9, step: 0.05, def: 0.35, dp: 2,
      hint: 'how smooth the image must be across a boundary for its two regions to become one blend: the change across it, as a share of the difference between the two paints (higher blends more)' },
    { key: 'minSize', label: 'Smallest blend', type: 'range', min: 1, max: 30, step: 1, def: 6, unit: '× region',
      hint: 'a blend needs room to be painted: the smallest gradient region, as a multiple of the smallest region' },
  ],

  segment: flat.segment,

  /**
   * @param {{colors, region, count, lab, pal, w, h, sx, sy, params, minAreaPx, roomPx}} ctx
 *   roomPx: the clearance a number needs, px (each half of a blend must have it)
   */
  group(ctx) {
    const p = ctx.params;
    return findGradients({ ...ctx, blend: p.blend, minArea: Math.max(1, p.minSize * ctx.minAreaPx), room: ctx.roomPx,
      strictness: p.strictness, maxPaints: p.maxPaints, radial: p.radial });
  },

  fill() {
    return { type: 'solid' };
  },
};
