import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileMaterialGraph } from '../src/material-graph.js';
import { cellularNoise, smoothCellularDistance } from '../src/material-texture-kit.js';
import { AGENT_SCENE_CAPABILITIES } from '../src/agent-scene-capabilities.js';

const SAMPLES_PER_SIDE = 64;

function evaluatorOf(settings) {
  return compileMaterialGraph({ height: { voronoi: settings } }).outputs.height.evaluate;
}

function sampleGrid(evaluate) {
  const values = new Float64Array(SAMPLES_PER_SIDE * SAMPLES_PER_SIDE);
  for (let row = 0; row < SAMPLES_PER_SIDE; row++) {
    for (let column = 0; column < SAMPLES_PER_SIDE; column++) {
      values[row * SAMPLES_PER_SIDE + column] = evaluate((column + 0.5) / SAMPLES_PER_SIDE, (row + 0.5) / SAMPLES_PER_SIDE);
    }
  }
  return values;
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

test('the existing voronoi outputs evaluate to the same numbers as before #2857', () => {
  // Hash of the Float64 values of these graphs on a 64 by 64 grid, taken from origin/main before the change.
  const hash = createHash('sha256');
  for (const output of ['distance', 'edge', 'cell']) hash.update(Buffer.from(sampleGrid(evaluatorOf({ scale: 6, seed: 2, output })).buffer));
  assert.equal(hash.digest('hex'), '36ce3b2a699f8cd6c2516504744cf50371f5aa8bd3557769c3a045ea7b31c36c');
});

test('naming the default jitter changes nothing, for the library function and the node', () => {
  assert.deepEqual(cellularNoise(0.37, 0.81, 5, 3, 1), cellularNoise(0.37, 0.81, 5, 3));
  assert.deepEqual(sampleGrid(evaluatorOf({ scale: 6, jitter: 1 })), sampleGrid(evaluatorOf({ scale: 6 })));
});

test('jitter 0 puts a point in the middle of every cell, so the cells form a regular grid', () => {
  const evaluate = evaluatorOf({ scale: 4, jitter: 0 });
  assert.ok(evaluate(0.125, 0.375) < 1e-9, 'the distance to the nearest point is 0 at a cell centre');
  assert.ok(Math.abs(evaluate(0.25, 0.375) - 0.5) < 1e-9, 'a cell edge is half a cell from the centre');
  assert.ok(evaluatorOf({ scale: 4, jitter: 0, output: 'f2MinusF1' })(0.25, 0.375) < 1e-9, 'F2 - F1 is 0 on the line between two cells');
  assert.ok(mean(sampleGrid(evaluatorOf({ scale: 6, jitter: 0.5 }))) !== mean(sampleGrid(evaluatorOf({ scale: 6 }))));
});

test('f2 is the second nearest point, f2MinusF1 is F2 - F1 and equals edge', () => {
  const distance = sampleGrid(evaluatorOf({ scale: 6, seed: 4 }));
  const f2 = sampleGrid(evaluatorOf({ scale: 6, seed: 4, output: 'f2' }));
  const gap = sampleGrid(evaluatorOf({ scale: 6, seed: 4, output: 'f2MinusF1' }));
  const edge = sampleGrid(evaluatorOf({ scale: 6, seed: 4, output: 'edge' }));
  assert.deepEqual(gap, edge);
  for (let index = 0; index < distance.length; index++) {
    assert.ok(f2[index] >= distance[index], 'F2 is never nearer than F1');
    assert.ok(Math.abs(gap[index] - Math.min(1, f2[index] - distance[index])) < 1e-12 || f2[index] >= 1);
  }
  assert.ok(mean(f2) > mean(distance) + 0.1);
});

test('smoothF1 with smoothness 0 is F1, and more smoothness lowers it in the cracks without a hard crease', () => {
  const hard = sampleGrid(evaluatorOf({ scale: 6, seed: 4 }));
  const none = sampleGrid(evaluatorOf({ scale: 6, seed: 4, output: 'smoothF1', smoothness: 0 }));
  for (let index = 0; index < hard.length; index++) assert.ok(Math.abs(none[index] - hard[index]) < 1e-12);
  const half = sampleGrid(evaluatorOf({ scale: 6, seed: 4, output: 'smoothF1', smoothness: 0.5 }));
  const full = sampleGrid(evaluatorOf({ scale: 6, seed: 4, output: 'smoothF1' }));
  assert.ok(mean(half) < mean(hard) - 0.005);
  assert.ok(mean(full) < mean(half) - 0.005);
  for (let index = 0; index < hard.length; index++) assert.ok(full[index] <= hard[index] + 1e-9, 'a smooth minimum is never above the minimum');
  // Across the line between two cells (jitter 0) F1 has a crease: its slope flips. The smooth distance has none.
  const step = 1e-4;
  const slopeOf = (evaluate, at) => (evaluate(at + step, 0.375) - evaluate(at - step, 0.375)) / (2 * step);
  const creased = evaluatorOf({ scale: 4, jitter: 0 });
  const smooth = evaluatorOf({ scale: 4, jitter: 0, output: 'smoothF1' });
  assert.ok(Math.abs(slopeOf(creased, 0.25 - 2 * step) - slopeOf(creased, 0.25 + 2 * step)) > 4);
  assert.ok(Math.abs(slopeOf(smooth, 0.25 - 2 * step) - slopeOf(smooth, 0.25 + 2 * step)) < 0.5);
  assert.equal(smoothCellularDistance(0.3, 0.4, 5, 1, 1, 0), cellularNoise(0.3, 0.4, 5, 1).nearest);
});

test('every new output stays in 0 to 1 and tiles, even with one cell across the tile', () => {
  for (const scale of [1, 5]) {
    for (const output of ['f2', 'f2MinusF1', 'smoothF1']) {
      const evaluate = evaluatorOf({ scale, seed: 2, output, jitter: 0.7 });
      for (const value of sampleGrid(evaluate)) assert.ok(value >= 0 && value <= 1, `${output} ${value}`);
      for (const [u, v] of [[0.13, 0.4], [0.5, 0.77], [0.91, 0.02]]) {
        assert.ok(Math.abs(evaluate(u, v) - evaluate(u + 1, v + 2)) < 1e-9, `${output} scale ${scale} at ${u}, ${v}`);
      }
    }
  }
});

test('voronoi output, jitter and smoothness errors say what failed and what to pass', () => {
  assert.throws(() => evaluatorOf({ output: 'f3' }), /voronoi output must be one of distance, edge, cell, f2, f2MinusF1, smoothF1/);
  assert.throws(() => evaluatorOf({ jitter: -0.1 }), /voronoi jitter must be a number from 0 to 1, got -0.1/);
  assert.throws(() => evaluatorOf({ jitter: 2 }), /voronoi jitter must be a number from 0 to 1, got 2/);
  assert.throws(() => evaluatorOf({ jitter: '1' }), /voronoi jitter must be a number from 0 to 1/);
  assert.throws(() => evaluatorOf({ output: 'smoothF1', smoothness: 1.5 }), /voronoi smoothness must be a number from 0 to 1, got 1.5/);
  assert.throws(() => evaluatorOf({ output: 'f2', smoothness: 0.5 }), /smoothness only applies to output "smoothF1"/);
  assert.throws(() => evaluatorOf({ smoothness: 0.5 }), /smoothness only applies to output "smoothF1"/);
  assert.doesNotThrow(() => evaluatorOf({ jitter: 0, output: 'smoothF1', smoothness: 0 }));
});

test('smoothF1 costs more work than the other outputs, which cost what they did', () => {
  const costOf = output => compileMaterialGraph({ roughness: { voronoi: { output } } }).cost;
  assert.equal(costOf('distance'), 10.1);
  assert.equal(costOf('f2'), 10.1);
  assert.ok(costOf('smoothF1') > costOf('f2') * 2);
});

test('scene_capabilities lists every voronoi output, jitter and smoothness', () => {
  const text = AGENT_SCENE_CAPABILITIES.materialGraph.nodes.textures.voronoi;
  for (const word of ['f2', 'f2MinusF1', 'smoothF1', 'jitter', 'smoothness']) assert.ok(text.includes(word), word);
});
