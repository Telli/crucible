// The sky light that a closed room's surfaces bounce on to each other (#1334): the raster darkened every point the window cannot
// see to the level of a sealed room, while a path tracer lights them with the light that came in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { box } from '../src/geometry.js';
import { applyDefaultFloorSky, interiorSkyFill, INTERIOR_FILL_MAXIMUM } from '../src/floor-sky-visibility.js';

const HALF_WIDTH = 4;
const FRONT = -3;
const BACK = 3.5;
const HEIGHT = 3;
const WALL = 0.2;
const SUN = { keyIntensity: 1 };

function slab(name, center, size) {
  const matrix = new Float32Array([size[0], 0, 0, 0, 0, size[1], 0, 0, 0, 0, size[2], 0, center[0], center[1], center[2], 1]);
  return { name, geometry: box(0, 1), matrix, material: { color: [0.7, 0.7, 0.7], metallic: 0, roughness: 0.9 } };
}

// The probe room of bench/reference/interior-exposure.mjs: a window in the front wall, or none when sealed.
function room({ window }) {
  const depth = BACK - FRONT;
  const middleZ = (FRONT + BACK) / 2;
  const frontZ = FRONT - WALL / 2;
  const parts = [
    slab('floor', [0, -WALL / 2, middleZ], [HALF_WIDTH * 2 + WALL * 2, WALL, depth + WALL * 2]),
    slab('ceiling', [0, HEIGHT + WALL / 2, middleZ], [HALF_WIDTH * 2 + WALL * 2, WALL, depth + WALL * 2]),
    slab('wall-left', [-HALF_WIDTH - WALL / 2, HEIGHT / 2, middleZ], [WALL, HEIGHT, depth + WALL * 2]),
    slab('wall-right', [HALF_WIDTH + WALL / 2, HEIGHT / 2, middleZ], [WALL, HEIGHT, depth + WALL * 2]),
    slab('wall-back', [0, HEIGHT / 2, BACK + WALL / 2], [HALF_WIDTH * 2, HEIGHT, WALL]),
  ];
  if (!window) {
    parts.push(slab('wall-front', [0, HEIGHT / 2, frontZ], [HALF_WIDTH * 2, HEIGHT, WALL]));
    return parts;
  }
  const opening = { halfWidth: 1.4, bottom: 0.9, top: 2.4 };
  const side = HALF_WIDTH - opening.halfWidth;
  parts.push(
    slab('front-left', [-(opening.halfWidth + side / 2), HEIGHT / 2, frontZ], [side, HEIGHT, WALL]),
    slab('front-right', [opening.halfWidth + side / 2, HEIGHT / 2, frontZ], [side, HEIGHT, WALL]),
    slab('front-sill', [0, opening.bottom / 2, frontZ], [opening.halfWidth * 2, opening.bottom, WALL]),
    slab('front-head', [0, (opening.top + HEIGHT) / 2, frontZ], [opening.halfWidth * 2, HEIGHT - opening.top, WALL]),
  );
  return parts;
}

// The mean sky visibility of the vertices whose normal points along `normalAxis` in the direction `normalSign`.
function faceMean(part, normalAxis, normalSign) {
  const { skyVisibility, normals } = part.geometry;
  let sum = 0;
  let count = 0;
  for (let vertex = 0; vertex < skyVisibility.length; vertex++) {
    if (Math.round(normals[vertex * 3 + normalAxis]) !== normalSign) continue;
    sum += skyVisibility[vertex];
    count += 1;
  }
  return sum / count;
}

test('the fill follows the bounce series: nothing for a sealed room, more for a brighter and more open room', () => {
  assert.equal(interiorSkyFill(0, 0.6), 0);
  assert.equal(interiorSkyFill(0.03, 0), 0);
  // 4 (fitted gain) x 0.6 x 0.03 / (1 - 0.6 x 0.97)
  assert.ok(Math.abs(interiorSkyFill(0.03, 0.6) - 0.1722) < 0.001, `got ${interiorSkyFill(0.03, 0.6)}`);
  assert.ok(interiorSkyFill(0.03, 0.8) > interiorSkyFill(0.03, 0.4));
  assert.ok(interiorSkyFill(0.06, 0.6) > interiorSkyFill(0.03, 0.6));
  assert.equal(interiorSkyFill(0.9, 0.9), INTERIOR_FILL_MAXIMUM);
});

test('a room with a window reports its fill, and a sealed room reports none', () => {
  const windowed = applyDefaultFloorSky(room({ window: true }), SUN, { maximumTexels: 4000 }).report;
  const sealed = applyDefaultFloorSky(room({ window: false }), SUN, { maximumTexels: 4000 }).report;
  assert.ok(windowed.interiorFill > 0.1 && windowed.interiorFill < 0.3, `window room fill ${windowed.interiorFill}`);
  assert.equal(sealed.interiorFill, 0);
});

test('the fill lifts the inside faces of a windowed room and leaves its outside faces and a sealed room alone', () => {
  const windowed = applyDefaultFloorSky(room({ window: true }), SUN, { maximumTexels: 4000 }).parts;
  const sealed = applyDefaultFloorSky(room({ window: false }), SUN, { maximumTexels: 4000 }).parts;
  const insideBackWallWindowed = faceMean(windowed.find(part => part.name === 'wall-back'), 2, -1);
  const insideBackWallSealed = faceMean(sealed.find(part => part.name === 'wall-back'), 2, -1);
  assert.ok(insideBackWallWindowed > insideBackWallSealed + 0.15, `inside back wall ${insideBackWallWindowed.toFixed(3)} against sealed ${insideBackWallSealed.toFixed(3)}`);
  assert.ok(insideBackWallSealed < 0.1, `a sealed room stays dark inside: ${insideBackWallSealed.toFixed(3)}`);
  const outsideRoof = faceMean(windowed.find(part => part.name === 'ceiling'), 1, 1);
  assert.ok(outsideRoof > 0.9, `the roof stays open to the sky: ${outsideRoof.toFixed(3)}`);
});

test('an open scene gets no fill', () => {
  const open = [room({ window: false })[0], room({ window: false })[2]];
  const { report } = applyDefaultFloorSky(open, SUN, { maximumTexels: 4000 });
  assert.equal(report.interiorFill ?? 0, 0);
});
