import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { box } from '../src/geometry.js';
import { normalizeMeshEdits } from '../src/mesh-recipe.js';
import { editImportedGeometry } from '../src/mesh-import.js';

test('an edit op named like an Object.prototype key gets the list of valid ops', () => {
  for (const op of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.throws(() => normalizeMeshEdits([{ op }]), /edits\[0\]\.op.*one of extrude_face_region/s, op);
  }
});

test('imported geometry with a short skin or morph array is refused before values transfer', () => {
  const source = box(0, 1);
  const options = { maxVertices: 10000, smoothAngle: 30 };
  const edits = [{ op: 'subdivide', levels: 1 }];
  const shortSkin = { ...source, skinIndices: new Uint16Array(4), skinWeights: new Float32Array(4) };
  assert.throws(() => editImportedGeometry(shortSkin, edits, options), /skinIndices must hold 96 values, not 4/);
  const shortMorph = { ...source, morphTargets: [{ positions: new Float32Array(3) }] };
  assert.throws(() => editImportedGeometry(shortMorph, edits, options), /morphTargets\[0\]\.positions must hold 72 values, not 3/);
});
