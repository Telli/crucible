import test from 'node:test';
import assert from 'node:assert/strict';
import { fitLook } from '../src/look-fit-solver.js';
import { linearToOklab, srgbToLinear, measureRegion } from '../src/look-fit-color.js';
import { normalizeFitLookInput } from '../src/look-fit-input.js';
import { FIT_LOOK_LIMITS, fitOperationsForShot, fitPatchFromValues } from '../src/look-fit-parameters.js';
import { encodePng } from '../scripts/agent-icon-png.mjs';
import { runFitLook } from '../scripts/agent-fit-look.mjs';

const SIZE = 8;
const TRUE_VALUES = { sunHeight: 1.4, haze: 0.6 };

function solidImage(red, green, blue) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let pixel = 0; pixel < SIZE * SIZE; pixel++) data.set([red, green, blue, 255].map(channel => Math.min(255, Math.max(0, Math.round(channel)))), pixel * 4);
  return { width: SIZE, height: SIZE, data };
}

// A known-optimum "renderer": two shots, each a solid colour that depends smoothly on the two look parameters.
function fakeRender(values) {
  const sky = solidImage(60 + 70 * values.sunHeight + 40 * values.haze, 90 + 50 * values.sunHeight, 160 - 30 * values.haze - 20 * values.sunHeight);
  const ground = solidImage(40 + 25 * values.sunHeight, 80 + 60 * values.haze, 30 + 15 * values.sunHeight + 30 * values.haze);
  return { sky, ground };
}

function referenceRegions(extra = []) {
  const truth = fakeRender(TRUE_VALUES);
  const whole = { rect: [0, 0, 1, 1] };
  return [
    { label: 'high sky', shot: 'sky', lab: measureRegion(truth.sky, whole).lab, ...whole },
    { label: 'lit ground', shot: 'ground', lab: measureRegion(truth.ground, whole).lab, ...whole },
    ...extra,
  ];
}

const physical = (name, min, max, start) => ({ name, stage: 'physical', min, max, start });

test('the fit recovers the parameters that made the reference and lowers the error', async () => {
  const result = await fitLook({
    parameters: [physical('sunHeight', 0, 3, 0.5), physical('haze', 0, 2, 1.5)],
    regions: referenceRegions(),
    render: async values => fakeRender(values),
  });
  assert.ok(Math.abs(result.values.sunHeight - TRUE_VALUES.sunHeight) < 0.03, `sunHeight ${result.values.sunHeight}`);
  assert.ok(Math.abs(result.values.haze - TRUE_VALUES.haze) < 0.03, `haze ${result.values.haze}`);
  const meanBefore = result.before.reduce((sum, row) => sum + row.deltaE, 0) / result.before.length;
  const meanAfter = result.after.reduce((sum, row) => sum + row.deltaE, 0) / result.after.length;
  assert.ok(meanAfter < 0.005 && meanAfter < meanBefore / 10, `delta E ${meanBefore} to ${meanAfter}`);
  assert.equal(result.stoppedBy, null);
  assert.ok(result.history.length > 1 && result.history.at(-1).cost < result.history[0].cost);
});

test('values never leave their bounds, and a truth outside the bounds ends on the nearest edge', async () => {
  const result = await fitLook({
    parameters: [physical('sunHeight', 0, 1, 0.2), physical('haze', 0, 2, 1.5)],
    regions: referenceRegions(),
    render: async values => fakeRender(values),
  });
  for (const entry of result.history) {
    assert.ok(entry.values.sunHeight >= 0 && entry.values.sunHeight <= 1, `sunHeight ${entry.values.sunHeight}`);
    assert.ok(entry.values.haze >= 0 && entry.values.haze <= 2);
  }
  assert.ok(result.values.sunHeight > 0.97, `sunHeight stops at its maximum, got ${result.values.sunHeight}`);
});

test('Huber loss down-weights one badly placed region', async () => {
  const outlier = { label: 'cloud patch', shot: 'sky', rect: [0, 0, 1, 1], lab: [0.95, 0.1, 0.1] };
  const fit = huber => fitLook({
    parameters: [physical('sunHeight', 0, 3, 0.5), physical('haze', 0, 2, 1.5)],
    regions: [...referenceRegions(), outlier],
    render: async values => fakeRender(values),
    huber,
  });
  const robust = await fit(0.08);
  const plain = await fit(Infinity);
  const distance = result => Math.hypot(result.values.sunHeight - TRUE_VALUES.sunHeight, result.values.haze - TRUE_VALUES.haze);
  assert.ok(distance(robust) < distance(plain) * 0.8, `robust ${distance(robust)} against plain ${distance(plain)}`);
});

test('a held-out region is reported but does not move the fit', async () => {
  const wrongHoldout = { label: 'held out', shot: 'sky', rect: [0, 0, 1, 1], lab: [0.2, 0, 0], holdout: true };
  const result = await fitLook({
    parameters: [physical('sunHeight', 0, 3, 0.5), physical('haze', 0, 2, 1.5)],
    regions: [...referenceRegions(), wrongHoldout],
    render: async values => fakeRender(values),
  });
  assert.ok(Math.abs(result.values.sunHeight - TRUE_VALUES.sunHeight) < 0.03);
  const reported = result.after.find(row => row.label === 'held out');
  assert.equal(reported.holdout, true);
  assert.ok(reported.deltaE > 0.2);
});

test('a grade parameter the pictures cannot see stays at its neutral prior', async () => {
  const result = await fitLook({
    parameters: [physical('sunHeight', 0, 3, 0.5), { name: 'contrast', stage: 'grade', min: 0, max: 2, start: 1.4, prior: { value: 1, weight: 0.05 } }],
    regions: referenceRegions(),
    render: async values => fakeRender(values),
  });
  assert.ok(Math.abs(result.values.contrast - 1) < 0.05, `contrast ${result.values.contrast}`);
});

test('the evaluation and time limits stop the fit with the best look so far', async () => {
  const parameters = [physical('sunHeight', 0, 3, 0.5), physical('haze', 0, 2, 1.5)];
  const limited = await fitLook({ parameters, regions: referenceRegions(), render: async values => fakeRender(values), maximumEvaluations: 4 });
  assert.equal(limited.stoppedBy, 'maximumEvaluations');
  assert.ok(limited.evaluations <= 4);
  let clock = 0;
  const late = await fitLook({ parameters, regions: referenceRegions(), render: async values => fakeRender(values), deadlineAt: 10, now: () => (clock += 6) });
  assert.equal(late.stoppedBy, 'deadline');
});

test('a render that misses a shot says which one', async () => {
  await assert.rejects(
    fitLook({ parameters: [physical('sunHeight', 0, 3, 0.5)], regions: referenceRegions(), render: async () => ({ sky: solidImage(1, 2, 3) }) }),
    /render\(\) returned no image for shot ground/,
  );
});

test('OKLab of white is lightness 1 and of black is 0, and a region outside the picture is refused', () => {
  const [white] = linearToOklab(srgbToLinear(1), srgbToLinear(1), srgbToLinear(1));
  assert.ok(Math.abs(white - 1) < 1e-4);
  assert.equal(linearToOklab(0, 0, 0)[0], 0);
  assert.throws(() => measureRegion(solidImage(1, 2, 3), { label: 'gone', rect: [0, 0, 1, 1], exclude: [[0, 0, 1, 1]] }), /Region gone covers no pixels/);
});

const recipeWithSky = { camera: { eye: [0, 2, 8], target: [0, 1, 0], up: [0, 1, 0], fov: 45 }, environment: { keyIntensity: 1.2, sky: { type: 'physical', sunElevation: 20, turbidity: 3 } }, effects: { exposure: 1 } };
const validInput = () => ({
  shots: [{ name: 'coast' }],
  regions: [{ label: 'high sky', shot: 'coast', rect: [0.3, 0.02, 0.7, 0.15], lab: [0.72, -0.03, -0.08] }],
  parameters: [{ name: 'sunElevation', min: 3, max: 40 }, { name: 'keyIntensity' }, { name: 'exposure' }],
});

test('valid input is normalised: starts come from the recipe, the grade gets a neutral prior', () => {
  const settings = normalizeFitLookInput(validInput(), recipeWithSky);
  const [sun, key, exposure] = settings.parameters;
  assert.deepEqual([sun.start, sun.stage, sun.prior], [20, 'physical', undefined]);
  assert.deepEqual([key.min, key.max, key.start], [0, 20, 1.2]);
  assert.deepEqual([exposure.stage, exposure.start, exposure.prior.value], ['grade', 1, 1]);
  assert.deepEqual([settings.width, settings.height, settings.maximumIterations], [256, 160, 6]);
});

test('boundary errors say what to pass', () => {
  const failures = [
    [input => { input.shots = []; }, /shots: got 0; expected a list of 1 to 4 entries/],
    [input => { input.regions[0].shot = 'beach'; }, /regions\[0\]\.shot: got "beach"; expected the name of a shot in shots: coast/],
    [input => { input.regions[0].rect = [0.7, 0.1, 0.3, 0.2]; }, /regions\[0\]\.rect.*x0 < x1 and y0 < y1/],
    [input => { input.regions[0].lab = [3, 0, 0]; }, /regions\[0\]\.lab.*OKLab/],
    [input => { input.regions.push({ ...input.regions[0] }); }, /regions\[1\]\.label.*no other region uses/],
    [input => { input.parameters[0].name = 'sunAngle'; }, /parameters\[\]\.name: got "sunAngle"; expected one of sunElevation/],
    [input => { input.parameters[0].max = 95; }, /parameters\[0\]\.min\/max.*inside -10 to 90 for sunElevation/],
    [input => { input.parameters[1].start = 99; }, /parameters\[1\]\.start.*from 0 to 20/],
    [input => { input.parameters.push({ name: 'keyIntensity' }); }, /parameters\[3\]\.name.*listed once/],
    [input => { input.regions[0].holdout = true; }, /at least one region without holdout/],
    [input => { input.maxIterations = 40; }, /maxIterations: got 40; expected an integer from 1 to 8/],
    [input => { input.width = 5000; }, /width: got 5000; expected an integer from 64 to 512/],
    [input => { input.shots.push({ name: 'beach' }); }, /only shots that at least one region measures/],
    [input => { input.shots[0].camera = { zoom: 2 }; }, /shots\[0\]\.camera.*eye, target, up, fov, focalLength/],
    [input => { input.shots[0].camera = { fov: 40, focalLength: 35 }; }, /fov or focalLength, not both/],
  ];
  for (const [mutate, expected] of failures) {
    const input = validInput();
    mutate(input);
    assert.throws(() => normalizeFitLookInput(input, recipeWithSky), expected);
  }
  const tooMany = validInput();
  tooMany.regions = Array.from({ length: FIT_LOOK_LIMITS.maximumRegions + 1 }, (_, index) => ({ ...validInput().regions[0], label: `region ${index}` }));
  assert.throws(() => normalizeFitLookInput(tooMany, recipeWithSky), /regions: got 33; expected a list of 1 to 32/);
});

test('a sky parameter on a scene without a physical sky is refused with the edit that fixes it', () => {
  assert.throws(() => normalizeFitLookInput(validInput(), { ...recipeWithSky, environment: { keyIntensity: 1 } }), /no physical sky.*set-environment with a sky/);
  const gradient = { ...recipeWithSky, environment: { sky: { type: 'gradient' } } };
  assert.throws(() => normalizeFitLookInput(validInput(), gradient), /no physical sky/);
});

test('fitted values become one patch: the whole sky with the fitted fields, and the shot camera first', () => {
  const patch = fitPatchFromValues({ sunElevation: 12, turbidity: 4, keyIntensity: 2, exposure: 1.1 }, recipeWithSky);
  assert.deepEqual(patch, { environment: { sky: { type: 'physical', sunElevation: 12, turbidity: 4 }, keyIntensity: 2 }, effects: { exposure: 1.1 } });
  assert.equal(recipeWithSky.environment.sky.sunElevation, 20, 'the recipe is not edited');
  const operations = fitOperationsForShot({ camera: { eye: [1, 2, 3] } }, patch);
  assert.deepEqual(operations.map(operation => operation.type), ['set-camera', 'set-environment', 'set-effects']);
});

function fakePreview({ failOnFrame } = {}) {
  const calls = [];
  const values = { keyIntensity: 1.2 };
  const frames = { count: 0 };
  async function invoke(method, input) {
    calls.push({ method, input });
    if (method === 'exportRecipe') return { revision: 7, recipe: recipeWithSky };
    if (method === 'restoreRecipe') return { revision: 9999 };
    for (const operation of input.operations) {
      if (operation.type === 'set-environment') Object.assign(values, { keyIntensity: operation.environment.keyIntensity });
    }
    frames.count += 1;
    if (failOnFrame && frames.count >= failOnFrame) throw new Error('the preview lost its context');
    const image = fakeRender({ sunHeight: values.keyIntensity, haze: 0.6 }).sky;
    return { data: encodePng(image).toString('base64') };
  }
  return { invoke, calls };
}

function fitInput(truth) {
  const reference = measureRegion(fakeRender({ sunHeight: truth, haze: 0.6 }).sky, { rect: [0, 0, 1, 1] });
  return { sessionId: '00000000-0000-4000-8000-000000000000', shots: [{ name: 'sky' }],
    regions: [{ label: 'high sky', shot: 'sky', rect: [0, 0, 1, 1], lab: reference.lab }], parameters: [{ name: 'keyIntensity', min: 0, max: 4 }] };
}

test('runFitLook renders each candidate through the preview, returns scene_apply operations and puts the recipe back', async () => {
  const preview = fakePreview();
  const sizes = [];
  const result = await runFitLook({ input: fitInput(2.2), invoke: preview.invoke, setViewport: (width, height) => sizes.push([width, height]) });
  assert.deepEqual(sizes, [[256, 160]]);
  assert.equal(result.sourceRevision, 7);
  assert.ok(Math.abs(result.values.keyIntensity - 2.2) < 0.05, `keyIntensity ${result.values.keyIntensity}`);
  assert.equal(result.operations[0].type, 'set-environment');
  assert.equal(result.operations[0].environment.keyIntensity, result.values.keyIntensity);
  assert.ok(result.error.after.meanDeltaE < result.error.before.meanDeltaE / 10);
  assert.equal(result.error.regions[0].label, 'high sky');
  assert.equal(result.renders, result.evaluations);
  const frameCalls = preview.calls.filter(call => call.method === 'fitLookFrame');
  assert.deepEqual(frameCalls[0].input.operations[0], { type: 'set-camera', eye: [0, 2, 8], target: [0, 1, 0], up: [0, 1, 0], fov: 45 }, 'a shot without a camera uses the scene camera');
  assert.equal(preview.calls.at(-1).method, 'restoreRecipe');
  assert.equal(preview.calls.at(-1).input.recipe, recipeWithSky);
});

test('runFitLook puts the recipe back when a render fails', async () => {
  const preview = fakePreview({ failOnFrame: 3 });
  await assert.rejects(runFitLook({ input: fitInput(2.2), invoke: preview.invoke, setViewport() {} }), /the preview lost its context/);
  assert.equal(preview.calls.at(-1).method, 'restoreRecipe');
});

test('the capabilities note names every parameter and the limits the code enforces', async () => {
  const { FIT_LOOK_CAPABILITY_NOTE } = await import('../src/look-fit-notes.js');
  const { FIT_PARAMETER_NAMES } = await import('../src/look-fit-parameters.js');
  for (const name of FIT_PARAMETER_NAMES) assert.ok(FIT_LOOK_CAPABILITY_NOTE.includes(name), `${name} is in the note`);
  assert.ok(FIT_LOOK_CAPABILITY_NOTE.includes(`at most ${FIT_LOOK_LIMITS.maximumRegions}`));
  assert.ok(FIT_LOOK_CAPABILITY_NOTE.includes(`${FIT_LOOK_LIMITS.deadlineSeconds} second`));
});
