import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTraceBackend, createNativeTracerLocator } from '../scripts/agent-native-trace.mjs';
import { backendFallbackForFrame, describeBackendFallback, explainFailureAfterFallback } from '../src/agent-backend-fallback.js';

const TRIANGLE_LIMIT_MESSAGE = 'This GPU path trace takes at most 2000000 triangles in total, got 2500000.';

async function withCookDisabled(run) {
  const previous = process.env.COOK_DISABLE;
  process.env.COOK_DISABLE = '1';
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.COOK_DISABLE;
    else process.env.COOK_DISABLE = previous;
  }
}

test('a native request without the addon records why it fell back and repeats it in the triangle limit error', async () => {
  const trace = await withCookDisabled(() => chooseTraceBackend({ requested: 'native', runtimeBackend: 'gpu', locator: createNativeTracerLocator() }));
  assert.equal(trace.backend, 'gpu');
  assert.match(trace.reason, /needs @codepawlhq\/cook/);

  const fallback = describeBackendFallback({ requestedBackend: 'native', usedBackend: trace.backend, fallbackReason: trace.reason });
  assert.deepEqual(fallback, { requestedBackend: 'native', usedBackend: 'gpu', fallbackReason: trace.reason });

  const error = explainFailureAfterFallback(new RangeError(TRIANGLE_LIMIT_MESSAGE), fallback);
  assert.match(error.message, /at most 2000000 triangles/);
  assert.match(error.message, /renderer\.backend "native" was requested but the gpu backend ran instead: renderer\.backend "native" needs @codepawlhq\/cook/);
  assert.match(error.message, /pass renderer\.backend "gpu"/);
});

test('a job that ran on the backend it asked for keeps its error unchanged', () => {
  const error = new RangeError(TRIANGLE_LIMIT_MESSAGE);
  assert.equal(explainFailureAfterFallback(error, undefined).message, TRIANGLE_LIMIT_MESSAGE);
});

test('a frame the native tracer drew reports no fallback, though it traced with the gpu kernel option', () => {
  const fallback = backendFallbackForFrame({ requestedBackend: 'native', tracedNatively: true, usedBackend: 'gpu', fallbackReason: undefined });
  assert.equal(fallback, undefined);
});

test('a native frame that fell back always names a reason string', () => {
  const withReason = backendFallbackForFrame({ requestedBackend: 'native', tracedNatively: false, usedBackend: 'cpu', fallbackReason: 'the adapter was lost.' });
  assert.deepEqual(withReason, { requestedBackend: 'native', usedBackend: 'cpu', fallbackReason: 'the adapter was lost.' });
  const withoutReason = backendFallbackForFrame({ requestedBackend: 'native', tracedNatively: false, usedBackend: 'gpu', fallbackReason: undefined });
  assert.equal(typeof withoutReason.fallbackReason, 'string');
  assert.ok(withoutReason.fallbackReason.length > 0);
  assert.doesNotThrow(() => JSON.stringify(withoutReason));
});

test('a job that did not ask for native never reports a fallback', () => {
  assert.equal(backendFallbackForFrame({ requestedBackend: 'gpu', tracedNatively: false, usedBackend: 'gpu', fallbackReason: undefined }), undefined);
});
