// The method registry. A method decides what the regions are and how each is
// filled:
//
//   id, label, blurb, params,
//   segment(ctx) -> {colors, region, count, thin, merged}
//                   colors: palette index per grid pixel; region: region id per
//                   grid pixel (4-connected, one color each)
//   group(ctx)   -> {region, count, fills}   optional: regions joined after the
//                   edits, each with its fill {type:'solid', c} or
//                   {type:'gradient', c0, c1, x0, y0, x1, y1} (Flat + gradients)
//   fill(region) -> {type: 'solid'}
//
// Everything after the region map (the planar map, the numbers, the plan) is the
// pipeline's, the same for every method.
//
// Params are {key, label, type: 'range'|'select'|'checkbox', def, ...}, as in
// HalftoneCuttable and Photo2Mosaic.

import flat from './flat.js';
import gradient from './gradient.js';

export const METHODS = [flat, gradient];

export const byId = (id) => METHODS.find((m) => m.id === id) || METHODS[0];

export function defaultsFor(method) {
  const out = {};
  for (const p of method.params) out[p.key] = p.def;
  return out;
}
