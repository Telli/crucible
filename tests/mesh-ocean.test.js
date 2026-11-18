import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeshData, applyMeshEdits } from '../src/mesh.js';
import { vertexGroupWeights } from '../src/mesh-data.js';
import { oceanWaves, oceanSurfaceAt } from '../src/mesh-ocean-modifier.js';
import { whitecapFraction, oceanFoamThreshold, oceanFoamWithMemory, foamFromJacobian } from '../src/ocean-waves.js';
import { MESH_MODIFIER_NOTES } from '../src/agent-scene-capabilities.js';

// A flat square of cells x cells quads in the x-z plane, centred on the origin.
function flatGrid(cells, extent) {
  const columns = cells + 1;
  const positions = new Float32Array(columns * columns * 3);
  for (let row = 0; row < columns; row++) {
    for (let column = 0; column < columns; column++) {
      positions.set([(column / cells - 0.5) * extent, 0, (row / cells - 0.5) * extent], (row * columns + column) * 3);
    }
  }
  const faceOffsets = new Uint32Array(cells * cells + 1);
  const cornerVertices = new Uint32Array(cells * cells * 4);
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      const face = row * cells + column;
      const corner = row * columns + column;
      faceOffsets[face + 1] = (face + 1) * 4;
      cornerVertices.set([corner, corner + 1, corner + columns + 1, corner + columns], face * 4);
    }
  }
  return createMeshData({ positions, faceOffsets, cornerVertices });
}

function ocean(overrides = {}) {
  return { op: 'ocean', seed: 7, time: 1.5, ...overrides };
}

test('the same seed and time give identical vertices and foam', () => {
  const grid = flatGrid(24, 60);
  const first = applyMeshEdits(grid, [ocean()]).mesh;
  const second = applyMeshEdits(grid, [ocean()]).mesh;
  assert.deepEqual(Array.from(first.positions), Array.from(second.positions));
  assert.deepEqual(Array.from(vertexGroupWeights(first, 'foam')), Array.from(vertexGroupWeights(second, 'foam')));
  assert.ok(first.positions.some((value, index) => value !== grid.positions[index]), 'the sea moved the vertices');
});

test('another seed or another time gives another sea', () => {
  const grid = flatGrid(12, 60);
  const base = Array.from(applyMeshEdits(grid, [ocean()]).mesh.positions);
  assert.notDeepEqual(Array.from(applyMeshEdits(grid, [ocean({ seed: 8 })]).mesh.positions), base);
  assert.notDeepEqual(Array.from(applyMeshEdits(grid, [ocean({ time: 2.5 })]).mesh.positions), base);
});

test('the surface repeats every size metres and lifts the up axis only without choppiness', () => {
  const waves = oceanWaves({ windSpeed: 12, direction: 30, size: 80, seed: 3, resolution: 6 });
  const here = oceanSurfaceAt(waves, 5, -9, 2, 0);
  const shifted = oceanSurfaceAt(waves, 85, 71, 2, 0);
  assert.ok(Math.abs(here.height - shifted.height) < 1e-9);
  assert.equal(here.moveX, 0);
  assert.equal(here.moveZ, 0);
});

test('the significant wave height follows the wind and foam stays between 0 and 1', () => {
  const grid = flatGrid(40, 100);
  const { mesh } = applyMeshEdits(grid, [ocean({ windSpeed: 12, choppiness: 2, size: 100 })]);
  const heights = Array.from({ length: mesh.vertexCount }, (_, vertex) => mesh.positions[vertex * 3 + 1]);
  const mean = heights.reduce((sum, height) => sum + height, 0) / heights.length;
  const deviation = Math.sqrt(heights.reduce((sum, height) => sum + (height - mean) ** 2, 0) / heights.length);
  const expected = 0.21 * 12 * 12 / 9.81 / 4;
  assert.ok(deviation > expected * 0.3 && deviation < expected * 2.5, `height deviation ${deviation} against ${expected}`);
  const foam = vertexGroupWeights(mesh, 'foam');
  assert.ok(foam.every(weight => weight >= 0 && weight <= 1));
  assert.ok(foam.some(weight => weight > 0), 'strong choppiness folds some crests');
});

test('the up axis can be z, and bad fields are refused with the edit number', () => {
  const grid = flatGrid(4, 20);
  const { mesh } = applyMeshEdits(grid, [ocean({ axis: 'z', choppiness: 0 })]);
  assert.ok(Array.from({ length: mesh.vertexCount }, (_, vertex) => mesh.positions[vertex * 3 + 2]).some(value => value !== 0));
  assert.deepEqual(Array.from({ length: mesh.vertexCount }, (_, vertex) => mesh.positions[vertex * 3 + 1]), Array.from({ length: mesh.vertexCount }, (_, vertex) => grid.positions[vertex * 3 + 1]));
  for (const bad of [{ windSpeed: 0 }, { windSpeed: 61 }, { resolution: 17 }, { seed: -1 }, { size: 0 }, { axis: 'w' }, { choppiness: 5 }]) {
    assert.throws(() => applyMeshEdits(grid, [ocean(bad)]), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => applyMeshEdits(grid, [ocean({ wind: 3 })]), TypeError);
});

test('a sea over too many vertices is refused before it runs', () => {
  const grid = flatGrid(250, 100);
  assert.throws(() => applyMeshEdits(grid, [ocean({ resolution: 16 })]), RangeError);
});

test('the capability notes describe the ocean modifier', () => {
  assert.match(MESH_MODIFIER_NOTES.ocean, /foam/);
});

// Share of rest points over one size of a sea where the foam is at least half, with no memory so it is the Jacobian alone.
function foamFraction({ windSpeed, coverage = 0, choppiness = 1.5, seed = 3 }) {
  const size = 200;
  const waves = oceanWaves({ windSpeed, direction: 0, size, seed, resolution: 8 });
  const threshold = oceanFoamThreshold(waves, { windSpeed, size, choppiness, coverage });
  let counted = 0;
  let total = 0;
  for (let x = 0.5; x < size; x += 3.1) {
    for (let z = 0.5; z < size; z += 3.1) {
      total += 1;
      if (oceanSurfaceAt(waves, x, z, 0, choppiness, threshold).foam >= 0.5) counted += 1;
    }
  }
  return counted / total;
}

test('whitecap fraction follows the Monahan and O Muircheartaigh law and grows with the wind', () => {
  assert.ok(Math.abs(whitecapFraction(10) - 3.84e-6 * 10 ** 3.41) < 1e-12);
  let previous = -1;
  for (const wind of [2, 5, 8, 12, 15, 20, 30, 60]) {
    const fraction = whitecapFraction(wind);
    assert.ok(fraction > previous && fraction <= 1, `whitecaps at ${wind} m/s: ${fraction}`);
    previous = fraction;
  }
});

test('the foam of a sea follows the wind speed: more wind, more whitecaps, near the law', () => {
  const calm = foamFraction({ windSpeed: 8 });
  const fresh = foamFraction({ windSpeed: 15 });
  const gale = foamFraction({ windSpeed: 25 });
  assert.ok(calm < fresh && fresh < gale, `foam follows wind: ${calm} < ${fresh} < ${gale}`);
  assert.ok(Math.abs(fresh - whitecapFraction(15)) < 0.02, `15 m/s foams ${fresh}, the law gives ${whitecapFraction(15)}`);
  assert.equal(foamFraction({ windSpeed: 15, choppiness: 0 }), 0, 'a sea with no choppiness never folds');
});

test('coverage biases the physical foam: below 0 keeps the top peaks and above 0 adds foam', () => {
  const fewer = foamFraction({ windSpeed: 15, coverage: -0.8 });
  const physical = foamFraction({ windSpeed: 15, coverage: 0 });
  const more = foamFraction({ windSpeed: 15, coverage: 0.8 });
  assert.ok(fewer < physical && physical < more, `coverage orders the foam: ${fewer} < ${physical} < ${more}`);
});

test('the foam of an ocean edit is identical for the same seed and bounded to 0 and 1', () => {
  const grid = flatGrid(20, 60);
  const first = vertexGroupWeights(applyMeshEdits(grid, [ocean({ windSpeed: 15, size: 60, foamMemory: 3 })]).mesh, 'foam');
  const second = vertexGroupWeights(applyMeshEdits(grid, [ocean({ windSpeed: 15, size: 60, foamMemory: 3 })]).mesh, 'foam');
  assert.deepEqual(Array.from(first), Array.from(second));
  assert.ok(first.every(weight => weight >= 0 && weight <= 1));
});

test('foam memory only adds foam, and a sea with none is the Jacobian alone', () => {
  const grid = flatGrid(20, 60);
  const foamOf = foamMemory => vertexGroupWeights(applyMeshEdits(grid, [ocean({ windSpeed: 15, size: 60, time: 4, foamMemory })]).mesh, 'foam');
  const none = foamOf(0);
  const short = foamOf(0.5);
  const long = foamOf(4);
  let trailing = 0;
  for (let vertex = 0; vertex < none.length; vertex++) {
    assert.ok(short[vertex] >= none[vertex] && long[vertex] >= none[vertex], 'memory never removes foam');
    if (long[vertex] > none[vertex] + 0.01) trailing++;
  }
  assert.ok(trailing > 0, 'a sea with memory has foam trailing behind the crests');
});

test('foam fades monotonically, and boundedly, after the crest that made it passes', () => {
  // One travelling wave: the Jacobian is lowest at the crest time and rises as the crest moves away (within half a period).
  const wave = { waveX: 0.2, waveZ: 0, waveNumber: 0.2, amplitude: 3, phase: 0, frequency: Math.sqrt(9.81 * 0.2) };
  const waves = [wave];
  const threshold = 0.5;
  const crestTime = 2 * Math.PI / wave.frequency;
  const foamAfter = (delay, memory) => {
    const time = crestTime + delay;
    const now = foamFromJacobian(oceanSurfaceAt(waves, 0, 0, time, 1, threshold).jacobian, threshold);
    return oceanFoamWithMemory(waves, 0, 0, time, 1, threshold, memory, now);
  };
  assert.equal(foamAfter(0, 2), 1, 'full foam at the crest');
  let previous = 1;
  for (const delay of [1, 2, 3]) {
    const foam = foamAfter(delay, 2);
    assert.ok(foam <= previous + 1e-9 && foam >= 0 && foam <= 1, `foam ${foam} at ${delay} s after the crest, ${previous} before`);
    assert.ok(foam >= Math.exp(-delay / 2) - 1e-9, 'on a sample it fades no faster than exp(-t / memory)');
    previous = foam;
  }
  assert.ok(foamAfter(1, 2) > foamAfter(1, 0.25), 'a longer memory keeps more foam');
});

test('the ocean edit takes coverage from -1 to 1 and refuses the rest with the edit number', () => {
  const grid = flatGrid(4, 20);
  const plain = applyMeshEdits(grid, [ocean()]).mesh;
  const covered = applyMeshEdits(grid, [ocean({ coverage: 1 })]).mesh;
  assert.ok(vertexGroupWeights(covered, 'foam').some((weight, vertex) => weight > vertexGroupWeights(plain, 'foam')[vertex]));
  for (const bad of [{ coverage: 1.5 }, { coverage: -2 }, { coverage: 'high' }]) {
    assert.throws(() => applyMeshEdits(grid, [ocean(bad)]), TypeError, JSON.stringify(bad));
  }
});
