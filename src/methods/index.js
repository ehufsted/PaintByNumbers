// The method registry. A method decides what the regions are and how each is
// filled:
//
//   id, label, blurb, params,
//   segment(ctx) -> {colors, region, count, thin, merged}
//                   colors: palette index per grid pixel; region: region id per
//                   grid pixel (4-connected, one color each)
//   fill(region) -> {type: 'solid'}   (room for gradient fills later)
//
// Everything after the region map (the planar map, the numbers, the plan) is the
// pipeline's, the same for every method.
//
// Params are {key, label, type: 'range'|'select'|'checkbox', def, ...}, as in
// HalftoneCuttable and Photo2Mosaic.

import flat from './flat.js';

export const METHODS = [flat];

export const byId = (id) => METHODS.find((m) => m.id === id) || METHODS[0];

export function defaultsFor(method) {
  const out = {};
  for (const p of method.params) out[p.key] = p.def;
  return out;
}
