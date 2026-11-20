import assert from 'node:assert/strict';
import test from 'node:test';

import { box } from '../src/geometry.js';
import { describeIgnoredFeatures } from '../src/path-tracer.js';
import { packLights } from '../src/path-tracer-gpu-pack.js';
import { buildTraceScene } from '../src/path-tracer-scene.js';

const LIGHT_TEXEL_FLOATS = 24;
const BOUNCE_LIMIT_FLOAT_INDEX = 23;

function floorPart() {
  const matrix = new Float32Array([4, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 4, 0, 0, -0.05, 0, 1]);
  return { name: 'floor', geometry: box(0, 1), matrix, material: { color: [0.5, 0.5, 0.5] } };
}

function environmentWith(limits) {
  return {
    keyColor: [1, 1, 1],
    lightDirection: [0, 1, 0],
    ...limits.environment,
    pointLights: [{ position: [0, 2, 0], intensity: 5, radius: 0.3, ...limits.point }],
    spotLights: [{ position: [1, 3, 0], direction: [0, -1, 0], angle: 0.6, intensity: 5, radius: 0.2, ...limits.spot }],
    areaLights: [{ position: [2, 3, 0], direction: [0, -1, 0], width: 1, height: 1, intensity: 5, ...limits.area }],
  };
}

const buildLights = limits => buildTraceScene([floorPart()], environmentWith(limits)).lights;

test('a light maxBounces and the sun sunMaxBounces reach the resolved lights', () => {
  const lights = buildLights({ environment: { sunMaxBounces: 2 }, point: { maxBounces: 0 }, spot: { maxBounces: 1 }, area: { maxBounces: 254 } });
  assert.equal(lights.sun.maxBounces, 2);
  assert.equal(lights.points[0].maxBounces, 0);
  assert.equal(lights.spots[0].maxBounces, 1);
  assert.equal(lights.areas[0].maxBounces, 254);
});

test('a scene without a bounce limit resolves lights with no maxBounces field', () => {
  const lights = buildLights({});
  for (const light of [lights.sun, lights.points[0], lights.spots[0], lights.areas[0]]) {
    assert.equal('maxBounces' in light, false);
  }
});

test('a bounce limit that is not a whole number from 0 to 254 names the field and the range', () => {
  const badLimits = [-1, 255, 1.5, '2', null, Number.NaN];
  for (const bad of badLimits) {
    assert.throws(() => buildLights({ point: { maxBounces: bad } }), /environment\.pointLights\[0\]\.maxBounces is a whole number of bounces from 0 to 254/);
    assert.throws(() => buildLights({ spot: { maxBounces: bad } }), /environment\.spotLights\[0\]\.maxBounces is a whole number of bounces from 0 to 254/);
    assert.throws(() => buildLights({ area: { maxBounces: bad } }), /environment\.areaLights\[0\]\.maxBounces is a whole number of bounces from 0 to 254/);
    assert.throws(() => buildLights({ environment: { sunMaxBounces: bad } }), /environment\.sunMaxBounces is a whole number of bounces from 0 to 254/);
  }
});

test('the v1 light table carries the limit plus one in the last float of the last texel, and 0 without one', () => {
  const limited = packLights(buildLights({ point: { maxBounces: 0 }, spot: { maxBounces: 2 }, area: { maxBounces: 254 } }));
  const unlimited = packLights(buildLights({}));
  const codeOf = (packed, index) => packed.table.data[index * LIGHT_TEXEL_FLOATS + BOUNCE_LIMIT_FLOAT_INDEX];
  assert.deepEqual([codeOf(limited, 0), codeOf(limited, 1), codeOf(limited, 2)], [1, 3, 255]);
  assert.deepEqual([codeOf(unlimited, 0), codeOf(unlimited, 1), codeOf(unlimited, 2)], [0, 0, 0]);
});

test('a path tracer other than the native cycles kernel says it ignores a light bounce limit', () => {
  const limited = environmentWith({ point: { maxBounces: 2 } });
  assert.ok(describeIgnoredFeatures([], limited, 'cpu').some(note => /maxBounces .* is ignored/.test(note)));
  assert.ok(describeIgnoredFeatures([], { sunMaxBounces: 2 }, 'cpu').some(note => /maxBounces .* is ignored/.test(note)));
  assert.equal(describeIgnoredFeatures([], limited, 'cpu', { kernelMaterials: true }).some(note => /maxBounces/.test(note)), false);
  assert.equal(describeIgnoredFeatures([], environmentWith({}), 'cpu').some(note => /maxBounces/.test(note)), false);
});
