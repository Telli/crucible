// Levels of detail made after the first frame (#2985): the same bytes whenever the work runs, one job at a time,
// cancelled with the renderer, and a failure that is reported. The modules are imported inside each test so that
// reverting the change fails the named test, not the loading of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sphere } from '../src/geometry.js';

const SMALL_CANVAS = { clientWidth: 20, clientHeight: 20 };

function scanPart(name, geometry) {
  return { name, geometry, matrix: new Float32Array(16), material: { tag: 'surface', color: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.5 } };
}

function scanParts() {
  const shared = sphere(120, 60);
  return [scanPart('scan', shared), scanPart('copy', shared), scanPart('other', sphere(90, 50))];
}

/** A scheduler the test drives: jobs wait until `runAll`, and `pending` shows how many are queued at once. */
function manualScheduler() {
  const queue = [];
  const scheduler = {
    maximumPending: 0,
    cancelled: 0,
    schedule(job) {
      queue.push(job);
      scheduler.maximumPending = Math.max(scheduler.maximumPending, queue.length);
      return () => {
        scheduler.cancelled++;
        queue.splice(queue.indexOf(job), 1);
      };
    },
    get pending() { return queue.length; },
    runNext() { queue.shift()(); },
    async runAll(beforeEachJob = () => {}) {
      while (queue.length) {
        await beforeEachJob();
        queue.shift()();
      }
    },
  };
  return scheduler;
}

function bytesOfLevels(levels) {
  return levels.map(level => JSON.stringify({ ratio: level.ratio, triangles: level.triangles, error: level.error, path: level.path }) + [...Object.values(level.geometry)].map(value => (ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') : '')).join('|'));
}

test('levels made under different idle timing equal the levels made before the first frame, byte for byte', async () => {
  const { planDenseLods, addLodsToDenseParts } = await import('../src/dense-lods.js');
  const { startDeferredLods } = await import('../src/deferred-lods.js');
  const options = { pixels: 400 };
  const parts = scanParts();
  const plan = planDenseLods(parts, options);
  assert.equal(plan.parts.length, 3);
  assert.equal(plan.geometries.length, 2, 'parts that share a geometry share its levels');
  const upFront = addLodsToDenseParts(parts, options);

  const runs = [];
  for (const timing of ['all at once', 'one tick between jobs', 'late, with other work between']) {
    const scheduler = manualScheduler();
    const swapped = [];
    const deferred = startDeferredLods({ geometries: plan.geometries, ratios: plan.ratios, schedule: scheduler.schedule, sliceMilliseconds: Infinity, onLevels: (geometry, levels) => swapped.push([geometry, levels]) });
    if (timing === 'late, with other work between') await new Promise(resolve => setTimeout(resolve, 20));
    await scheduler.runAll(timing === 'all at once' ? undefined : () => new Promise(resolve => setImmediate(resolve)));
    const levelsByGeometry = await deferred.ready;
    assert.equal(swapped.length, 2);
    assert.equal(scheduler.maximumPending, 1, 'one job is queued at a time');
    runs.push(levelsByGeometry);
  }
  parts.forEach((part, index) => {
    const expected = bytesOfLevels(upFront[index].lods);
    for (const levelsByGeometry of runs) assert.deepEqual(bytesOfLevels(levelsByGeometry.get(part.geometry)), expected, `${part.name} differs`);
  });
});

test('slicing the work into steps of a fake clock gives the same bytes as the unsliced levels, with one job queued at a time', async () => {
  const { planDenseLods, addLodsToDenseParts } = await import('../src/dense-lods.js');
  const { startDeferredLods } = await import('../src/deferred-lods.js');
  const { generateGeometryLods, generateGeometryLodsSteps } = await import('../src/mesh-lod.js');
  const options = { pixels: 400 };
  const parts = scanParts();
  const plan = planDenseLods(parts, options);
  const upFront = addLodsToDenseParts(parts, options);

  const stepsToFinish = (() => {
    const steps = generateGeometryLodsSteps(parts[0].geometry, { ratios: plan.ratios });
    let count = 0;
    while (!steps.next().done) count++;
    return count;
  })();
  assert.ok(stepsToFinish > 10, `the simplifier yields many times for one geometry (${stepsToFinish})`);
  assert.deepEqual(bytesOfLevels(generateGeometryLods(parts[0].geometry, { ratios: plan.ratios })), bytesOfLevels(upFront[0].lods));

  for (const sliceMilliseconds of [1, 5]) {
    let clock = 0;
    const scheduler = manualScheduler();
    let jobs = 0;
    const countingSchedule = job => scheduler.schedule(() => { jobs++; job(); });
    const deferred = startDeferredLods({ geometries: plan.geometries, ratios: plan.ratios, schedule: countingSchedule, sliceMilliseconds, now: () => clock++ });
    await scheduler.runAll();
    const levelsByGeometry = await deferred.ready;
    assert.ok(jobs > plan.geometries.length * 2, `each geometry takes several jobs (${jobs} jobs for slices of ${sliceMilliseconds})`);
    assert.equal(scheduler.maximumPending, 1);
    parts.forEach((part, index) => assert.deepEqual(bytesOfLevels(levelsByGeometry.get(part.geometry)), bytesOfLevels(upFront[index].lods), `${part.name} differs at slices of ${sliceMilliseconds}`));
  }
});

test('nothing is made until the scheduler runs a job, and cancel stops the work and settles ready with null', async () => {
  const { planDenseLods } = await import('../src/dense-lods.js');
  const { startDeferredLods } = await import('../src/deferred-lods.js');
  const plan = planDenseLods(scanParts(), { pixels: 400 });
  const scheduler = manualScheduler();
  const made = [];
  const deferred = startDeferredLods({ geometries: plan.geometries, ratios: plan.ratios, schedule: scheduler.schedule, sliceMilliseconds: Infinity, onLevels: geometry => made.push(geometry) });
  assert.equal(made.length, 0);
  assert.equal(scheduler.pending, 1);
  scheduler.runNext();
  assert.equal(made.length, 1);
  deferred.cancel();
  assert.equal(scheduler.pending, 0);
  assert.equal(scheduler.cancelled, 1);
  assert.equal(await deferred.ready, null);
  assert.equal(made.length, 1);
});

test('an error in the deferred work is reported and rejects ready, and no further job starts', async () => {
  const { planDenseLods } = await import('../src/dense-lods.js');
  const { startDeferredLods } = await import('../src/deferred-lods.js');
  const plan = planDenseLods(scanParts(), { pixels: 400 });
  const scheduler = manualScheduler();
  const reported = [];
  const deferred = startDeferredLods({ geometries: plan.geometries, ratios: [2], schedule: scheduler.schedule, onError: error => reported.push(error) });
  scheduler.runNext();
  await assert.rejects(deferred.ready, /ratios must be strictly decreasing/);
  assert.equal(reported.length, 1);
  assert.equal(scheduler.pending, 0);

  const failingSwap = startDeferredLods({ geometries: plan.geometries, ratios: plan.ratios, schedule: scheduler.schedule, sliceMilliseconds: Infinity, onLevels: () => { throw new Error('swap failed'); }, onError: error => reported.push(error) });
  scheduler.runNext();
  await assert.rejects(failingSwap.ready, /swap failed/);
  assert.equal(reported.length, 2);
});

test('planLodsForRendererOptions reads the renderer options the way partsForRendererOptions does', async () => {
  const { planLodsForRendererOptions } = await import('../src/dense-lods.js');
  const parts = scanParts();
  assert.equal(planLodsForRendererOptions(parts, SMALL_CANVAS, { pixelRatio: 1 }).geometries.length, 2);
  assert.equal(planLodsForRendererOptions(parts, SMALL_CANVAS, { denseLods: false }).geometries.length, 0);
  assert.equal(planLodsForRendererOptions(parts, { clientWidth: 8000, clientHeight: 8000 }, { pixelRatio: 1 }).geometries.length, 0);
  assert.throws(() => planLodsForRendererOptions(parts, SMALL_CANVAS, { denseLods: 'yes' }), /denseLods must be true or false/);
});
