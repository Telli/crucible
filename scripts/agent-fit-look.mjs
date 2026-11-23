// scene_fit_look: fits look parameters to reference region colours by rendering candidate looks in the preview.
// The preview is reached through two injected functions, so a test drives the whole fit with a fake: `invoke(method, input)` calls
// a page method of the session, `setViewport(width, height)` sizes the frame. Every candidate is drawn on the live scene and the
// scene's own recipe is put back when the fit ends, so the caller's scene is unchanged apart from its revision counter.

import { decodePng } from './agent-icon-png.mjs';
import { fitLook, meanDeltaE } from '../src/look-fit-solver.js';
import { normalizeFitLookInput } from '../src/look-fit-input.js';
import { FIT_LOOK_LIMITS, fitOperationsForShot, fitPatchFromValues } from '../src/look-fit-parameters.js';

const CAMERA_FIELDS = ['eye', 'target', 'up', 'fov', 'focalLength'];
const DECIMALS = 4;

function round(value) {
  return Number(value.toFixed(DECIMALS));
}

function roundedValues(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, round(value)]));
}

// A shot without its own camera is drawn from the scene's camera, since an earlier shot may have moved it.
function cameraOfShot(shot, recipe) {
  if (shot.camera) return shot.camera;
  const camera = Object.fromEntries(CAMERA_FIELDS.filter(field => recipe.camera?.[field] !== undefined).map(field => [field, recipe.camera[field]]));
  if (camera.fov !== undefined) delete camera.focalLength;
  return camera;
}

function summarizeErrors(errors) {
  const training = errors.filter(row => !row.holdout);
  const heldOut = errors.filter(row => row.holdout);
  return { meanDeltaE: round(meanDeltaE(training)), ...(heldOut.length ? { holdoutMeanDeltaE: round(meanDeltaE(heldOut)) } : {}) };
}

function regionReport(before, after) {
  return before.map((row, index) => ({
    label: row.label,
    shot: row.shot,
    holdout: row.holdout,
    target: row.target.map(round),
    before: { deltaE: round(row.deltaE), rendered: row.rendered.map(round) },
    after: { deltaE: round(after[index].deltaE), rendered: after[index].rendered.map(round), deltaLightness: round(after[index].deltaLightness), deltaChroma: round(after[index].deltaChroma) },
  }));
}

function operationsFromPatch(patch) {
  return [
    ...(patch.environment ? [{ type: 'set-environment', environment: patch.environment }] : []),
    ...(patch.effects ? [{ type: 'set-effects', effects: patch.effects }] : []),
  ];
}

export async function runFitLook({ input, invoke, setViewport, now = Date.now }) {
  const { sessionId } = input;
  const startedAt = now();
  const baseline = await invoke('exportRecipe', { sessionId });
  const settings = normalizeFitLookInput(input, baseline.recipe);
  await setViewport(settings.width, settings.height);
  let renders = 0;

  async function render(values) {
    const patch = fitPatchFromValues(values, baseline.recipe);
    const images = {};
    for (const shot of settings.shots) {
      const operations = fitOperationsForShot({ camera: cameraOfShot(shot, baseline.recipe) }, patch);
      const frame = await invoke('fitLookFrame', { sessionId, operations });
      images[shot.name] = decodePng(Buffer.from(frame.data, 'base64'));
      renders += 1;
    }
    return images;
  }

  let fit;
  try {
    fit = await fitLook({
      parameters: settings.parameters,
      regions: settings.regions,
      render,
      maximumIterations: settings.maximumIterations,
      maximumEvaluations: FIT_LOOK_LIMITS.maximumEvaluations,
      deadlineAt: startedAt + FIT_LOOK_LIMITS.deadlineSeconds * 1000,
      now,
    });
  } finally {
    await invoke('restoreRecipe', { sessionId, recipe: baseline.recipe });
  }
  const patch = fitPatchFromValues(roundedValues(fit.values), baseline.recipe);
  return {
    sessionId,
    sourceRevision: baseline.revision,
    message: 'The scene was not changed. Apply the operations with scene_apply, then look at the result; regions with holdout: true were not fitted and show how well the fit carries over.',
    operations: operationsFromPatch(patch),
    values: roundedValues(fit.values),
    startValues: roundedValues(fit.startValues),
    error: { before: summarizeErrors(fit.before), after: summarizeErrors(fit.after), regions: regionReport(fit.before, fit.after) },
    history: fit.history.map(entry => ({ stage: entry.stage, iteration: entry.iteration, cost: round(entry.cost), values: roundedValues(entry.values) })),
    evaluations: fit.evaluations,
    renders,
    ...(fit.stoppedBy ? { stoppedBy: fit.stoppedBy } : {}),
    size: { width: settings.width, height: settings.height },
    elapsedSeconds: round((now() - startedAt) / 1000),
  };
}
