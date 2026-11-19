// The ordered section list. Order is part of the contract: the transcript is
// diffed between runs, so a reordering reads as a change.

import { reset, say, getTally } from './runner.js';
import * as edt from './core.edt.js';
import * as palette from './core.palette.js';
import * as colorsets from './core.colorsets.js';
import * as style from './core.style.js';
import * as quantize from './core.quantize.js';
import * as segment from './core.segment.js';
import * as planar from './core.planar.js';
import * as labels from './core.labels.js';
import * as output from './core.output.js';
import * as grid from './core.grid.js';
import * as target from './target.js';
import * as pipeline from './pipeline.js';

export const SECTIONS = [
  ['core.edt', edt],
  ['core.palette', palette],
  ['core.colorsets', colorsets],
  ['core.style', style],
  ['core.quantize', quantize],
  ['core.segment', segment],
  ['core.planar', planar],
  ['core.labels', labels],
  ['core.output', output],
  ['core.grid', grid],
  ['target', target],
  ['pipeline', pipeline],
];

/** Headless: run every section (or those named) synchronously. */
export function runAll(only = null) {
  reset();
  for (const [name, mod] of SECTIONS) {
    if (only && !only.includes(name)) continue;
    mod.run();
  }
  summary();
}

export function summary() {
  const t = getTally();
  say(`<h2>Summary</h2><p class="${t.fail ? 'fail' : 'pass'}">${t.pass} passed, ${t.fail} failed</p>`);
}
