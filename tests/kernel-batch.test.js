import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import * as offload from '../src/kernel-offload.js';

const { buildWithKernels, kernelStats, resetKernelStats, runKernel } = offload;

const BUILD_SCRIPT = new URL('./support/kernel-batch-build.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PATTERN_COUNT = 6;

// Each build runs in its own process so that no pattern texture an earlier build cached can stand in for a kernel.
function coldBuild(mode) {
  const output = execFileSync(process.execPath, [BUILD_SCRIPT, mode], { encoding: 'utf8' });
  return JSON.parse(output.trim().split('\n').at(-1));
}

test('a build that needs several baked textures asks for all of them in one pass', () => {
  assert.equal(typeof offload.forEachDeferring, 'function', 'kernel-offload exports forEachDeferring');
  const oneByOne = coldBuild('one-by-one');
  const batched = coldBuild('batched');
  assert.equal(oneByOne.passes, PATTERN_COUNT + 1, 'without batching every texture costs a whole new build pass');
  assert.equal(batched.passes, 2, 'one pass finds every missing texture, the second reads them');
  assert.equal(batched.kernelJobs, PATTERN_COUNT, 'a material shared by two parts is baked once');
});

test('batched kernels on several workers build the same bytes as one thread', () => {
  const inline = coldBuild('inline');
  const batched = coldBuild('batched');
  assert.equal(batched.digest, inline.digest);
  assert.equal(coldBuild('one-by-one').digest, inline.digest);
  assert.ok(batched.workersStarted > 1 && batched.workersStarted <= 3, `the pool starts up to maximumWorkers workers, started ${batched.workersStarted}`);
});

test('a repeated bake is answered from the session without another worker job', async () => {
  resetKernelStats();
  const requested = [];
  const worker = {
    postMessage(message) {
      requested.push(message.name);
      setTimeout(() => worker.onmessage({ data: { value: message.args[0] * 2 } }), 0);
    },
    terminate() {},
  };
  const doubled = await buildWithKernels(() => {
    const results = [];
    offload.forEachDeferring([21, 21, 21, 4], input => results.push(runKernel('double', [input], value => value * 2)));
    return results;
  }, { createWorker: () => worker, available: true, maximumWorkers: 1 });
  assert.deepEqual(doubled, [42, 42, 42, 8]);
  assert.equal(requested.length, 2, 'two distinct inputs, two jobs');
  assert.equal(kernelStats().passes, 2);
  assert.equal(kernelStats().worker, 2);
});

test('forEachDeferring is a plain loop without a session and rethrows other errors', () => {
  const seen = [];
  offload.forEachDeferring([1, 2, 3], item => seen.push(runKernel('double', [item], value => value * 2)));
  assert.deepEqual(seen, [2, 4, 6]);
  assert.throws(() => offload.forEachDeferring([1], () => { throw new RangeError('not a deferral'); }), /not a deferral/);
});
