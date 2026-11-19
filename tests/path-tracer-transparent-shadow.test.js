// Issue 2318: the CPU path tracer's shadow ray steps through glass and water instead of stopping at them. The light that gets
// through a slab is Fresnel transmission at each face, times the part's colour at each face, times Beer-Lambert absorption inside.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createEnvironmentMap } from '../src/environment.js';
import { box } from '../src/geometry.js';
import { renderPathTracedImage } from '../src/path-tracer.js';

const SLAB_THICKNESS = 0.2;
const GLASS_IOR = 1.5;
const FRESNEL_AT_NORMAL_INCIDENCE = ((GLASS_IOR - 1) / (GLASS_IOR + 1)) ** 2;
const ENVIRONMENT = { keyColor: [3, 3, 3], lightDirection: [0, 1, 0] };
const CAMERA = { eye: [0, 6, 0], target: [0, 0, 0], up: [0, 0, -1], fov: 30 };
const OPTIONS = { width: 16, height: 16, samples: 8, bounces: 1, denoise: false, threads: 1, backend: 'cpu' };

function placed(translation, scale) {
  return new Float32Array([scale[0], 0, 0, 0, 0, scale[1], 0, 0, 0, 0, scale[2], 0, translation[0], translation[1], translation[2], 1]);
}

function floor() {
  const material = { tag: 'surface', metallic: 0, roughness: 1, emission: 0, color: [0.5, 0.5, 0.5] };
  return { name: 'floor', geometry: box(0, 1), matrix: placed([0, -0.05, 0], [20, 0.1, 20]), material };
}

/** A slab between the sun and the floor that only casts a shadow: the camera looks straight through it. */
function slab(materialFields) {
  const material = { tag: 'surface', metallic: 0, roughness: 0, emission: 0, color: [1, 1, 1], ior: GLASS_IOR, ...materialFields };
  return { name: 'slab', geometry: box(0, 1), matrix: placed([0, 1.5, 0], [4, SLAB_THICKNESS, 4]), material, shadowOnly: true };
}

async function floorRadiance(parts) {
  const { linear } = await renderPathTracedImage({ parts, environment: ENVIRONMENT, camera: CAMERA }, OPTIONS);
  const centre = (8 * OPTIONS.width + 8) * 3;
  return [linear[centre], linear[centre + 1], linear[centre + 2]];
}

function assertShare(actual, litFloor, expectedShare, tolerance, label) {
  for (let channel = 0; channel < 3; channel++) {
    const share = actual[channel] / litFloor[channel];
    assert.ok(Math.abs(share - expectedShare[channel]) < tolerance, `${label}: channel ${channel} keeps ${share}, expected ${expectedShare[channel]}`);
  }
}

test('a clear glass slab lets (1 - Fresnel) squared of the sun through, one Fresnel loss per face', async () => {
  const lit = await floorRadiance([floor()]);
  assert.ok(lit[0] > 0.3, 'the bare floor is lit by the sun');
  const shaded = await floorRadiance([floor(), slab({ transmission: 1 })]);
  const faceShare = 1 - FRESNEL_AT_NORMAL_INCIDENCE;
  assertShare(shaded, lit, [faceShare ** 2, faceShare ** 2, faceShare ** 2], 0.01, 'clear glass');
});

test('the slab also multiplies the sun by its colour at each face and by Beer-Lambert absorption over its thickness', async () => {
  const lit = await floorRadiance([floor()]);
  const colour = [1, 0.8, 0.5];
  const absorption = [0.5, 0.25, 1];
  const shaded = await floorRadiance([floor(), slab({ transmission: 1, color: colour, attenuationColor: absorption, attenuationDistance: SLAB_THICKNESS })]);
  const faceShare = 1 - FRESNEL_AT_NORMAL_INCIDENCE;
  const expected = colour.map((faceColour, channel) => faceShare ** 2 * faceColour ** 2 * absorption[channel]);
  assertShare(shaded, lit, expected, 0.01, 'tinted absorbing glass');
});

test('half transmission lets half of the clear-glass share through', async () => {
  const lit = await floorRadiance([floor()]);
  const shaded = await floorRadiance([floor(), slab({ transmission: 0.5 })]);
  const faceShare = 1 - FRESNEL_AT_NORMAL_INCIDENCE;
  const expected = 0.25 * faceShare ** 2;
  assertShare(shaded, lit, [expected, expected, expected], 0.01, 'half transmission');
});

test('an opaque slab in the same place still gives a full shadow', async () => {
  const shaded = await floorRadiance([floor(), slab({ transmission: 0 })]);
  assert.deepEqual(shaded, [0, 0, 0]);
});

test('the sky is not counted twice through a clear slab: a shadow ray to the sky stops at glass, the bounce through it carries the light', async () => {
  const skyOnly = { keyColor: [0, 0, 0], map: createEnvironmentMap({ width: 8, height: 4, data: new Float32Array(8 * 4 * 3).fill(1) }) };
  const render = async parts => {
    const { linear } = await renderPathTracedImage({ parts, environment: skyOnly, camera: CAMERA }, { ...OPTIONS, samples: 64, bounces: 3 });
    const centre = (8 * OPTIONS.width + 8) * 3;
    return linear[centre];
  };
  const bare = await render([floor()]);
  const underGlass = await render([floor(), slab({ transmission: 1, ior: 1 })]);
  assert.ok(Math.abs(bare - 0.5) < 0.05, `a floor of albedo 0.5 under a uniform sky of 1 is lit to 0.5, got ${bare}`);
  assert.ok(Math.abs(underGlass / bare - 1) < 0.04, `an index-1 slab changes nothing, so the floor keeps ${underGlass / bare} of its light`);
});
