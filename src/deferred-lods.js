import { generateGeometryLodsSteps } from './mesh-lod.js';

/** The longest a deferred job may run before it hands the main thread back; a step is about a millisecond, so a slice ends within a few milliseconds of this. */
export const DEFERRED_SLICE_MILLISECONDS = 8;

// Levels of detail made after the first frame (#2985). A scan with a seam-heavy atlas takes a few hundred
// milliseconds to simplify, so a viewer draws level 0 at once, makes the levels one geometry at a time while the page
// is idle and hands each to `onLevels`, which swaps them into the renderer. The simplifier runs as steps (see
// `generateGeometryLodsSteps`) in slices of `DEFERRED_SLICE_MILLISECONDS`, each its own scheduled job, so a build that takes
// a second blocks no frame for more than a few milliseconds and the levels are the same bytes as the unsliced ones. Nothing here runs for a render that is
// written to a file: those take `addLodsToDenseParts` in src/dense-lods.js, which makes the levels before the first frame.

/** Waits for the next frame, then for an idle moment, so the first frame is drawn before any simplifying starts. Returns a function that cancels it. */
export function scheduleAfterFirstFrame(callback) {
  let cancelled = false;
  let idleHandle = null;
  const frameHandle = requestAnimationFrame(() => {
    if (cancelled) return;
    if (typeof requestIdleCallback === 'function') idleHandle = requestIdleCallback(callback, { timeout: 2000 });
    else idleHandle = setTimeout(callback, 0);
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frameHandle);
    if (idleHandle === null) return;
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle);
    clearTimeout(idleHandle);
  };
}

/**
 * Makes the levels of `geometries` one at a time in slices of `sliceMilliseconds` (by `now()`), each slice its own scheduled
 * job, and calls `onLevels(geometry, levels)` after each geometry. `schedule(job)` runs a job later and returns a function that
 * cancels it; pass your own to control when the work runs.
 * Returns `{ ready, cancel }`. `ready` resolves to the Map of geometry to levels once all are made, resolves to null after
 * `cancel()`, and rejects with the first error (from the simplifier or from `onLevels`), which is also passed to `onError`
 * (console.warn by default) so a failure is never silent. After an error or a cancel no further job starts.
 */
export function startDeferredLods({ geometries, ratios, schedule = scheduleAfterFirstFrame, sliceMilliseconds = DEFERRED_SLICE_MILLISECONDS, now = () => performance.now(), onLevels = () => {}, onError = error => console.warn(`Level-of-detail generation failed: ${error.message}`) }) {
  if (!Array.isArray(geometries)) throw new TypeError('geometries must be the array of distinct geometries to make levels for.');
  const levelsByGeometry = new Map();
  let steps = null;
  let cancelScheduled = null;
  let finished = false;
  let settle;
  const ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  // The caller may never await `ready`; the warning above is what surfaces the error then.
  ready.catch(() => {});

  const finish = (action, value) => {
    if (finished) return;
    finished = true;
    cancelScheduled = null;
    settle[action](value);
  };

  const runNext = () => {
    cancelScheduled = null;
    if (finished) return;
    const geometry = geometries[levelsByGeometry.size];
    if (geometry === undefined) {
      finish('resolve', levelsByGeometry);
      return;
    }
    try {
      steps ??= generateGeometryLodsSteps(geometry, { ratios });
      const sliceEnd = now() + sliceMilliseconds;
      let step = steps.next();
      while (!step.done && now() < sliceEnd) step = steps.next();
      if (step.done) {
        steps = null;
        levelsByGeometry.set(geometry, step.value);
        onLevels(geometry, step.value);
      }
    } catch (error) {
      onError(error);
      finish('reject', error);
      return;
    }
    if (finished) return;
    cancelScheduled = schedule(runNext);
  };

  cancelScheduled = schedule(runNext);
  return {
    ready,
    cancel() {
      if (finished) return;
      cancelScheduled?.();
      finish('resolve', null);
    },
  };
}
