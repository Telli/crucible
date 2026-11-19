import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { sdfGeometry } from '../src/modeling.js';

function hashOf(mesh) {
  const hash = createHash('sha256');
  for (const array of [mesh.positions, mesh.normals, mesh.uvs, mesh.indices]) hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  return hash.digest('hex');
}

function volumeOf({ positions, indices }) {
  let total = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const [firstOffset, secondOffset, thirdOffset] = [0, 1, 2].map(corner => indices[offset + corner] * 3);
    total += (positions[firstOffset] * (positions[secondOffset + 1] * positions[thirdOffset + 2] - positions[secondOffset + 2] * positions[thirdOffset + 1])
      - positions[firstOffset + 1] * (positions[secondOffset] * positions[thirdOffset + 2] - positions[secondOffset + 2] * positions[thirdOffset])
      + positions[firstOffset + 2] * (positions[secondOffset] * positions[thirdOffset + 1] - positions[secondOffset + 1] * positions[thirdOffset])) / 6;
  }
  return total;
}

// Edges that do not belong to exactly two triangles; zero means the surface is closed.
function openEdgeCount({ indices }) {
  const uses = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    for (let side = 0; side < 3; side++) {
      const from = indices[offset + side];
      const to = indices[offset + (side + 1) % 3];
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  return [...uses.values()].filter(count => count !== 2).length;
}

function boundsOf({ positions }) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], positions[offset + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[offset + axis]);
    }
  }
  return { minimum, maximum };
}

const sphere = (radius, position = [0, 0, 0]) => ({ shape: 'sphere', radius, position });
const mesh = (root, resolution = 32) => sdfGeometry({ type: 'sdf', root, resolution });

// A body, a head and two arms blended with a smooth union: the character-body case of the issue.
const CHARACTER = {
  op: 'union',
  smooth: 0.18,
  children: [
    { shape: 'capsule', radius: 0.3, height: 0.7 },
    sphere(0.25, [0, 0.75, 0]),
    { shape: 'capsule', radius: 0.09, height: 0.45, position: [0.45, 0.2, 0], rotation: [0, 0, -0.9] },
    { shape: 'capsule', radius: 0.09, height: 0.45, position: [-0.45, 0.2, 0], rotation: [0, 0, 0.9] },
  ],
};

// An L bracket with a rounded inside corner (smooth union) and a bolt hole (smooth subtract).
const BRACKET = {
  op: 'subtract',
  smooth: 0.02,
  children: [
    {
      op: 'union',
      smooth: 0.12,
      children: [
        { shape: 'box', size: [1, 0.15, 0.5], position: [0, -0.425, 0] },
        { shape: 'box', size: [0.15, 1, 0.5], position: [-0.425, 0, 0] },
      ],
    },
    { shape: 'cylinder', radius: 0.07, height: 1, position: [0.2, -0.425, 0], rotation: [0, 0, 0] },
  ],
};

test('a sphere and a box are closed and close to their analytic volume', () => {
  const ball = mesh(sphere(0.5), 48);
  assert.equal(openEdgeCount(ball), 0);
  assert.ok(Math.abs(volumeOf(ball) / (4 / 3 * Math.PI * 0.125) - 1) < 0.02);
  const block = mesh({ shape: 'box', size: [1, 0.6, 0.8], position: [0.13, 0.07, 0.02] }, 48);
  assert.equal(openEdgeCount(block), 0);
  assert.ok(Math.abs(volumeOf(block) / 0.48 - 1) < 0.02);
  const { minimum, maximum } = boundsOf(block);
  assert.ok(Math.abs(maximum[0] - minimum[0] - 1) < 0.05);
});

test('the surface faces outward and the normals follow the field', () => {
  const ball = mesh(sphere(0.5), 24);
  assert.ok(volumeOf(ball) > 0);
  for (let vertex = 0; vertex < ball.positions.length; vertex += 3) {
    const dot = ball.normals[vertex] * ball.positions[vertex] + ball.normals[vertex + 1] * ball.positions[vertex + 1] + ball.normals[vertex + 2] * ball.positions[vertex + 2];
    assert.ok(dot > 0.4);
  }
});

test('smooth union is watertight and fills more than a hard union', () => {
  const blended = mesh({ op: 'union', smooth: 0.3, children: [sphere(0.4), sphere(0.3, [0.5, 0, 0])] }, 40);
  const hard = mesh({ op: 'union', children: [sphere(0.4), sphere(0.3, [0.5, 0, 0])] }, 40);
  assert.equal(openEdgeCount(blended), 0);
  assert.equal(openEdgeCount(hard), 0);
  assert.ok(volumeOf(blended) > volumeOf(hard));
  assert.equal(openEdgeCount(mesh(CHARACTER, 48)), 0);
  assert.equal(openEdgeCount(mesh(BRACKET, 48)), 0);
});

test('subtract, intersect and offset change the volume as expected', () => {
  const big = sphere(0.5);
  const small = sphere(0.3, [0.4, 0, 0]);
  const whole = volumeOf(mesh(big, 40));
  const carved = mesh({ op: 'subtract', children: [big, small] }, 40);
  const shared = mesh({ op: 'intersect', children: [big, small] }, 40);
  assert.equal(openEdgeCount(carved), 0);
  assert.equal(openEdgeCount(shared), 0);
  assert.ok(Math.abs(volumeOf(carved) + volumeOf(shared) - whole) / whole < 0.03);
  const grown = mesh({ op: 'offset', distance: 0.1, child: big }, 40);
  assert.ok(Math.abs(volumeOf(grown) / (4 / 3 * Math.PI * 0.6 ** 3) - 1) < 0.02);
  const shrunk = mesh({ op: 'offset', distance: -0.1, child: big }, 40);
  assert.ok(Math.abs(volumeOf(shrunk) / (4 / 3 * Math.PI * 0.4 ** 3) - 1) < 0.03);
});

test('every primitive meshes closed, and position, rotation and scale move it', () => {
  for (const root of [
    { shape: 'roundBox', size: [1, 0.5, 0.7], radius: 0.12 },
    { shape: 'capsule' },
    { shape: 'cylinder' },
    { shape: 'torus' },
  ]) {
    assert.equal(openEdgeCount(mesh(root, 40)), 0, root.shape);
  }
  const moved = boundsOf(mesh({ shape: 'box', size: [1, 0.2, 0.2], position: [1, 2, 3], rotation: [0, 0, Math.PI / 2], scale: 2 }, 32));
  assert.ok(Math.abs((moved.maximum[1] - moved.minimum[1]) - 2) < 0.15);
  assert.ok(Math.abs((moved.maximum[0] - moved.minimum[0]) - 0.4) < 0.15);
  assert.ok(Math.abs((moved.maximum[0] + moved.minimum[0]) / 2 - 1) < 0.05);
  assert.ok(Math.abs((moved.maximum[1] + moved.minimum[1]) / 2 - 2) < 0.05);
});

test('the meshing is deterministic and matches the recorded geometry', () => {
  const body = mesh(CHARACTER, 32);
  const bracket = mesh(BRACKET, 32);
  assert.equal(hashOf(mesh(CHARACTER, 32)), hashOf(body));
  assert.deepEqual([body.positions.length / 3, body.indices.length / 3], [RECORDED.bodyVertices, RECORDED.bodyTriangles]);
  assert.deepEqual([bracket.positions.length / 3, bracket.indices.length / 3], [RECORDED.bracketVertices, RECORDED.bracketTriangles]);
  assert.equal(hashOf(body), RECORDED.bodyHash);
  assert.equal(hashOf(bracket), RECORDED.bracketHash);
});

const RECORDED = {
  bodyVertices: 1362, bodyTriangles: 2720, bodyHash: '98016f1be170476cad9110cc47f8e5fd4324f4bd31401436d56cb4bbe614e404',
  bracketVertices: 2526, bracketTriangles: 5052, bracketHash: '73fab5cf025c640fe724b1422356bbf9580bcde4c4cc13be50f2dae0e35c1946',
};

// Two boxes that touch only along one edge: grid points on the two diagonals make saddle cells (#1302).
const EDGE_TOUCHING_BOXES = {
  op: 'union',
  children: [
    { shape: 'box', size: [1, 1, 1], position: [-0.5, -0.5, 0] },
    { shape: 'box', size: [1, 1, 1], position: [0.5, 0.5, 0] },
  ],
};

test('boxes that touch along an edge mesh with every edge joining exactly two quads, at many resolutions', () => {
  for (const resolution of [5, 7, 9, 11, 15, 21, 27, 33]) {
    const result = mesh(EDGE_TOUCHING_BOXES, resolution);
    assert.equal(openEdgeCount(result), 0, `resolution ${resolution}`);
    assert.equal(result.positions.length, result.normals.length);
    assert.equal(result.positions.length / 3 * 2, result.uvs.length);
  }
});

test('the separated saddle copies keep finite, non-zero normals', () => {
  const { normals } = mesh(EDGE_TOUCHING_BOXES, 15);
  for (let offset = 0; offset < normals.length; offset += 3) {
    const length = Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]);
    assert.ok(Number.isFinite(length) && length > 0, `normal ${offset / 3}`);
  }
});

test('bad input names the field and what to pass', () => {
  const failure = (root, pattern, extra = {}) => assert.throws(() => sdfGeometry({ type: 'sdf', root, ...extra }), pattern);
  failure({ shape: 'cone' }, /sdf\.root\.shape is cone; pass one of sphere, box/);
  failure({ shape: 'sphere', radius: -1 }, /sdf\.root\.radius is -1; pass a positive number/);
  failure({ shape: 'sphere', radiu: 1 }, /sdf\.root\.radiu.*remove "radiu"/);
  failure({ shape: 'roundBox', size: [1, 1, 1], radius: 0.9 }, /radius is 0\.9; pass a number from 0 to half the smallest size, 0\.5/);
  failure({ op: 'union', children: [sphere(1)] }, /children is 1 children; pass 2 to 16 nodes/);
  failure({ op: 'union', smooth: -1, children: [sphere(1), sphere(1)] }, /smooth is -1; pass a blend radius/);
  failure({ op: 'blend', children: [] }, /sdf\.root\.op is blend/);
  failure({ op: 'offset', child: sphere(1) }, /distance is undefined; pass a number/);
  failure({ op: 'intersect', children: [sphere(0.1), sphere(0.1, [5, 0, 0])] }, /do not overlap/);
  failure({ shape: 'box', size: [1, 0, 1] }, /size is \[1,0,1\]; pass three positive numbers/);
  failure({ shape: 'sphere', scale: [2, 2, 2] }, /scale is \[2,2,2\]; pass one positive number/);
  failure(sphere(1), /resolution is 129; pass a whole number .* 2097152 cells/, { resolution: 129 });
  failure(sphere(1), /resolution is 2\.5/, { resolution: 2.5 });
  failure(sphere(1), /sdf\.mesh is 1; pass only root and resolution/, { mesh: 1 });
  failure({ op: 'subtract', children: [sphere(0.1), sphere(1)] }, /sdf has no surface/);
  let deep = sphere(1);
  for (let level = 0; level < 9; level++) deep = { op: 'offset', distance: 0, child: deep };
  failure(deep, /nesting deeper than 8/);
  const wide = { op: 'union', children: Array.from({ length: 16 }, () => ({ op: 'union', children: [sphere(1), sphere(1), sphere(1), sphere(1)] })) };
  failure(wide, /more than 64 nodes/);
});

test('a recipe sdf geometry becomes a part and respects the vertex budget', () => {
  const recipe = (geometry, limits) => createAgentScene({
    format: 'crucible.scene',
    schemaVersion: 1,
    materials: [{ id: 'clay', color: [0.8, 0.5, 0.4], roughness: 0.6 }],
    geometries: [{ id: 'g', type: 'sdf', ...geometry }],
    nodes: [{ id: 'n', geometry: 'g', material: 'clay' }],
  }, limits);
  const scene = recipe({ root: CHARACTER, resolution: 24 });
  assert.ok(scene.parts[0].geometry.indices.length > 0);
  assert.throws(() => recipe({ root: CHARACTER, resolution: 128 }, { maxVertices: 1000 }), /vertices|maxVertices/);
  assert.throws(() => recipe({ root: { shape: 'cone' } }), /sdf\.root\.shape/);
});

test('sdf refuses sizes, positions, scale, offsets and blends beyond Float32 range instead of returning NaN', () => {
  const sphere = { shape: 'sphere' };
  const roots = {
    radius: { shape: 'sphere', radius: 1e200 },
    position: { shape: 'sphere', position: [1e300, 0, 0] },
    scale: { shape: 'sphere', scale: 1e300 },
    offset: { op: 'offset', distance: 1e300, child: sphere },
    smooth: { op: 'union', smooth: 1e300, children: [sphere, { shape: 'sphere', position: [1, 0, 0] }] },
  };
  for (const [name, root] of Object.entries(roots)) {
    assert.throws(() => sdfGeometry({ resolution: 16, root }), /sdf\.root bounds is .*within 1e38/, name);
  }
});

test('sdf names a sparse vector or child instead of reporting an empty surface', () => {
  assert.throws(() => sdfGeometry({ resolution: 16, root: { shape: 'box', size: [1, , 1] } }), /sdf\.root\.size is/);
  assert.throws(() => sdfGeometry({ resolution: 16, root: { shape: 'sphere', position: [0, , 0] } }), /sdf\.root\.position is/);
  const children = [{ shape: 'sphere' }, , { shape: 'sphere' }];
  assert.throws(() => sdfGeometry({ resolution: 16, root: { op: 'union', children } }), /sdf\.root\.children\[1\] is/);
});
