// All compute, off the main thread. A thin wrapper: the pipeline itself is
// src/pipeline.js, which the harness also calls directly.
//
// Messages in:  {type:'run', jobId, imageKey, rgba?, settings}
//               rgba comes only with a new image; the worker keeps the last one
// Messages out: 'progress', 'done' (with the plan), 'error' -- all carry jobId,
// and the app drops any whose jobId is stale.
//
// The stage cache (pipeline.js) lives here, between runs: moving a slider that
// only changes the numbers re-runs only the numbers.

import { runPipeline } from './pipeline.js';

let image = null, imageKey = null;
const cache = {};

self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type !== 'run') return;
  try {
    if (msg.rgba) { image = msg.rgba; imageKey = msg.imageKey; }
    if (!image || imageKey !== msg.imageKey) throw Object.assign(new Error('the worker does not have this image'), { code: 'NO_IMAGE' });
    const onProgress = (stage) => self.postMessage({ type: 'progress', jobId: msg.jobId, stage });
    const t0 = performance.now();
    const plan = runPipeline(image, msg.settings, { onProgress, cache, imageKey });
    self.postMessage({ type: 'done', jobId: msg.jobId, plan, ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({
      type: 'error', jobId: msg.jobId,
      message: String((err && err.message) || err), stack: err && err.stack, code: err && err.code,
    });
  }
};
