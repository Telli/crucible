// Vertex alpha (#2948): a blended, unlit strip whose COLOR_0 alpha runs 0, 1, 0 across it must fade at its edges. It needs real
// pixels, so it draws in headless Chrome from the Vite dev server (SwiftShader, no GPU). Set VERTEX_ALPHA_STILL_FOLDER to also
// write the two frames as PNG files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withDevServerPage } from './helpers/dev-server-browser.js';

const IMAGE_WIDTH = 640;
const IMAGE_HEIGHT = 360;
const MIDDLE_ROW = IMAGE_HEIGHT / 2;

async function drawStrip(page, withAlpha) {
  const task = async ({ imageWidth, imageHeight, withAlpha }) => {
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const canvas = document.createElement('canvas');
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    document.body.append(canvas);
    const copy = document.createElement('canvas');
    copy.width = imageWidth;
    copy.height = imageHeight;
    const copyContext = copy.getContext('2d', { willReadFrequently: true });
    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const wallGeometry = {
      positions: new Float32Array([-9, -9, 0, 9, -9, 0, 9, 9, 0, -9, 9, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
    const stripGeometry = {
      positions: new Float32Array([-1.5, -1, 1, 0, -1, 1, 1.5, -1, 1, -1.5, 1, 1, 0, 1, 1, 1.5, 1, 1]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]),
      colors: new Float32Array(18).fill(1),
    };
    if (withAlpha) stripGeometry.colorAlpha = new Float32Array([0, 1, 0, 0, 1, 0]);
    const parts = [
      { name: 'wall', geometry: wallGeometry, matrix: identity, material: { id: 'wall', tag: 'unlit', color: [0, 0, 0.6], metallic: 0, roughness: 1 } },
      { name: 'strip', geometry: stripGeometry, matrix: identity, material: { id: 'strip', tag: 'unlit', color: [1, 1, 1], metallic: 0, roughness: 1, alphaMode: 'blend', doubleSided: true } },
    ];
    const renderer = new CrucibleRenderer(canvas, parts, { ground: false, world: true, samples: 1, pixelRatio: 1, depth: true });
    renderer.resize();
    const frame = { eye: [0, 0, 5], target: [0, 0, 0], fov: 40, up: [0, 1, 0], time: 0, wind: 0, exposure: 1, effects: {} };
    renderer.render(frame);
    renderer.render(frame);
    copyContext.drawImage(canvas, 0, 0, imageWidth, imageHeight);
    const pixels = Array.from(copyContext.getImageData(0, 0, imageWidth, imageHeight).data);
    copyContext.fillStyle = 'rgba(0, 0, 0, 0.7)';
    copyContext.fillRect(8, 8, 330, 52);
    copyContext.fillStyle = '#ffffff';
    copyContext.font = '20px sans-serif';
    copyContext.fillText(withAlpha ? 'After: COLOR_0 alpha honoured' : 'Before: COLOR_0 alpha ignored', 16, 32);
    copyContext.font = '16px sans-serif';
    copyContext.fillText('Backend: SwiftShader (CPU)', 16, 52);
    const png = copy.toDataURL('image/png').split(',')[1];
    renderer.dispose();
    return { pixels, png };
  };
  return page.evaluate(task, { imageWidth: IMAGE_WIDTH, imageHeight: IMAGE_HEIGHT, withAlpha });
}

function rowPixel(frame, column) {
  const index = (MIDDLE_ROW * IMAGE_WIDTH + column) * 4;
  return [frame.pixels[index], frame.pixels[index + 1], frame.pixels[index + 2]];
}

test('an unlit blended strip fades with its COLOR_0 alpha and stays solid without it (#2948)', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const faded = await drawStrip(page, true);
    const solid = await drawStrip(page, false);
    // At 40 degrees, distance 4 and 16:9 the strip (half width 1.5) spans columns 135 to 505; its core line is column 320.
    const nearEdge = 145;
    const core = 320;
    assert.ok(rowPixel(solid, nearEdge)[0] > 200, 'without colorAlpha the strip edge is solid white');
    assert.ok(rowPixel(faded, nearEdge)[0] < 140, `with colorAlpha the strip edge shows the wall behind it, got ${rowPixel(faded, nearEdge)}`);
    assert.ok(rowPixel(faded, core)[0] > 200, 'the core of the strip stays opaque');
    const folder = process.env.VERTEX_ALPHA_STILL_FOLDER;
    if (folder) {
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'after-vertex-alpha.png'), Buffer.from(faded.png, 'base64'));
      await writeFile(join(folder, 'before-vertex-alpha-ignored.png'), Buffer.from(solid.png, 'base64'));
    }
  });
});
