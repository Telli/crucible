// A rigid part that updateParts moves toward the camera stays in front of the fitted near plane (#2403).
// It runs in headless Chrome from the Vite dev server; it skips locally when Chrome cannot start and fails on CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withDevServerPage } from './helpers/dev-server-browser.js';

test('a part moved toward the camera after the first frame is not cut by the fitted near plane', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const result = await page.evaluate(async () => {
      const { box } = await import('/src/geometry.js');
      const { CrucibleRenderer } = await import('/src/renderer.js');
      const material = { tag: 'surface', color: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.5, emission: 0 };
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      document.body.append(canvas);
      const translated = z => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1]);
      const part = { name: 'crate', geometry: box(), material, matrix: translated(-80) };
      // Reversed depth off, as on a GPU without EXT_clip_control: only then is the near plane fitted to the scene.
      const renderer = new CrucibleRenderer(canvas, [part], { ground: false, pixelRatio: 1, reversedDepth: false });
      const frame = { eye: [0, 0, 0], target: [0, 0, -1], far: 10000 };
      renderer.render(frame);
      const nearBefore = renderer.withFittedNear(frame).near;
      part.matrix = translated(-5);
      renderer.updateParts([part]);
      renderer.render(frame);
      const nearAfter = renderer.withFittedNear(frame).near ?? 0.1;
      renderer.dispose();
      canvas.remove();
      return { nearBefore, nearAfter };
    });
    assert.ok(result.nearBefore > 50, `the far crate fits the plane out to ${result.nearBefore}`);
    // The crate's front face is now 4.5 m away; a plane past it would cut the crate.
    assert.ok(result.nearAfter < 4.5, `the near plane is ${result.nearAfter} m after the crate moved to 5 m`);
  });
});
