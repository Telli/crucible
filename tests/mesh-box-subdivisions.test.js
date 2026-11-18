import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';

// A sharp mesh box base keeps `subdivisions` as an n by n grid on each face, welded across the edges (#2201).
function boxRecipe(base, edits = []) {
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'stack', type: 'mesh', base, edits }],
    materials: [{ id: 'rock', color: [0.5, 0.5, 0.5] }],
    nodes: [{ id: 'stack', geometry: 'stack', material: 'rock' }],
  };
}

function report(base, edits) {
  return createAgentScene(boxRecipe(base, edits)).inspectMeshes().meshes[0];
}

test('a sharp mesh box splits each face by its subdivisions and welds the edges', () => {
  const expectedVertices = subdivisions => 6 * subdivisions ** 2 + 2;
  for (const subdivisions of [1, 2, 64]) {
    const result = report({ type: 'box', bevel: 0, subdivisions });
    assert.equal(result.counts.vertices, expectedVertices(subdivisions), `subdivisions ${subdivisions}`);
    assert.equal(result.counts.faces, 6 * subdivisions ** 2);
  }
  assert.equal(report({ type: 'box', bevel: 0 }).counts.vertices, 8, 'no subdivisions keeps the plain box');
});

test('the same box recipe builds identical meshes', () => {
  const base = { type: 'box', bevel: 0, subdivisions: 16 };
  const edits = [{ op: 'displace', field: 1, strength: 0.05 }];
  assert.equal(JSON.stringify(report(base, edits)), JSON.stringify(report(base, edits)));
});

test('edits move the extra vertices and smoothAngle still applies', () => {
  const base = { type: 'box', bevel: 0, subdivisions: 8 };
  const flat = report(base);
  const displaced = report(base, [{ op: 'displace', field: 1, strength: 0.2, midlevel: 0 }]);
  assert.equal(displaced.counts.vertices, flat.counts.vertices);
  assert.notDeepEqual(displaced.bounds ?? displaced, flat.bounds ?? flat);
  const scene = createAgentScene({ ...boxRecipe(base), geometries: [{ id: 'stack', type: 'mesh', base, smoothAngle: 50 }] });
  assert.equal(scene.inspectMeshes().meshes[0].ok, true);
});

test('subdivisions out of range on a sharp mesh box names the accepted range', () => {
  assert.throws(() => report({ type: 'box', bevel: 0, subdivisions: 129 }), /subdivisions/);
});
