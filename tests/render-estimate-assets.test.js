import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentAssetCatalog, describeCatalogFile, glbTriangleCount } from '../scripts/agent-asset-catalog.mjs';
import { estimateRenderJob, sceneSizeFrom } from '../scripts/agent-render-estimate.mjs';
import { normalizeJobSettings } from '../scripts/agent-render-jobs.mjs';
import { gridGlb } from './fixtures/grid-glb.js';

const ASSET_ID = 'b'.repeat(64);
const emptyScene = { counts: { nodes: 1, parts: 1, materials: 1, vertices: 0 }, look: {}, nodes: [{ id: 'plate', triangles: 0 }], assets: [{ assetId: ASSET_ID, parts: 1 }] };

function texturedDocument(imageCount) {
  return {
    accessors: [{ count: 44000, type: 'VEC3' }, { count: 264000, type: 'SCALAR' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    images: Array.from({ length: imageCount }, () => ({ bufferView: 0, mimeType: 'image/png' })),
  };
}

test('a GLB triangle count comes from accessor counts, per node that uses the mesh', () => {
  assert.equal(glbTriangleCount(texturedDocument(1)), 88000);
  const twoNodes = { ...texturedDocument(0), nodes: [{ mesh: 0 }, { mesh: 0 }] };
  assert.equal(glbTriangleCount(twoNodes), 176000);
  const unindexedStrip = { accessors: [{ count: 10 }], meshes: [{ primitives: [{ mode: 5, attributes: { POSITION: 0 } }] }] };
  assert.equal(glbTriangleCount(unindexedStrip), 8);
  assert.equal(glbTriangleCount({}), 0);
});

test('the catalog reports a GLB triangle and image count without reading its buffers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'estimate-assets-'));
  try {
    await writeFile(join(directory, 'grid.glb'), gridGlb(11));
    const catalog = await createAgentAssetCatalog(directory);
    const entry = catalog.list().assets.find(candidate => candidate.name === 'grid.glb');
    const described = await catalog.describeSize(entry.assetId);
    assert.equal(described.triangles, 200);
    assert.equal(described.images, 0);
    assert.equal(describeCatalogFile('x.glb', { bytes: Buffer.alloc(8), document: texturedDocument(2), assetId: ASSET_ID }).images, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an estimate counts the triangles and textures of a placed GLB (#3321)', () => {
  const settings = normalizeJobSettings({ kind: 'video', width: 448, height: 504, fps: 24, duration: 5 }, [], { format: 'crucible.scene' });
  const withoutFootprint = sceneSizeFrom(emptyScene, {});
  assert.equal(withoutFootprint.triangles, 0);
  assert.equal(withoutFootprint.textures, 0);
  const byAssetId = new Map([[ASSET_ID, { triangles: 88000, textures: 1 }]]);
  const withFootprint = sceneSizeFrom(emptyScene, {}, { byAssetId });
  assert.equal(withFootprint.triangles, 88000);
  assert.equal(withFootprint.textures, 1);
  const before = estimateRenderJob({ size: withoutFootprint, settings, backend: 'gpu' });
  const after = estimateRenderJob({ size: withFootprint, settings, backend: 'gpu' });
  assert.ok(after.peakMemoryMiB > before.peakMemoryMiB);
  assert.ok(after.seconds > before.seconds);
  const manyImages = sceneSizeFrom(emptyScene, {}, { byAssetId: new Map([[ASSET_ID, { triangles: 88000, textures: 6 }]]) });
  assert.ok(estimateRenderJob({ size: manyImages, settings, backend: 'gpu' }).peakMemoryMiB > after.peakMemoryMiB);
});

test('copies of one placed GLB count its triangles each and its textures once', () => {
  const copies = { ...emptyScene, assets: [1, 2, 3].map(() => ({ assetId: ASSET_ID, parts: 1 })) };
  const size = sceneSizeFrom(copies, {}, { byAssetId: new Map([[ASSET_ID, { triangles: 1000, textures: 2 }]]) });
  assert.equal(size.triangles, 3000);
  assert.equal(size.textures, 2);
});
