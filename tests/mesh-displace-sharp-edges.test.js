import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { sphere } from '../src/geometry.js';
import { applyMeshEdits, meshFromGeometry } from '../src/mesh.js';
import { evaluateField, meshFieldContext } from '../src/mesh-fields.js';
import { lintMesh } from '../src/mesh-lint.js';
import { vertexNormals } from '../src/mesh-normals.js';
import { overhangingEdgeVertices, sharpSubdividedBox } from './support/sharp-subdivided-box.js';

const noiseDisplace = [{ op: 'displace', field: { noise: { scale: 3, seed: 7 } }, strength: 0.4 }];

function problemCounts(mesh) {
  return Object.fromEntries(lintMesh(mesh, { geometry: true }).problems.map(problem => [problem.kind, problem.count]));
}

test('a noise displace of a subdivided sharp box leaves no folded edge (#2224)', () => {
  const box = sharpSubdividedBox(64);
  assert.equal(box.vertexCount, 6 * 64 * 64 + 2);
  assert.equal(problemCounts(box)['folded-face'], undefined);
  const displaced = applyMeshEdits(box, noiseDisplace).mesh;
  assert.equal(problemCounts(displaced)['folded-face'], undefined);
});

test('no rim vertex of a displaced sharp box stands out from the side face next to it (#2224)', () => {
  for (const [spans, scale] of [[64, 3], [24, 6]]) {
    const box = sharpSubdividedBox(spans);
    const displaced = applyMeshEdits(box, [{ op: 'displace', field: { noise: { scale, seed: 7 } }, strength: 0.4 }]).mesh;
    assert.equal(overhangingEdgeVertices(box, displaced), 0, `${spans} spans, noise scale ${scale}`);
    assert.equal(problemCounts(displaced)['folded-face'], undefined);
  }
});

test('a coarse sharp box displaces without NaN and keeps every vertex near its start', () => {
  const box = sharpSubdividedBox(2);
  const displaced = applyMeshEdits(box, noiseDisplace).mesh;
  for (const value of displaced.positions) assert.ok(Number.isFinite(value));
  for (let vertex = 0; vertex < box.vertexCount; vertex++) {
    const moved = Math.hypot(...[0, 1, 2].map(axis => displaced.positions[vertex * 3 + axis] - box.positions[vertex * 3 + axis]));
    assert.ok(moved <= 0.4, `vertex ${vertex} moved ${moved}`);
  }
});

test('the same seed gives the same displaced box bytes', () => {
  const first = applyMeshEdits(sharpSubdividedBox(16), noiseDisplace).mesh;
  const second = applyMeshEdits(sharpSubdividedBox(16), noiseDisplace).mesh;
  assert.deepEqual(Buffer.from(first.positions.buffer), Buffer.from(second.positions.buffer));
});

test('a smooth sphere still moves each vertex by distance times its angle-weighted normal', () => {
  const ball = meshFromGeometry(sphere(24, 12));
  const edit = { op: 'displace', field: { noise: { scale: 2, seed: 3 } }, strength: 0.3 };
  const displaced = applyMeshEdits(ball, [edit]).mesh;
  const normals = vertexNormals(ball);
  const reference = new Float32Array(ball.positions);
  const { values } = evaluateField(edit.field, meshFieldContext(ball, 'point'), { kind: 'scalar' });
  for (let vertex = 0; vertex < ball.vertexCount; vertex++) {
    const distance = (values[vertex] - 0.5) * edit.strength;
    for (let axis = 0; axis < 3; axis++) reference[vertex * 3 + axis] += distance * normals[vertex * 3 + axis];
  }
  assert.deepEqual(Buffer.from(displaced.positions.buffer), Buffer.from(reference.buffer));
});
