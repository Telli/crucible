import assert from 'node:assert/strict';
import test from 'node:test';

import { BLANK_PAGE_PATH, withWebGpuPage } from './helpers/webgpu-page.js';

// Issue #2684: the WebGPU tests opened the home page, whose live hero kept a software adapter busy for minutes beside the
// tracer under test, so a 17 s test timed out at 240 s on CI. They run on a blank page of the dev server's origin instead.
test('WebGPU tests run on a blank page of the dev server, with no page script beside them, and can import /src', async context => {
  await withWebGpuPage(context, async page => {
    const state = await page.evaluate(async () => {
      const geometry = await import('/src/geometry.js');
      return {
        path: location.pathname,
        scripts: document.scripts.length,
        canvases: document.querySelectorAll('canvas').length,
        isolated: crossOriginIsolated,
        imported: typeof geometry.box,
      };
    });
    assert.deepEqual(state, { path: BLANK_PAGE_PATH, scripts: 0, canvases: 0, isolated: true, imported: 'function' });
  });
});
