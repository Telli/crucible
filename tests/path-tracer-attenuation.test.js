import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { box } from '../src/geometry.js';
import { createEnvironmentMap } from '../src/environment.js';
import { createCamera, renderBand } from '../src/path-tracer.js';
import { buildTraceScene } from '../src/path-tracer-scene.js';

const OPTIONS = { width: 8, height: 8, samples: 1, bounces: 4, threads: 1, seed: 1, fireflyClamp: 1000 };
const LOOKING_ALONG_Z = { eye: [0, 0, 6], target: [0, 0, 0], up: [0, 1, 0], fov: 10 };

function slabMatrix(thickness) {
  return new Float32Array([8, 0, 0, 0, 0, 8, 0, 0, 0, 0, thickness, 0, 0, 0, 0, 1]);
}

/** A clear slab (ior 1, so no bending and no reflection) in front of a uniform white sky. */
function traceSlab(thickness, glassFields) {
  const parts = [{
    name: 'slab',
    geometry: box(0, 1),
    matrix: slabMatrix(thickness),
    material: { tag: 'surface', metallic: 0, roughness: 0, emission: 0, color: [1, 1, 1], transmission: 1, ior: 1, ...glassFields },
  }];
  const environment = { map: createEnvironmentMap({ width: 8, height: 4, data: new Float32Array(8 * 4 * 3).fill(1) }) };
  const view = createCamera(LOOKING_ALONG_Z, OPTIONS.width, OPTIONS.height);
  return renderBand(buildTraceScene(parts, environment), view, OPTIONS, 0, OPTIONS.height).color;
}

function meanChannels(color) {
  const mean = [0, 0, 0];
  const pixelCount = color.length / 3;
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    for (let channel = 0; channel < 3; channel++) mean[channel] += color[pixel * 3 + channel] / pixelCount;
  }
  return mean;
}

test('light through a 2 m attenuating slab keeps colour^(distance / attenuationDistance) and loses more than through 0.1 m', () => {
  const absorbing = { attenuationColor: [0.5, 0.25, 1], attenuationDistance: 1 };
  const thin = meanChannels(traceSlab(0.1, absorbing));
  const deep = meanChannels(traceSlab(2, absorbing));
  assert.ok(deep[0] < thin[0] * 0.5, `red through 2 m (${deep[0]}) must be far below red through 0.1 m (${thin[0]})`);
  assert.ok(deep[1] < thin[1] * 0.1, `green through 2 m (${deep[1]}) must be far below green through 0.1 m (${thin[1]})`);
  assert.ok(Math.abs(deep[2] - thin[2]) < 1e-3, 'a channel with attenuation colour 1 is not absorbed');
  assert.ok(Math.abs(deep[0] - 0.25) < 0.01, `red through 2 m at colour 0.5 per metre is 0.25, got ${deep[0]}`);
  assert.ok(Math.abs(deep[1] - 0.0625) < 0.01, `green through 2 m at colour 0.25 per metre is 0.0625, got ${deep[1]}`);
});

function hashOf(color) {
  return createHash('sha256').update(Buffer.from(color.buffer, color.byteOffset, color.byteLength)).digest('hex');
}

test('a transmissive part without an attenuation distance traces the same bytes whatever its attenuation colour', () => {
  const plain = hashOf(traceSlab(2, {}));
  assert.equal(hashOf(traceSlab(2, { attenuationColor: [0.2, 0.5, 0.9] })), plain);
  assert.equal(hashOf(traceSlab(2, { attenuationDistance: Infinity })), plain);
  assert.notEqual(hashOf(traceSlab(2, { attenuationColor: [0.2, 0.5, 0.9], attenuationDistance: 1 })), plain);
});
