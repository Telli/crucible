import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGltf } from '../src/gltf.js';

/** One mesh "Plate" with the given vertex positions (flat x y z list) and index list. */
function plateDocument(positionList, indexList) {
  const floatBytes = new Uint8Array(new Float32Array(positionList).buffer);
  const indexBytes = new Uint8Array(new Uint16Array(indexList).buffer);
  const bytes = new Uint8Array(floatBytes.length + indexBytes.length);
  bytes.set(floatBytes);
  bytes.set(indexBytes, floatBytes.length);
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ name: 'Plate', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positionList.length / 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5123, count: indexList.length, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: floatBytes.length }, { buffer: 0, byteOffset: floatBytes.length, byteLength: indexBytes.length }],
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
  });
}

const CHECKED = { checkMesh: true };

// Vertices: 0 A, 1 B, 2 C, 3 D, 4 E, then 5 A', 6 B', 7 C' sitting at the same positions as A, B and C.
const POSITIONS = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];

test('checkMesh counts duplicate triangles and non-manifold edges in one warning, judged by position', async () => {
  // ABC, ABD and BAE all share edge AB; A'B'C' repeats ABC from separate vertices.
  const asset = await parseGltf(plateDocument(POSITIONS, [0, 1, 2, 0, 1, 3, 1, 0, 4, 5, 6, 7]), CHECKED);
  assert.deepEqual(asset.warnings, ['Checked primitive 0 of mesh "Plate": 1 duplicate triangle(s) (same corner positions and winding as an earlier one) and 1 non-manifold edge(s) (shared by more than two triangles).']);
  assert.equal(asset.parts[0].geometry.indices.length, 12);
});

test('an edge whose vertices are repeated at the seam still counts its triangles together', async () => {
  // Edge AB is used by ABC, ABD and, through the copies A'B', by A'B'E: three triangles only when positions are welded.
  const asset = await parseGltf(plateDocument(POSITIONS, [0, 1, 2, 0, 1, 3, 6, 5, 4]), CHECKED);
  assert.deepEqual(asset.warnings, ['Checked primitive 0 of mesh "Plate": 1 non-manifold edge(s) (shared by more than two triangles).']);
});

test('a back face with the opposite winding is not a duplicate triangle', async () => {
  const asset = await parseGltf(plateDocument(POSITIONS.slice(0, 9), [0, 1, 2, 2, 1, 0]), CHECKED);
  assert.deepEqual(asset.warnings, []);
});

test('a closed, clean mesh gets no mesh-check warning', async () => {
  // A tetrahedron A B C D with outward winding.
  const asset = await parseGltf(plateDocument(POSITIONS.slice(0, 12), [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]), CHECKED);
  assert.deepEqual(asset.warnings, []);
});

test('the counts run only when checkMesh is true', async () => {
  const asset = await parseGltf(plateDocument(POSITIONS, [0, 1, 2, 0, 1, 3, 1, 0, 4, 5, 6, 7]));
  assert.deepEqual(asset.warnings, []);
});

test('a primitive over maxCheckedTriangles skips the counts and says how to raise the limit', async () => {
  const asset = await parseGltf(plateDocument(POSITIONS, [0, 1, 2, 0, 1, 3, 1, 0, 4, 5, 6, 7]), { checkMesh: true, maxCheckedTriangles: 3 });
  assert.match(asset.warnings.join('\n'), /mesh checks skipped: 4 triangles is over maxCheckedTriangles \(3\); raise it/);
  await assert.rejects(parseGltf(plateDocument(POSITIONS, [0, 1, 2]), { maxCheckedTriangles: 0 }), /maxCheckedTriangles must be a positive safe integer/);
});

test('keepDegenerateTriangles keeps the repeated-index and zero-area triangles and still reports them', async () => {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, 0, 0];
  const indices = [0, 1, 2, 3, 3, 1, 0, 1, 3];
  const asset = await parseGltf(plateDocument(positions, indices), { keepDegenerateTriangles: true });
  assert.deepEqual([...asset.parts[0].geometry.indices], indices);
  assert.deepEqual(asset.warnings, ['Repaired primitive 0 of mesh "Plate": kept (keepDegenerateTriangles) 2 degenerate triangle(s) of 3 (1 with a repeated index, 1 with zero area).']);
  const dropped = await parseGltf(plateDocument(positions, indices));
  assert.deepEqual([...dropped.parts[0].geometry.indices], [0, 1, 2]);
});

test('keepDegenerateTriangles loads a mesh made only of degenerate triangles', async () => {
  const asset = await parseGltf(plateDocument([0, 0, 0, 1, 0, 0, 0.5, 0, 0], [0, 1, 2]), { keepDegenerateTriangles: true });
  assert.equal(asset.parts[0].geometry.indices.length, 3);
});

const CLEAN_DOCUMENT = plateDocument(POSITIONS.slice(0, 12), [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]);

test('strict hands the file bytes to the supplied validator and loads a file it passes', async () => {
  const received = [];
  const validator = { validateBytes: async (bytes, validatorOptions) => { received.push({ bytes, validatorOptions }); return { issues: { numErrors: 0, messages: [] } }; } };
  const asset = await parseGltf(CLEAN_DOCUMENT, { strict: true, validator });
  assert.equal(asset.parts.length, 1);
  assert.equal(received.length, 1);
  assert.ok(received[0].bytes instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(received[0].bytes), CLEAN_DOCUMENT);
});

test('strict fails a file the validator reports errors for and names the first of them', async () => {
  const validator = { validateBytes: async () => ({ issues: { numErrors: 2, messages: [{ severity: 0, code: 'ACCESSOR_MIN_MISMATCH', pointer: '/accessors/0' }, { severity: 1, code: 'NODE_EMPTY', pointer: '/nodes/0' }] } }) };
  await assert.rejects(parseGltf(CLEAN_DOCUMENT, { strict: true, validator }), /glTF-Validator reported 2 error\(s\): ACCESSOR_MIN_MISMATCH at \/accessors\/0\. Fix the file, or load it without strict\./);
});

test('strict without a validator says what to pass, and no strict never calls the validator', async () => {
  await assert.rejects(parseGltf(CLEAN_DOCUMENT, { strict: true }), /strict needs the glTF-Validator: pass options\.validator = await import\('gltf-validator'\)/);
  const validator = { validateBytes: async () => { throw new Error('must not run'); } };
  await parseGltf(CLEAN_DOCUMENT, { validator });
});

test('the validator may fetch only through baseUrl, never when external resources are off', async () => {
  let fetchResource;
  const validator = { validateBytes: async (bytes, validatorOptions) => { fetchResource = validatorOptions.externalResourceFunction; return { issues: { numErrors: 0, messages: [] } }; } };
  await parseGltf(CLEAN_DOCUMENT, { strict: true, validator });
  await assert.rejects(fetchResource('a.bin'), /pass baseUrl .* or embed it/);
});
