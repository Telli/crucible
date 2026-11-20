import test from 'node:test';
import assert from 'node:assert/strict';
import { box, sphere } from '../src/geometry.js';
import { createEnvironmentMap } from '../src/environment.js';
import { bakeLightmaps } from '../src/light-bake.js';
import { traceObjectProbes } from '../src/probe-trace.js';
import { groundBounceEnvironment } from '../src/ground-bounce.js';
import { strongestLights } from '../src/frame-checks.js';
import { emittingAreaLights } from '../src/area-light-portal.js';

const cube = box(0, 1);
const ball = sphere(16, 12);

function placed(name, geometry, translation, scale, material = {}) {
  const matrix = new Float32Array([scale[0], 0, 0, 0, 0, scale[1], 0, 0, 0, 0, scale[2], 0, translation[0], translation[1], translation[2], 1]);
  return { name, geometry, matrix, material: { tag: 'surface', color: [0.7, 0.7, 0.7], metallic: 0, roughness: 0.8, emission: 0, ...material } };
}

// A closed 6 m room; the mirror ball gives the probe test a reflective part.
function closedRoom() {
  return [
    placed('floor', cube, [0, -0.05, 0], [6, 0.1, 6]),
    placed('ceiling', cube, [0, 3.05, 0], [6, 0.1, 6]),
    placed('back', cube, [0, 1.5, -3.05], [6, 3.2, 0.1]),
    placed('left', cube, [-3.05, 1.5, 0], [0.1, 3.2, 6]),
    placed('right', cube, [3.05, 1.5, 0], [0.1, 3.2, 6]),
    placed('front', cube, [0, 1.5, 3.05], [6, 3.2, 0.1]),
    placed('mirror', ball, [1.5, 0.5, 0], [0.5, 0.5, 0.5], { metallic: 1, roughness: 0.05 }),
  ];
}

const window = { position: [0, 2.9, 0], direction: [0, -1, 0], up: [0, 0, 1], width: 1, height: 1, color: [1, 1, 1], intensity: 20 };
const bakeOptions = { samples: 8, bounces: 1, texelsPerUnit: 2, maxResolution: 32 };

function byteSum(bake) {
  return bake.parts.reduce((total, part) => total + (part.material.emissiveMap?.image.data.reduce((sum, byte) => sum + byte, 0) ?? 0), 0);
}

test('emittingAreaLights drops portals and keeps the order', () => {
  const lamp = { ...window, intensity: 3 };
  assert.deepEqual(emittingAreaLights([lamp, { ...window, portal: true }, lamp]), [lamp, lamp]);
  assert.deepEqual(emittingAreaLights(undefined), []);
});

test('a portal adds no light to a bake: a closed room with only a portal bakes like a room with no light', () => {
  const dark = byteSum(bakeLightmaps(closedRoom(), { keyColor: [0, 0, 0] }, bakeOptions));
  const portal = byteSum(bakeLightmaps(closedRoom(), { areaLights: [{ ...window, portal: true }], keyColor: [0, 0, 0] }, bakeOptions));
  const panel = byteSum(bakeLightmaps(closedRoom(), { areaLights: [window], keyColor: [0, 0, 0] }, bakeOptions));
  assert.equal(portal, dark);
  assert.ok(panel > portal * 2 + 1000, `a normal panel lights the room (${panel}) and a portal does not (${portal})`);
});

test('a portal beside a lamp leaves the lamp unchanged in the bake', () => {
  const lamp = { pointLights: [{ position: [-1.5, 2.5, 0], color: [1, 1, 1], intensity: 8, radius: 0.05 }], keyColor: [0, 0, 0] };
  const lampOnly = byteSum(bakeLightmaps(closedRoom(), lamp, bakeOptions));
  const withPortal = byteSum(bakeLightmaps(closedRoom(), { ...lamp, areaLights: [{ ...window, portal: true }] }, bakeOptions));
  assert.equal(withPortal, lampOnly);
});

test('object reflection probes do not see a portal as a lamp', () => {
  const trace = areaLights => traceObjectProbes(closedRoom(), { areaLights, keyColor: [0, 0, 0] }, { width: 32, samples: 8, bounces: 1 }).traced[0].data;
  const checksum = data => Array.from(data).reduce((sum, value) => sum + value, 0);
  const none = checksum(trace([]));
  assert.equal(checksum(trace([{ ...window, portal: true }])), none);
  assert.ok(checksum(trace([window])) > none, 'a normal panel brightens the probe');
});

test('the room bounce estimate counts a normal panel and not a portal', () => {
  const sky = createEnvironmentMap({ width: 8, height: 4, data: new Float32Array(8 * 4 * 3).fill(0.5) });
  const environment = areaLights => ({ map: sky, keyColor: [0, 0, 0], lightDirection: [0, 1, 0], areaLights });
  const room = closedRoom().slice(0, 6);
  const portalOnly = environment([{ ...window, portal: true }]);
  assert.equal(groundBounceEnvironment(room, portalOnly), portalOnly, 'a closed room with a portal has no light of its own to bounce');
  const lit = groundBounceEnvironment(room, environment([window]));
  assert.notEqual(lit, undefined);
  assert.ok(lit.map.bounce?.some(channel => channel > 0), 'a normal panel gives the walls a bounce colour');
});

test('strongestLights never names a portal as the light to turn down', () => {
  const lights = strongestLights({ keyIntensity: 1, areaLights: [{ intensity: 90, portal: true }, { intensity: 5 }] });
  assert.deepEqual(lights.map(light => light.field), ['environment.areaLights[1].intensity', 'environment.keyIntensity']);
});
