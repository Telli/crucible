import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { compileMaterialGraph, graphSurfaceSettings } from '../src/material-graph.js';
import { materialViewForGeometry, normalizeMaterialPattern } from '../src/material-patterns.js';
import { surfaceMap } from '../src/material-surface-map.js';

const RESOLUTION = 96;
const CELL_COLUMNS = 3;
const CELL_ROWS = 2;
const SLOPE_GRAPH = { color: { mul: [[1, 1, 1], { surface: { output: 'slope' } }] } };
const IDENTITY = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
// A quarter turn around Z, column-major: +X now points up and +Y points to -X.
const QUARTER_TURN = Float32Array.from([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// A unit cube centred on the origin with hard edges. Face i fills cell (i % 3, floor(i / 3)) of a 3 by 2 UV grid.
const FACES = [
  { name: 'right', normal: [1, 0, 0], tangent: [0, 0, -1], bitangent: [0, 1, 0] },
  { name: 'left', normal: [-1, 0, 0], tangent: [0, 0, 1], bitangent: [0, 1, 0] },
  { name: 'top', normal: [0, 1, 0], tangent: [1, 0, 0], bitangent: [0, 0, -1] },
  { name: 'bottom', normal: [0, -1, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1] },
  { name: 'front', normal: [0, 0, 1], tangent: [1, 0, 0], bitangent: [0, 1, 0] },
  { name: 'back', normal: [0, 0, -1], tangent: [-1, 0, 0], bitangent: [0, 1, 0] },
];

function cubeGeometry({ withNormals = true } = {}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  FACES.forEach((face, faceIndex) => {
    const base = positions.length / 3;
    for (const [across, up] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let axis = 0; axis < 3; axis++) positions.push(0.5 * face.normal[axis] + 0.5 * across * face.tangent[axis] + 0.5 * up * face.bitangent[axis]);
      normals.push(...face.normal);
      uvs.push(((faceIndex % CELL_COLUMNS) + (across + 1) / 2) / CELL_COLUMNS, (Math.floor(faceIndex / CELL_COLUMNS) + (up + 1) / 2) / CELL_ROWS);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return {
    positions: Float32Array.from(positions),
    ...(withNormals ? { normals: Float32Array.from(normals) } : {}),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  };
}

function faceValue(map, faceName, fraction = 0.5) {
  const faceIndex = FACES.findIndex(face => face.name === faceName);
  const column = Math.floor(((faceIndex % CELL_COLUMNS) + fraction) / CELL_COLUMNS * map.width);
  const row = Math.floor((Math.floor(faceIndex / CELL_COLUMNS) + fraction) / CELL_ROWS * map.height);
  return map.data[(row * map.width + column) * 4];
}

// A hemisphere facing up with its pole at v = 0 and its rim at v = 1, so the polar angle at v is v * pi / 2.
function hemisphereGeometry(rings = 48, segments = 48) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let ring = 0; ring <= rings; ring++) {
    const polar = (ring / rings) * Math.PI / 2;
    for (let segment = 0; segment <= segments; segment++) {
      const azimuth = (segment / segments) * Math.PI * 2;
      const normal = [Math.sin(polar) * Math.cos(azimuth), Math.cos(polar), Math.sin(polar) * Math.sin(azimuth)];
      positions.push(...normal);
      normals.push(...normal);
      uvs.push(segment / segments, ring / rings);
    }
  }
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const first = ring * (segments + 1) + segment;
      const below = first + segments + 1;
      indices.push(first, below, first + 1, first + 1, below, below + 1);
    }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices) };
}

function rowAt(map, v, column = Math.floor(map.width / 2)) {
  return map.data[(Math.floor(v * map.height) * map.width + column) * 4];
}

test('slope on a cube is 0 on the top face and 1 on every wall and on the bottom', () => {
  const map = surfaceMap(cubeGeometry(), { output: 'slope', space: 'object' }, RESOLUTION, 'cube');
  assert.equal(faceValue(map, 'top'), 0);
  for (const wall of ['left', 'right', 'front', 'back', 'bottom']) assert.equal(faceValue(map, wall), 255, wall);
});

test('slope on a hemisphere grows from 0 at the pole to 1 at the rim, as the angle from up', () => {
  const geometry = hemisphereGeometry();
  const map = surfaceMap(geometry, { output: 'slope', space: 'object' }, 256, 'dome');
  for (const v of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const expected = v * 255;
    assert.ok(Math.abs(rowAt(map, v) - expected) <= 4, `slope at v ${v}: ${rowAt(map, v)} against ${expected.toFixed(1)}`);
  }
  const normalY = surfaceMap(geometry, { output: 'normalY', space: 'object' }, 256, 'dome');
  const expectedNormalY = (0.5 + 0.5 * Math.cos(0.5 * Math.PI / 2)) * 255;
  assert.ok(Math.abs(rowAt(normalY, 0.5) - expectedNormalY) <= 4, 'normalY at the 45 degree ring is 0.5 + 0.5 cos 45');
  const height = surfaceMap(geometry, { output: 'height', space: 'object' }, 256, 'dome');
  assert.ok(Math.abs(rowAt(height, 0.5) - Math.cos(0.5 * Math.PI / 2) * 255) <= 4, 'height of the 45 degree ring is cos 45, with the rim at 0 and the pole at 1');
});

test('a mesh without normals uses its face normals', () => {
  const map = surfaceMap(cubeGeometry({ withNormals: false }), { output: 'slope', space: 'object' }, RESOLUTION, 'flat');
  assert.equal(faceValue(map, 'top'), 0);
  assert.equal(faceValue(map, 'front'), 255);
});

test('height is normalised over the mesh bounds unless a range is given', () => {
  const geometry = cubeGeometry();
  const bounded = surfaceMap(geometry, { output: 'height', space: 'object' }, RESOLUTION, 'cube');
  assert.equal(faceValue(bounded, 'top'), 255, 'the top face is the top of the bounds');
  assert.equal(faceValue(bounded, 'bottom'), 0, 'the bottom face is the bottom of the bounds');
  assert.ok(Math.abs(faceValue(bounded, 'front') - 128) <= 2, 'the middle of a wall is half way up');
  const ranged = surfaceMap(geometry, { output: 'height', space: 'object', range: [-0.5, 1.5] }, RESOLUTION, 'cube');
  assert.ok(Math.abs(faceValue(ranged, 'top') - 128) <= 1, 'the top at 0.5 m in a range of -0.5 to 1.5 m is half');
  assert.equal(faceValue(ranged, 'bottom'), 0);
  const clipped = surfaceMap(geometry, { output: 'height', space: 'object', range: [0.6, 2] }, RESOLUTION, 'cube');
  assert.equal(faceValue(clipped, 'top'), 0, 'a position below the range clamps to 0');
});

test('world space places the mesh with the world matrix; object space ignores it', () => {
  const geometry = cubeGeometry();
  const world = surfaceMap(geometry, { output: 'slope', space: 'world' }, RESOLUTION, 'cube', QUARTER_TURN);
  assert.equal(faceValue(world, 'right'), 0, 'the face that pointed along +X is now the top');
  assert.equal(faceValue(world, 'top'), 255, 'the old top now faces sideways');
  const object = surfaceMap(geometry, { output: 'slope', space: 'object' }, RESOLUTION, 'cube', QUARTER_TURN);
  assert.equal(faceValue(object, 'top'), 0);
  assert.equal(faceValue(object, 'right'), 255);
  const lifted = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 10, 0, 1]);
  const placed = surfaceMap(geometry, { output: 'height', space: 'world', range: [9.5, 10.5] }, RESOLUTION, 'cube', lifted);
  assert.equal(faceValue(placed, 'bottom'), 0);
  assert.equal(faceValue(placed, 'top'), 255, 'the world range follows the part 10 m up');
  assert.equal(surfaceMap(geometry, { output: 'slope', space: 'world' }, RESOLUTION, 'cube', QUARTER_TURN), world, 'the map is cached per geometry and matrix');
});

test('a mirrored world matrix keeps the normals pointing out', () => {
  const mirrored = Float32Array.from([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const map = surfaceMap(cubeGeometry(), { output: 'slope', space: 'world' }, RESOLUTION, 'cube', mirrored);
  assert.equal(faceValue(map, 'top'), 0);
  assert.equal(faceValue(map, 'left'), 255);
});

test('surface validates its settings without a mesh and reports them', () => {
  assert.ok(compileMaterialGraph(SLOPE_GRAPH).outputs.color);
  const bad = [
    [{ surface: {} }, /surface output must be one of slope, normalY, height/],
    [{ surface: { output: 'curl' } }, /got "curl"/],
    [{ surface: { output: 'slope', space: 'screen' } }, /surface space must be one of object, world/],
    [{ surface: { output: 'slope', range: [0, 1] } }, /range only applies to output "height"/],
    [{ surface: { output: 'height', range: [1, 1] } }, /range must be \[low, high\]/],
    [{ surface: { output: 'height', range: [0] } }, /range must be \[low, high\]/],
    [{ surface: { output: 'slope', extra: 1 } }, /surface/],
  ];
  for (const [node, message] of bad) assert.throws(() => compileMaterialGraph({ roughness: node }), message);
  const graph = { color: { mix: [{ surface: { output: 'slope' } }, { surface: { output: 'height', range: [0, 2] } }, { surface: { output: 'slope', space: 'world' } }] } };
  assert.deepEqual(graphSurfaceSettings(graph), [
    { output: 'slope', space: 'world' },
    { output: 'height', space: 'world', range: [0, 2] },
  ]);
});

test('a graph with surface needs uv mapping and a mesh with UVs', () => {
  assert.throws(() => normalizeMaterialPattern({ type: 'graph', graph: SLOPE_GRAPH }), /surface node.*"mapping": "uv"/);
  assert.ok(normalizeMaterialPattern({ type: 'graph', mapping: 'uv', graph: SLOPE_GRAPH }));
  const bare = { positions: new Float32Array(9), indices: Uint32Array.from([0, 1, 2]) };
  assert.throws(() => surfaceMap(bare, { output: 'slope', space: 'world' }, 64, 'rock'), /surface: got "slope"; expected a mesh with UVs \(node rock has none\)/);
});

function recipeWith(edits, graph) {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'block', type: 'mesh', base: { type: 'box', bevel: 0, subdivisions: 1 }, edits }],
    materials: [{ id: 'snowy', pattern: { type: 'graph', mapping: 'uv', resolution: 256, graph } }],
    nodes: [{ id: 'block', geometry: 'block', material: 'snowy' }],
  };
}

function redValues(texture) {
  const values = new Set();
  for (let offset = 0; offset < texture.image.data.length; offset += 4) values.add(texture.image.data[offset]);
  return values;
}

test('a part bakes slope from its own mesh, and a box without UVs is refused', () => {
  assert.throws(() => createAgentScene(recipeWith([], SLOPE_GRAPH)), /surface: got "slope"; expected a mesh with UVs \(node block has none\)/);
  const [part] = createAgentScene(recipeWith([{ op: 'uv_project', mode: 'cube' }], SLOPE_GRAPH)).parts;
  const values = redValues(part.material.map);
  assert.ok(values.has(0), 'the top face is flat');
  assert.ok(values.has(255), 'the walls are vertical');
});

test('the view is rebuilt when the part moves in world space and kept for object space', () => {
  const geometry = cubeGeometry();
  const worldPattern = normalizeMaterialPattern({ type: 'graph', mapping: 'uv', resolution: 256, graph: SLOPE_GRAPH });
  const material = { pattern: worldPattern, map: null };
  const first = materialViewForGeometry(material, geometry, 'cube', undefined, IDENTITY);
  assert.equal(materialViewForGeometry(material, geometry, 'cube', undefined, IDENTITY), first);
  assert.notEqual(materialViewForGeometry(material, geometry, 'cube', undefined, QUARTER_TURN), first);
  const objectGraph = { color: { surface: { output: 'slope', space: 'object' } } };
  const objectPattern = normalizeMaterialPattern({ type: 'graph', mapping: 'uv', resolution: 256, graph: objectGraph });
  const objectMaterial = { pattern: objectPattern, map: null };
  const kept = materialViewForGeometry(objectMaterial, geometry, 'cube', undefined, IDENTITY);
  assert.equal(materialViewForGeometry(objectMaterial, geometry, 'cube', undefined, QUARTER_TURN), kept);
});
