import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { filletCurve, resampleCurve } from '../src/curve-operations.js';
import { grid } from '../src/geometry.js';
import { meshFromGeometry, meshEdgesToSplines } from '../src/mesh.js';

test('resampling a curve that starts or ends on a repeated point still gives every sample a unit direction (#2345)', () => {
  const leading = resampleCurve([[0, 0, 0], [0, 0, 0], [1, 0, 0]], 3);
  assert.deepEqual(leading.map(sample => sample.direction), [[1, 0, 0], [1, 0, 0], [1, 0, 0]]);
  const middle = resampleCurve([[0, 0, 0], [1, 0, 0], [1, 0, 0], [1, 1, 0]], 4);
  assert.ok(middle.every(sample => Math.abs(Math.hypot(...sample.direction) - 1) < 1e-9));
  const loop = resampleCurve([[0, 0, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]], 4, true);
  assert.ok(loop.every(sample => Math.abs(Math.hypot(...sample.direction) - 1) < 1e-9));
});

test('a repeated point stays one point when the corners are filleted (#2346)', () => {
  const filleted = filletCurve([[0, 0, 0], [1, 0, 0], [1, 0, 0], [1, 1, 0]], 0.2, 4);
  assert.equal(filleted.length, 4);
  const closed = filletCurve([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0]], 0.2, 4, true);
  assert.ok(closed.every(point => point.every(Number.isFinite)));
});

test('a loop that meets a junction is a closed spline without a repeated end point (#2347)', () => {
  const mesh = meshFromGeometry(grid(3));
  const edgeBetween = (first, second) => {
    for (let edge = 0; edge < mesh.edgeCount; edge++) {
      const pair = [mesh.edgeVertices[edge * 2], mesh.edgeVertices[edge * 2 + 1]];
      if (pair.includes(first) && pair.includes(second)) return edge;
    }
    throw new Error(`no edge between ${first} and ${second}`);
  };
  const vertex = (column, row) => row * 4 + column;
  const loop = [[vertex(0, 0), vertex(1, 0)], [vertex(1, 0), vertex(1, 1)], [vertex(1, 1), vertex(0, 1)], [vertex(0, 1), vertex(0, 0)]];
  const withTail = [...loop, [vertex(1, 1), vertex(2, 1)]];
  const splines = meshEdgesToSplines(mesh, { edges: withTail.map(([first, second]) => edgeBetween(first, second)) });
  const closedLoop = splines.find(spline => spline.closed);
  assert.ok(closedLoop, 'the loop is a closed spline');
  assert.equal(closedLoop.points.length, 4);
  assert.equal(new Set(closedLoop.points.map(point => point.join())).size, 4);
  assert.equal(splines.filter(spline => !spline.closed).length, 1, 'the tail stays open');
});
