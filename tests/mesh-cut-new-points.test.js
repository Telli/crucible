import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { box, torus } from '../src/geometry.js';
import { meshFromGeometry, applyMeshEdits, selectFaces } from '../src/mesh.js';
import { vertexGroupWeights } from '../src/mesh-data.js';

// The group weighs each vertex by its x position (0 at x = -0.5, 1 at x = 0.5), so a point inserted on a straight edge
// or inside a quad must read the same value as its own x.
const GROUP = { op: 'vertex_group', name: 'ramp', select: { all: true }, gradient: { axis: 'x', range: [-0.5, 0.5], weights: [0, 1] } };

function rampedCube() {
  return applyMeshEdits(meshFromGeometry(box(0, 1)), [GROUP]).mesh;
}

function assertGroupFollowsX(mesh) {
  const weights = vertexGroupWeights(mesh, 'ramp');
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    const expected = Math.min(1, Math.max(0, mesh.positions[vertex * 3] + 0.5));
    assert.ok(Math.abs(weights[vertex] - expected) < 1e-4, `vertex ${vertex} at x ${mesh.positions[vertex * 3]} has weight ${weights[vertex]}, expected ${expected}`);
  }
}

test('subdivide_edges keeps UVs finite when all four sides of a quad are split', () => {
  const torusMesh = meshFromGeometry(torus(0.3, 8, 6));
  const { mesh } = applyMeshEdits(torusMesh, [{ op: 'subdivide_edges', edges: { all: true }, cuts: 2 }]);
  assert.ok(mesh.attributes.corner.uv.data.every(Number.isFinite));
  assert.equal(mesh.faceCount, torusMesh.faceCount * 9);
});

test('subdivide_edges blends vertex groups onto edge points and grid points', () => {
  assertGroupFollowsX(applyMeshEdits(rampedCube(), [{ op: 'subdivide_edges', edges: { all: true }, cuts: 2 }]).mesh);
});

test('bisect_plane blends vertex groups onto cut points, with the cap and a separated shell', () => {
  const plane = { op: 'bisect_plane', point: [0.1, 0, 0], normal: [0, 1, 0.3] };
  assertGroupFollowsX(applyMeshEdits(rampedCube(), [plane]).mesh);
  assertGroupFollowsX(applyMeshEdits(rampedCube(), [{ ...plane, fill: true }]).mesh);
});

test('knife_project blends vertex groups onto the points it inserts on edges', () => {
  const knife = { op: 'knife_project', path: [[-1, 0.1, 2], [1, 0.3, 2]], direction: [0, 0, -1] };
  assertGroupFollowsX(applyMeshEdits(rampedCube(), [knife]).mesh);
});

test('bridge_edge_loops blends vertex groups onto its middle rows', () => {
  const edits = [{ op: 'delete', select: { or: [{ tag: 'top' }, { tag: 'bottom' }] } }, { op: 'bridge_edge_loops', edges: { open: true }, segments: 3 }];
  assertGroupFollowsX(applyMeshEdits(rampedCube(), edits).mesh);
});

test('a selection rule listing more faces than the mesh has says so', () => {
  const cube = meshFromGeometry(box(0, 1));
  assert.throws(() => selectFaces(cube, { faces: [0, 0, 0, 0, 0, 0, 0] }), /lists 7 indices but the mesh has 6 faces/);
  assert.throws(() => selectFaces(cube, { faces: 'a' }), /needs an array of face indices/);
});
