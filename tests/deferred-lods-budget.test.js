// Levels of detail that arrive after the first frame are counted against memoryBudgetMiB (#2985): a budget the caller set
// refuses levels that would not fit and the part keeps level 0; a budget the renderer sized for the scene grows to hold them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withDevServerPage } from './helpers/dev-server-browser.js';

/** Builds a renderer for one uncut scan, makes its levels, and sets the budget to the bytes it holds plus `budgetShare` of the level bytes. */
async function swapLevelsUnderBudget(page, { budgetShare, caller }) {
  return page.evaluate(async ({ budgetShare, caller }) => {
    const { sphere } = await import('/src/geometry.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { generateGeometryLods } = await import('/src/mesh-lod.js');
    const budget = await import('/src/budget.js');
    const { estimateFrameBytes, MEMORY_BUDGET_ERROR_CODE } = budget;
    const canvas = document.createElement('canvas');
    canvas.style.width = '96px';
    canvas.style.height = '54px';
    document.body.append(canvas);
    const part = { name: 'scan', geometry: sphere(160, 80), matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), material: { tag: 'surface', color: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.5 } };
    const renderer = new CrucibleRenderer(canvas, [part], { samples: 1, pixelRatio: 1, ...(caller ? { memoryBudgetMiB: 64 } : {}) });
    renderer.render({ eye: [0, 0, 4], target: [0, 0, 0] });
    const levels = generateGeometryLods(part.geometry, { ratios: [0.5, 0.25] });
    const bytesOf = geometry => ['positions', 'normals', 'uvs', 'indices'].reduce((total, field) => total + (geometry[field]?.byteLength ?? 0), 0);
    const levelBytes = levels.slice(1).reduce((total, level) => total + bytesOf(level.geometry), 0);
    const frameBytes = estimateFrameBytes(canvas.width, canvas.height, renderer.samples, 2048, { hdr: renderer.hdr, bloom: true, depth: renderer.depth });
    const heldBytes = frameBytes + renderer.textureBytes + renderer.geometryBytes;
    renderer.memoryBudgetMiB = (heldBytes + levelBytes * budgetShare) / (1024 * 1024);
    const geometryBytesBefore = renderer.geometryBytes;
    let outcome = 'swapped';
    let code = null;
    try {
      renderer.setPartLods(part, levels);
    } catch (error) {
      outcome = 'refused';
      code = error.code;
    }
    return { outcome, code, exportedCode: MEMORY_BUDGET_ERROR_CODE, grewBudget: renderer.memoryBudgetMiB * 1024 * 1024 > heldBytes + levelBytes * budgetShare, geometryBytesAdded: renderer.geometryBytes - geometryBytesBefore, levelBytes, levelsDrawn: renderer.stats.trianglesDrawn };
  }, { budgetShare, caller });
}

test('a budget the caller set refuses late levels that would pass it, and the part keeps drawing level 0', async (context) => {
  await withDevServerPage(context, async page => {
    const result = await swapLevelsUnderBudget(page, { budgetShare: 0.5, caller: true });
    assert.equal(result.outcome, 'refused');
    assert.equal(result.code, 'MEMORY_BUDGET');
    assert.equal(result.exportedCode, 'MEMORY_BUDGET');
    assert.equal(result.geometryBytesAdded, 0, 'nothing was uploaded for the refused levels');
  });
});

test('a budget the caller set that holds the levels takes them and counts their bytes', async (context) => {
  await withDevServerPage(context, async page => {
    const result = await swapLevelsUnderBudget(page, { budgetShare: 3, caller: true });
    assert.equal(result.outcome, 'swapped');
    assert.ok(result.geometryBytesAdded > 0);
  });
});

test('a budget the renderer sized grows to hold late levels instead of refusing them', async (context) => {
  await withDevServerPage(context, async page => {
    const result = await swapLevelsUnderBudget(page, { budgetShare: 0.5, caller: false });
    assert.equal(result.outcome, 'swapped');
    assert.ok(result.grewBudget, 'the automatic budget rose to hold the levels');
  });
});
