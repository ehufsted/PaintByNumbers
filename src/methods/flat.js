// Flat color: every region one palette color, the classic paint-by-numbers.
//
// The pixels are matched to the palette (core/quantize.js), the color map is
// cleaned up by majority, and the detail limits make it paintable
// (core/segment.js). Every region's fill is {type: 'solid'}.

import { nearestColors, majoritySmooth } from '../core/quantize.js';
import { segment } from '../core/segment.js';

export default {
  id: 'flat',
  label: 'Flat color',
  blurb: 'Each region one color from the palette.',
  params: [],

  /**
   * @param {{lab:Float32Array, w:number, h:number, pal:number[][], px:number, s:object}} ctx
   *   lab: the pre-filtered image in OKLab; pal: OKLab per numbered color; px: mm per grid pixel
   */
  segment(ctx) {
    const { lab, w, h, pal, px, s } = ctx;
    const raw = nearestColors(lab, pal);
    const clean = majoritySmooth(raw, w, h, pal.length, s.cleanup / px);
    return segment(clean, w, h, lab, pal, { minWidthPx: s.minWidth / px, minAreaPx: s.minArea / (px * px) });
  },

  fill() {
    return { type: 'solid' };
  },
};
