import './support/load-agent-scene-modules.mjs';
import { GEOMETRY_PROBLEMS } from '../src/mesh-lint.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { box, cylinder } from '../src/geometry.js';
import { editMesh, validateTopology, meshFromGeometry, lintMesh, meshBounds, tagCounts, applyMeshEdits, faceNormals, facesWithTag } from '../src/mesh.js';
import { bevelEdges, selectEdges, edgeFaces } from '../src/mesh-bevel.js';
import { normalizeMeshEdits } from '../src/mesh-recipe.js';
import { createAgentScene } from '../src/agent-scene.js';

const cube = () => meshFromGeometry(box(0, 1));

// Interior profile points at one end of the corner at x = y = 0.5, as fractions of the width from the corner.
function profileFractions(profile) {
  const width = 0.1;
  const { mesh } = bevelEdges(cube(), { along: [0, 0, 1] }, { width, segments: 3, profile });
  const fractions = [];
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    const [x, y, z] = mesh.positions.subarray(vertex * 3, vertex * 3 + 3);
    if (z < 0.49 || x < 0.39 || y < 0.39) continue;
    const across = (0.5 - x) / width;
    const along = (0.5 - y) / width;
    const isSlidePoint = across > 0.999 || along > 0.999;
    if (!isSlidePoint) fractions.push([across, along]);
  }
  assert.equal(fractions.length, 2);
  return fractions;
}

test('the bevel profile has the meaning it has in Blender', () => {
  for (const [across, along] of profileFractions(0.25)) assert.ok(Math.abs(across + along - 1) < 1e-5, 'flat at 0.25');
  for (const [across, along] of profileFractions(0.5)) assert.ok(Math.abs((1 - across) ** 2 + (1 - along) ** 2 - 1) < 1e-5, 'a circle at 0.5');
  for (const [across, along] of profileFractions(1)) assert.ok(across < 0.02 && along < 0.02, 'square at 1 (capped at 0.99)');
  for (const [across, along] of profileFractions(0.1)) assert.ok(across + along > 1, 'concave below 0.25');
});

test('a beveled edge that ends at a three-faced vertex adds its points to the third face, with no fan', () => {
  const { mesh, cornerFaces } = bevelEdges(cube(), { along: [0, 0, 1] }, { width: 0.1, segments: 2 });
  assert.equal(cornerFaces, 0);
  assert.deepEqual([mesh.vertexCount, mesh.edgeCount, mesh.faceCount], [24, 36, 14]);
  validateTopology(editMesh(mesh));
  assert.equal(lintMesh(mesh).ok, true);
});

function volume(mesh) {
  let total = 0;
  const positions = mesh.positions;
  for (let face = 0; face < mesh.faceCount; face++) {
    const start = mesh.faceOffsets[face];
    const a = mesh.cornerVertices[start] * 3;
    for (let corner = start + 1; corner + 1 < mesh.faceOffsets[face + 1]; corner++) {
      const b = mesh.cornerVertices[corner] * 3;
      const thirdVertexOffset = mesh.cornerVertices[corner + 1] * 3;
      total += (positions[a] * (positions[b + 1] * positions[thirdVertexOffset + 2] - positions[b + 2] * positions[thirdVertexOffset + 1]) + positions[a + 1] * (positions[b + 2] * positions[thirdVertexOffset] - positions[b] * positions[thirdVertexOffset + 2]) + positions[a + 2] * (positions[b] * positions[thirdVertexOffset + 1] - positions[b + 1] * positions[thirdVertexOffset])) / 6;
    }
  }
  return total;
}

function closed(mesh) {
  validateTopology(editMesh(mesh));
  const report = lintMesh(mesh);
  assert.deepEqual(report.problems.filter(problem => !(problem.kind in GEOMETRY_PROBLEMS)), []);
  assert.equal(report.parts.closed, 1);
  return report;
}

test('edge rules select rims, sharp edges, region borders and everything', () => {
  const mesh = cube();
  const table = edgeFaces(mesh);
  const count = rule => selectEdges(mesh, rule, table).reduce((sum, value) => sum + value, 0);
  assert.equal(count({ between: [{ tag: 'top' }, { tag: 'side' }] }), 4);
  assert.equal(count({ angle: 30 }), 12);
  assert.equal(count({ angle: 91 }), 0);
  assert.equal(count({ boundaryOf: { tag: 'front' } }), 4);
  assert.equal(count({ all: true }), 12);
  assert.throws(() => selectEdges(mesh, { angle: 30, all: true }, table), /exactly one/);
  assert.throws(() => selectEdges(mesh, { open: true, along: [1, 0, 0] }, table), /open does not take along/);
  assert.throws(() => selectEdges(mesh, { open: true, maxAngle: 5 }, table), /open does not take maxAngle/);
});

test('chamfering one edge removes exactly the triangular prism', () => {
  const { mesh, bevelEdges: edges, stripFaces } = bevelEdges(cube(), { between: [{ tag: 'front' }, { tag: 'right' }] }, { width: 0.2 });
  closed(mesh);
  assert.equal(edges, 1);
  assert.equal(stripFaces, 1);
  assert.ok(Math.abs(volume(mesh) - (1 - 0.5 * 0.2 * 0.2)) < 1e-6);
});

test('rounded rim keeps the box closed, keeps base tags and tags strips', () => {
  const { mesh, stripFaces, cornerFaces } = bevelEdges(cube(), { between: [{ tag: 'top' }, { tag: 'side' }] }, { width: 0.1, segments: 4, name: 'rim' });
  closed(mesh);
  assert.equal(stripFaces, 16);
  assert.equal(cornerFaces, 0, 'a rim meets the unbeveled vertical edges, so no corner fills are needed');
  const tags = tagCounts(mesh);
  assert.equal(tags['rim.strip'], 16);
  assert.equal(tags.top, 1);
  assert.equal(tags.side, 4);
  const volumeRound = volume(mesh);
  assert.ok(volumeRound > 1 - 4 * 0.5 * 0.01 && volumeRound < 1, 'rounding removes less than a chamfer');
  assert.deepEqual(meshBounds(mesh).max.map(value => Math.round(value * 1e5) / 1e5), [0.5, 0.5, 0.5]);
});

test('beveling every edge fills the corners and clamps widths that would overlap', () => {
  const all = bevelEdges(cube(), { all: true }, { width: 0.1, segments: 3 });
  closed(all.mesh);
  assert.equal(all.filledCorners, 8);
  assert.equal(all.cornerFaces, 72, "each rounded corner fans 9 triangles to its centre");
  const wide = bevelEdges(cube(), { all: true }, { width: 2 });
  closed(wide.mesh);
  assert.equal(wide.clamped, true);
  assert.ok(wide.width < 0.5);
  assert.throws(() => bevelEdges(cube(), { angle: 120 }, { width: 0.1 }), /selects no edges/);
});

test('bevel works on curved caps and on edited meshes', () => {
  const can = bevelEdges(meshFromGeometry(cylinder(24, 0, 1)), { angle: 60 }, { width: 0.05, segments: 3 });
  closed(can.mesh);
  assert.equal(can.bevelEdges, 48);
  const lid = applyMeshEdits(cube(), [
    { op: 'inset_region', select: { tag: 'top' }, thickness: 0.15, name: 'lid' },
    { op: 'extrude_face_region', select: { tag: 'lid.cap' }, offset: 0.2, name: 'raise' },
    { op: 'bevel', edges: { boundaryOf: { tag: 'raise.cap' } }, width: 0.05, segments: 2, name: 'soft' },
  ]);
  closed(lid.mesh);
  assert.equal(lid.results[2].edges, 4);
  assert.equal(lid.results[2].tags['soft.strip'], 8);
});

test('bevel on an open surface keeps the opening as the only problem, and validates its fields', () => {
  const open = applyMeshEdits(cube(), [{ op: 'delete', select: { tag: 'top' } }]).mesh;
  const beveled = bevelEdges(open, { all: true }, { width: 0.1, segments: 2 });
  validateTopology(editMesh(beveled.mesh));
  assert.deepEqual(lintMesh(beveled.mesh).problems.map(problem => problem.kind), ['boundary-edge']);
  assert.equal(beveled.bevelEdges, 8, 'only edges with two faces bevel');
  assert.throws(() => normalizeMeshEdits([{ op: 'bevel', width: 0 }]), /edits\[0\]\.width: got 0; expected a number above 0/);
  assert.throws(() => normalizeMeshEdits([{ op: 'bevel', width: 0.1, segments: 40 }]), /edits\[0\]\.segments: got 40; expected a whole number from 1 to 16/);
  assert.throws(() => normalizeMeshEdits([{ op: 'bevel', width: 0.1, edges: [] }]), /edits\[0\]\.edges: got \[\]; expected an edge rule/);
  assert.deepEqual(normalizeMeshEdits([{ op: 'bevel', width: 0.1 }])[0].edges, { angle: 30 });
});

test('beveling an already beveled mesh winds its corner fills against their neighbours', () => {
  // Regression: corner fills were oriented by an averaged normal, which flipped them next to rounded rims.
  const rim = bevelEdges(cube(), { between: [{ tag: 'top' }, { tag: 'side' }] }, { width: 0.08, segments: 3 }).mesh;
  const second = bevelEdges(rim, { angle: 80 }, { width: 0.02 });
  closed(second.mesh);
  assert.equal(second.filledCorners, 8);
});

test('random bevels on random boxes stay closed and valid', () => {
  let seed = 5;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const rules = [{ all: true }, { angle: 45 }, { between: [{ tag: 'top' }, { tag: 'side' }] }, { boundaryOf: { tag: 'front' } }, { between: [{ tag: 'left' }, { tag: 'bottom' }] }];
  for (let trial = 0; trial < 25; trial++) {
    const stretched = applyMeshEdits(cube(), [
      { op: 'translate', select: { tag: 'top' }, offset: [0, random() * 2, 0] },
      { op: 'translate', select: { tag: 'right' }, offset: [random() * 2, 0, 0] },
    ]).mesh;
    const rule = rules[Math.floor(random() * rules.length)];
    const { mesh } = bevelEdges(stretched, rule, { width: 0.02 + random() * 0.4, segments: 1 + Math.floor(random() * 4), profile: random() });
    closed(mesh);
  }
});

test('recipe meshes bevel as an edit or as a stack node', () => {
  const scene = createAgentScene({
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'block', type: 'mesh', base: { type: 'box', bevel: 0 },
      edits: [{ op: 'bevel', edges: { between: [{ tag: 'top' }, { tag: 'side' }] }, width: 0.08, segments: 3 }],
      stack: [{ op: 'bevel', edges: { angle: 80 }, width: 0.02 }] }],
    materials: [{ id: 'grey', color: [0.5, 0.5, 0.5] }],
    nodes: [{ id: 'block', geometry: 'block', material: 'grey' }],
  });
  const [report] = scene.inspectMeshes().meshes;
  assert.equal(report.ok, true, JSON.stringify(report.problems));
  assert.equal(report.edits[0].edges, 4);
  assert.equal(report.stack[0].op, 'bevel');
  assert.ok(report.stack[0].edges > 0);
});

const bevelAllEdges = options => applyMeshEdits(cube(), [{ op: 'bevel', edges: { all: true }, width: 0.1, ...options }]);
const problemKinds = mesh => lintMesh(mesh).problems.map(problem => problem.kind);

test('profile 1 is capped just below square so no ring point lands on the corner (#1269)', () => {
  for (const segments of [1, 2, 3, 6]) {
    const result = bevelAllEdges({ profile: 1, segments });
    assert.deepEqual(problemKinds(result.mesh), [], `segments ${segments}`);
    assert.equal(lintMesh(result.mesh).ok, true);
  }
  const report = bevelEdges(cube(), { all: true }, { width: 0.1, segments: 3, profile: 1 });
  assert.equal(report.profile, 0.99);
  assert.equal(report.profileClamped, true);
  assert.equal(bevelEdges(cube(), { all: true }, { width: 0.1, segments: 3, profile: 0.9 }).profileClamped, false);
});

test('a concave profile keeps the solid right side out at the default overlap clamp (#1269)', () => {
  for (const segments of [2, 5]) {
    const report = bevelEdges(cube(), { all: true }, { width: 1, segments, profile: 0.1 });
    assert.equal(report.clamped, true);
    assert.ok(report.width < 0.49, `width ${report.width} must shrink below the flat limit`);
    const lint = lintMesh(report.mesh);
    assert.equal(lint.ok, true, JSON.stringify(lint.problems));
  }
  const fine = bevelEdges(cube(), { all: true }, { width: 0.3, segments: 2, profile: 0.1 });
  assert.equal(fine.width, 0.3);
});

test('inset_region clamps a thickness past the face limit and reports what it used (#1269)', () => {
  const inset = thickness => applyMeshEdits(cube(), [{ op: 'inset_region', select: { tag: 'top' }, thickness, name: 'ring' }]);
  for (const thickness of [0.5, 5]) {
    const result = inset(thickness);
    assert.equal(result.results[0].clamped, true, `thickness ${thickness}`);
    assert.equal(result.results[0].thickness, 0.498);
    assert.equal(lintMesh(result.mesh).ok, true);
    assert.deepEqual(problemKinds(result.mesh), []);
    const { normals } = faceNormals(result.mesh);
    for (const face of facesWithTag(result.mesh, 'ring.rim')) assert.ok(normals[face * 3 + 1] > 0.99, 'rim faces keep facing up');
  }
  const fine = inset(0.4);
  assert.equal(fine.results[0].clamped, undefined);
  assert.equal(fine.results[0].thickness, 0.4);
});

test('lintMesh flags faces folded back onto their neighbour (#1269)', () => {
  // Two triangles over the same corners wound oppositely: the second one doubles back over the first.
  const foldedPair = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
  };
  const mesh = meshFromGeometry(foldedPair, { quads: false, tags: 'none' });
  const folded = lintMesh(mesh, { geometry: true }).problems.find(problem => problem.kind === 'folded-face');
  assert.ok(folded, 'expected folded-face');
  assert.equal(folded.severity, 'warning');
  assert.deepEqual(problemKinds(cube()), []);
});

test('lintMesh flags the folded rim of an inset pushed past the centre of its face (#1269)', () => {
  const outer = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const positions = [...outer, ...outer.map(([x, y]) => [x * -0.5, y * -0.5])].flatMap(([x, y]) => [x, y, 0]);
  const rimTriangles = outer.flatMap((_, corner) => {
    const next = (corner + 1) % 4;
    return [corner, next, next + 4, corner, next + 4, corner + 4];
  });
  const geometry = { positions: new Float32Array(positions), indices: new Uint32Array([...rimTriangles, 4, 5, 6, 4, 6, 7]) };
  const mesh = meshFromGeometry(geometry, { quads: false, tags: 'none' });
  const kinds = lintMesh(mesh, { geometry: true }).problems.map(problem => problem.kind);
  assert.ok(kinds.includes('folded-face'), JSON.stringify(kinds));
});

test('inset_region keeps the requested thickness on regions that wrap around a solid (#1269)', () => {
  const regions = [
    ['cube side ring', cube(), { tag: 'side' }],
    ['cube all but the bottom', cube(), { not: { tag: 'bottom' } }],
    ['cylinder side', meshFromGeometry(cylinder(16, 0)), { tag: 'side' }],
  ];
  for (const [label, mesh, select] of regions) {
    for (const thickness of [0.05, 0.1]) {
      const result = applyMeshEdits(mesh, [{ op: 'inset_region', select, thickness, name: 'ring' }]);
      assert.equal(result.results[0].thickness, thickness, `${label} ${thickness}`);
      assert.equal(result.results[0].clamped, undefined, `${label} ${thickness}`);
      assert.deepEqual(problemKinds(result.mesh), [], `${label} ${thickness}`);
    }
  }
});

test('inset_region throws when no thickness keeps the faces intact (#1269)', () => {
  const sliver = meshFromGeometry({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6]),
  }, { quads: false, tags: 'none' });
  assert.throws(() => applyMeshEdits(sliver, [{ op: 'inset_region', select: { all: true }, thickness: 0.5 }]), /thickness/);
});

test('inset_individual clamps each face and reports the thickness used (#1269)', () => {
  const result = applyMeshEdits(cube(), [{ op: 'inset_individual', select: { tag: 'top' }, thickness: 5, name: 'ring' }]);
  assert.equal(result.results[0].clamped, true);
  assert.ok(result.results[0].thickness > 0 && result.results[0].thickness < 0.5);
  assert.deepEqual(problemKinds(result.mesh), []);
});

test('bevel and profile limits are reported through applyMeshEdits (#1269)', () => {
  const [capped] = bevelAllEdges({ profile: 1, segments: 3 }).results;
  assert.equal(capped.profile, 0.99);
  assert.equal(capped.profileClamped, true);
  const [fine] = bevelAllEdges({ profile: 0.9, segments: 3 }).results;
  assert.equal(fine.profile, 0.9);
  assert.equal(fine.profileClamped, undefined);
});

test('the capped profile is clean under default lint up to the highest segment count (#1269)', () => {
  for (const segments of [8, 16]) {
    for (const width of [0.001, 0.1, 0.49]) {
      const { mesh } = bevelAllEdges({ profile: 1, segments, width });
      assert.deepEqual(problemKinds(mesh), [], `segments ${segments} width ${width}`);
    }
    // Geometry lint is stricter: the near-square ring at many segments packs faces into slivers it may flag as warnings, never errors.
    const lint = lintMesh(bevelAllEdges({ profile: 1, segments }).mesh, { geometry: true });
    assert.deepEqual(lint.problems.filter(problem => problem.severity === 'error'), []);
  }
});
