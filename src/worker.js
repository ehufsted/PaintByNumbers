// All compute, off the main thread. A thin wrapper: the pipeline itself is
// src/pipeline.js, which the harness also calls directly.
//
// Messages in:  {type:'run', jobId, imageKey, rgba?, settings}
//               rgba comes only with a new image; the worker keeps the last one
// Messages out: 'progress', 'done' (with the plan), 'error' -- all carry jobId,
// and the app drops any whose jobId is stale. 'done' also carries `styled`, the
// work raster after Tone and the Style chain (what the colors are matched
// from, for the Source view), but only when that stage was made afresh: the
// app keeps the last one it was sent.
//
// The stage cache (pipeline.js) lives here, between runs: moving a slider that
// only changes the numbers re-runs only the numbers.

import { runPipeline } from './pipeline.js';

let image = null, imageKey = null;
const cache = {};
let sentA = null;   // the stage-A key whose styled raster the app already has

self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type !== 'run') return;
  try {
    if (msg.rgba) { image = msg.rgba; imageKey = msg.imageKey; }
    if (!image || imageKey !== msg.imageKey) throw Object.assign(new Error('the worker does not have this image'), { code: 'NO_IMAGE' });
    const onProgress = (stage) => self.postMessage({ type: 'progress', jobId: msg.jobId, stage });
    const t0 = performance.now();
    const plan = runPipeline(image, msg.settings, { onProgress, cache, imageKey });
    const A = cache.A;
    const styled = A && A.key !== sentA ? A.val.filtered : null;
    if (styled) sentA = A.key;
    self.postMessage({ type: 'done', jobId: msg.jobId, plan, styled, ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({
      type: 'error', jobId: msg.jobId,
      message: String((err && err.message) || err), stack: err && err.stack, code: err && err.code,
    });
  }
};
