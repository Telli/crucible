// scene_look channel views (#2876): beauty stays the default, every other view draws one render pass, a bad name lists the valid
// ones, and the new roughness, metallic and lighting passes read the right values in a real renderer (headless Chrome, skipped
// outside CI when Chrome cannot start).
import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { freePort } from './helpers/free-port.js';
import { launchChrome, skipOrThrow, openBlankPage } from './helpers/dev-server-browser.js';
import { previewHarness } from './support/preview-harness.mjs';
import { LOOK_VIEW_NAMES, LOOK_VIEW_PASSES, resolveLookView } from '../src/look-views.js';
import { RENDER_PASS_MODES } from '../src/render-passes.js';
import { RENDER_PASS_NAMES, AGENT_SCENE_CAPABILITIES } from '../src/agent-scene-capabilities.js';

const EXPECTED_VIEWS = ['beauty', 'albedo', 'normal', 'roughness', 'metallic', 'ao', 'lighting'];

function recipe() {
  return { format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'cube', type: 'box', bevel: 0 }],
    materials: [{ id: 'paint', color: [0.4, 0.5, 0.6] }],
    nodes: [{ id: 'cube', geometry: 'cube', material: 'paint' }] };
}

function previewWithScene(sessionId) {
  const harness = previewHarness();
  harness.preview.create({ recipe: recipe(), sessionId, backend: 'cpu', memoryBudgetMiB: 64 });
  return harness;
}

test('the view names are the seven channels, and each one maps to a render pass the renderer draws', () => {
  assert.deepEqual([...LOOK_VIEW_NAMES], EXPECTED_VIEWS);
  assert.equal(LOOK_VIEW_PASSES.beauty, null);
  for (const view of EXPECTED_VIEWS.filter(name => name !== 'beauty')) {
    assert.ok(RENDER_PASS_NAMES.includes(LOOK_VIEW_PASSES[view]), `${view} draws a pass render jobs list`);
    assert.ok(RENDER_PASS_MODES[LOOK_VIEW_PASSES[view]] > 0, `${view} has a shader mode`);
  }
  assert.deepEqual([...AGENT_SCENE_CAPABILITIES.lookViews.names], EXPECTED_VIEWS);
});

test('a bad view name lists the valid views', () => {
  for (const bad of ['alebdo', 'Beauty', 7, '', {}]) {
    assert.throws(() => resolveLookView(bad), error => {
      assert.ok(error instanceof RangeError);
      for (const view of EXPECTED_VIEWS) assert.ok(error.message.includes(view), `${error.message} names ${view}`);
      return true;
    });
  }
  assert.equal(resolveLookView(undefined), 'beauty');
  assert.equal(resolveLookView(null), 'beauty');
});

test('scene_look draws each view as an image through its pass and says which view it drew', () => {
  const { preview, renders } = previewWithScene('views');
  for (const view of EXPECTED_VIEWS.filter(name => name !== 'beauty')) {
    const { data, mimeType, metadata } = preview.look({ sessionId: 'views', view });
    assert.equal(mimeType, 'image/png');
    assert.ok(data.length > 0);
    assert.equal(metadata.view, view);
    assert.equal(renders.at(-1).camera.pass, LOOK_VIEW_PASSES[view]);
  }
});

test('the default view is the lit frame: no pass, no view field, the same frame as view beauty', () => {
  const { preview, renders } = previewWithScene('default');
  const implicit = preview.look({ sessionId: 'default' });
  const implicitFrame = renders.at(-1).camera;
  const explicit = preview.look({ sessionId: 'default', view: 'beauty' });
  const explicitFrame = renders.at(-1).camera;
  assert.equal(implicitFrame.pass, undefined);
  assert.equal('view' in implicit.metadata, false);
  assert.equal('view' in explicit.metadata, false);
  assert.deepEqual(explicitFrame, implicitFrame);
  assert.equal(explicit.data, implicit.data);
});

test('scene_look rejects a bad view before drawing anything', () => {
  const { preview, renders } = previewWithScene('bad');
  const drawn = renders.length;
  assert.throws(() => preview.look({ sessionId: 'bad', view: 'rough' }), /albedo, normal, roughness, metallic, ao, lighting/);
  assert.equal(renders.length, drawn);
});

async function startServer(port) {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The dev server did not start.')), 30000);
    server.stdout.on('data', (data) => {
      if (/ready in/.test(data.toString())) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`The dev server exited ${code}.`));
    });
  });
  return server;
}

// Draws the roughness, metallic and lighting passes of a floor and two spheres, then the lighting pass again with other colours and metal.
async function drawChannelViews(page) {
  const task = async () => {
    const { box, sphere } = await import('/src/geometry.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { installRenderPasses } = await import('/src/render-passes.js');
    const { readFloatPixels } = await import('/src/float-output.js');
    const canvas = document.createElement('canvas');
    canvas.style.width = '320px';
    canvas.style.height = '320px';
    canvas.width = 64;
    canvas.height = 64;
    document.body.append(canvas);
    const geometry = box(0, 1);
    const uvSphere = sphere(16, 12);
    const scaled = (sx, sy, sz, x, y, z) => new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1]);
    const sceneParts = (floorColor, shinyColor, shinyMetallic) => [
      { name: 'floor', geometry, matrix: scaled(8, 0.2, 8, 0, -0.1, 0), material: { id: 'floor-mat', tag: 'surface', color: floorColor, metallic: 0, roughness: 0.7, emission: 0 } },
      { name: 'shiny', geometry: uvSphere, matrix: scaled(0.8, 0.8, 0.8, -1.5, 1, 0), material: { id: 'shiny-mat', tag: 'surface', color: shinyColor, metallic: shinyMetallic, roughness: 0.25, emission: 0 } },
      { name: 'rough', geometry: uvSphere, matrix: scaled(0.8, 0.8, 0.8, 1.5, 1, 0), material: { id: 'rough-mat', tag: 'surface', color: [0.2, 0.5, 0.9], metallic: 0, roughness: 0.6, emission: 0 } },
    ];
    const camera = { eye: [0, 5, 7], target: [0, 0.6, 0] };
    const draw = (parts, pass) => {
      const renderer = installRenderPasses(new CrucibleRenderer(canvas, parts, { ground: false, samples: 1, pixelRatio: 1 }));
      const size = renderer.canvas.width;
      renderer.render({ ...camera, pass, passFloat: true });
      return Array.from(readFloatPixels(renderer.context, renderer.passSupport.framebuffer, size, size));
    };
    const plain = sceneParts([0.25, 0.25, 0.25], [0.9, 0.2, 0.2], 0.8);
    const repainted = sceneParts([0.9, 0.8, 0.1], [0.1, 0.1, 0.9], 0);
    return {
      roughness: draw(plain, 'roughness'),
      metallic: draw(plain, 'metallic'),
      lighting: draw(plain, 'lighting'),
      lightingRepainted: draw(repainted, 'lighting'),
      diffuse: draw(plain, 'diffuse'),
    };
  };
  return page.evaluate(task);
}

function redChannel(pixels) {
  const values = [];
  for (let index = 0; index < pixels.length; index += 4) values.push(pixels[index]);
  return values;
}

test('roughness and metallic read the material values, and lighting ignores albedo and metal', async (context) => {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    skipOrThrow(context, 'playwright is not installed');
    return;
  }
  const port = await freePort();
  const server = await startServer(port);
  let browser;
  try {
    try {
      browser = await launchChrome(chromium);
    } catch (error) {
      skipOrThrow(context, `Chrome did not start: ${error.message.split('\n')[0]}`);
      return;
    }
    const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    await openBlankPage(page, port);
    const views = await drawChannelViews(page);
    const roughness = redChannel(views.roughness);
    const metallic = redChannel(views.metallic);
    const near = (values, target) => values.filter(value => Math.abs(value - target) < 0.05).length;
    assert.ok(near(roughness, 0.7) > 100, 'the floor reads its 0.7 roughness');
    assert.ok(near(roughness, 0.25) > 5, 'the shiny sphere reads its 0.25 roughness');
    assert.ok(near(roughness, 0.6) > 5, 'the rough sphere reads its 0.6 roughness');
    assert.ok(near(metallic, 0.8) > 5, 'the shiny sphere reads its 0.8 metallic');
    assert.ok(near(metallic, 0) > 100, 'the floor and the rough sphere read no metal');
    assert.ok(Math.max(...metallic) < 0.85, 'nothing reads more metal than the shiny sphere');
    let lightingEnergy = 0;
    let largestDifference = 0;
    let albedoLeak = 0;
    for (let index = 0; index < views.lighting.length; index += 4) {
      lightingEnergy += views.lighting[index];
      largestDifference = Math.max(largestDifference, Math.abs(views.lighting[index] - views.lightingRepainted[index]));
      albedoLeak += Math.abs(views.lighting[index] - views.diffuse[index]);
    }
    assert.ok(lightingEnergy > 10, 'the lighting view holds light');
    assert.ok(largestDifference < 0.01, `repainting and removing the metal does not change the lighting view (largest difference ${largestDifference})`);
    assert.ok(albedoLeak > 1, 'the diffuse pass still carries the albedo that the lighting view drops');
  } finally {
    await browser?.close();
    server.kill();
  }
});
