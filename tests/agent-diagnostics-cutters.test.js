import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeDiagnostics } from '../src/agent-diagnostics.js';

function cuttingMesh(id, cutterId) {
  return { id, type: 'mesh', base: { type: 'box' }, edits: [{ op: 'boolean', operation: 'difference', name: 'bore', cutter: { geometry: cutterId } }] };
}

function recipeWith(geometries) {
  return { materials: [{ id: 'steel' }], geometries, nodes: [{ id: 'block', geometry: geometries[0].id, material: 'steel' }] };
}

function unusedGeometryIds(recipe) {
  return recipeDiagnostics(recipe).filter(entry => entry.kind === 'unused-geometry').map(entry => entry.target);
}

test('a geometry that only serves as a boolean cutter is not reported as unused', () => {
  const recipe = recipeWith([cuttingMesh('block', 'tool'), { id: 'tool', type: 'cylinder' }]);
  assert.deepEqual(unusedGeometryIds(recipe), []);
});

test('a cutter of a cutter counts as used, and a cutter of an unused mesh does not', () => {
  const nested = recipeWith([cuttingMesh('block', 'tool'), cuttingMesh('tool', 'inner'), { id: 'inner', type: 'sphere' }]);
  assert.deepEqual(unusedGeometryIds(nested), []);
  const orphan = recipeWith([{ id: 'block', type: 'box' }, cuttingMesh('spare', 'tool'), { id: 'tool', type: 'cylinder' }]);
  assert.deepEqual(unusedGeometryIds(orphan), ['spare', 'tool']);
});

test('a cycle of cutters ends and an unrelated geometry is still reported', () => {
  const recipe = recipeWith([cuttingMesh('block', 'tool'), cuttingMesh('tool', 'block'), { id: 'spare', type: 'sphere' }]);
  assert.deepEqual(unusedGeometryIds(recipe), ['spare']);
});
