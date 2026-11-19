import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWithKernels, kernelKey, runKernel } from '../src/kernel-offload.js';
import { answerKernelRequest } from '../src/kernel-registry.js';

test('a build cancelled while a page kernel runs stops at once instead of waiting for the worker timeout', async () => {
  const controller = new AbortController();
  const silentWorker = { postMessage() {}, terminate() {} };
  const pageKernels = {
    pattern: {
      accepts: () => true,
      compute: async () => {
        controller.abort();
        throw new Error('the GPU failed');
      },
    },
  };
  const started = Date.now();
  await assert.rejects(
    buildWithKernels(() => runKernel('pattern', [{ size: 1 }], () => 'inline'), {
      createWorker: () => silentWorker,
      available: true,
      signal: controller.signal,
      pageKernels,
      kernelTimeoutMilliseconds: 2000,
    }),
    error => error.name === 'AbortError',
  );
  assert.ok(Date.now() - started < 1000, `the build took ${Date.now() - started} ms to notice the cancel`);
});

test('kernel keys tell 0 from -0 and arrays with holes from arrays without', () => {
  assert.notEqual(kernelKey('k', [0]), kernelKey('k', [-0]));
  assert.notEqual(kernelKey('k', [[, 1]]), kernelKey('k', [[1, ,]]));
  assert.equal(kernelKey('k', [[0, 1]]), kernelKey('k', [[0, 1]]));
});

test('a malformed kernel request answers with an error that names the field', () => {
  const missingArguments = answerKernelRequest({ name: 'cloth' }).response.error;
  assert.equal(missingArguments.name, 'TypeError');
  assert.match(missingArguments.message, /"args" must be an array/);
  assert.match(answerKernelRequest({ name: 'cloth', args: 5 }).response.error.message, /"args" must be an array/);
  assert.match(answerKernelRequest(null).response.error.message, /must be an object/);
});
