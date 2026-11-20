import assert from 'node:assert/strict';
import test from 'node:test';

import { installRenderPasses } from '../src/render-passes.js';

// prepare() checks the velocity inputs before it reads the GL context, so a context that throws on any use proves a refusal
// comes from the check and not from a GL call later.
const unusedContext = new Proxy({}, { get() { throw new Error('The GL context was touched.'); } });

function velocityRenderer() {
  return {
    passSupport: null,
    context: unusedContext,
    canvas: { width: 8, height: 8 },
    benchmark: false,
    viewProjection: new Float32Array(16),
    renderTargets: { record() {} },
    requireFeatureNames() {},
  };
}

test('the velocity pass names a previous camera that has no finite eye (#2631)', () => {
  const support = installRenderPasses(velocityRenderer()).passSupport;
  for (const eye of [[0, 1], undefined, [0, NaN, 2], [0, 1, Infinity], 'eye']) {
    assert.throws(
      () => support.prepare({ pass: 'velocity', previousCamera: { eye } }),
      /frame\.previousCamera\.eye: .*expected \[x, y, z\] as three finite numbers/,
      JSON.stringify(eye),
    );
  }
});

test('the velocity pass names a previous view projection that is not sixteen finite numbers (#2631)', () => {
  const support = installRenderPasses(velocityRenderer()).passSupport;
  for (const previousViewProjection of [[1, 0, 0], new Float32Array(15), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, NaN], { length: 16 }]) {
    assert.throws(
      () => support.prepare({ pass: 'velocity', previousViewProjection }),
      /frame\.previousViewProjection: .*expected sixteen finite numbers/,
    );
  }
});

test('the velocity pass names object motion that is not the matrix table from packObjectMotion (#2631)', () => {
  const support = installRenderPasses(velocityRenderer()).passSupport;
  for (const matrices of [[], new Float64Array(16), {}]) {
    assert.throws(
      () => support.prepare({ pass: 'velocity', objectMotion: { matrices } }),
      /frame\.objectMotion\.matrices: .*expected the Float32Array from packObjectMotion/,
    );
  }
});

test('a velocity pass with the inputs it reads gets past the checks (#2631)', () => {
  const support = installRenderPasses(velocityRenderer()).passSupport;
  assert.throws(
    () => support.prepare({ pass: 'velocity', previousCamera: { eye: [1, 2, 5] }, previousViewProjection: new Float32Array(16), objectMotion: { matrices: new Float32Array(32) } }),
    /The GL context was touched/,
    'the accepted inputs reach the GL setup',
  );
});

test('another pass still reads a previous camera the velocity pass would refuse (#2631)', () => {
  const support = installRenderPasses(velocityRenderer()).passSupport;
  assert.throws(() => support.prepare({ pass: 'albedo', previousCamera: { eye: [0, NaN, 0] } }), /The GL context was touched/);
});
