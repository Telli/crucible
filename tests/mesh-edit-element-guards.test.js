import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { box } from '../src/geometry.js';
import { meshFromGeometry } from '../src/mesh.js';
import { editMesh } from '../src/mesh-edit.js';

function boxEdit() {
  return editMesh(meshFromGeometry(box(0, 1)));
}

test('removing a removed face, edge or vertex throws and keeps the free lists clean (#2516)', () => {
  const edit = boxEdit();
  edit.removeFace(0);
  const faceCount = edit.faceCount;
  const freeFaces = edit.faces.free.length;
  assert.throws(() => edit.removeFace(0), /Face 0 does not exist or was already removed/);
  assert.equal(edit.faceCount, faceCount);
  assert.equal(edit.faces.free.length, freeFaces);
  edit.removeVertex(0);
  assert.throws(() => edit.removeVertex(0), /Vertex 0 does not exist/);
  assert.throws(() => edit.removeEdge(edit.edges.free[0]), /Edge \d+ does not exist/);
  const first = edit.createVertex(0, 0, 0);
  const second = edit.createVertex(1, 1, 1);
  assert.notEqual(first, second);
});

test('createFace rejects a face over the vertices of an existing face (#2517)', () => {
  const edit = boxEdit();
  const vertices = edit.faceVertices(0);
  const faceCount = edit.faceCount;
  assert.throws(() => edit.createFace(vertices), /already exists/);
  assert.throws(() => edit.createFace([...vertices].reverse()), /already exists/);
  assert.equal(edit.faceCount, faceCount);
  assert.equal(edit.edgeFaceCount(edit.findEdge(vertices[0], vertices[1])), 2);
});

test('createFace refuses a fractional vertex index (#2518)', () => {
  const edit = boxEdit();
  assert.throws(() => edit.createFace([0, 1, 2.5]), /Vertex 2.5 does not exist/);
});
