import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createAgentRuntime } from '../scripts/agent-runtime.mjs';
import { createAgentMcpServer } from '../scripts/mcp-server.mjs';
import { resolveEffects } from '../src/effects.js';
import { createPostFragment, KEEP_HUE_STEP, POST_STEPS } from '../src/post.js';
import { decodePngPixels } from './support/png-pixels.mjs';

// Bloom keeps the hue of an emissive part when asked (#3326): a bright red cube on a grey wall keeps a saturated face, and a scene that does not ask draws as before.

test('keepHue is absent from resolved bloom unless it is true, so a scene that does not ask resolves as before', () => {
  assert.deepEqual(Object.keys(resolveEffects({ bloom: { strength: 0.5 } }).bloom), ['strength', 'threshold', 'radius']);
  assert.deepEqual(Object.keys(resolveEffects({ bloom: { strength: 0.5, keepHue: false } }).bloom), ['strength', 'threshold', 'radius']);
  assert.equal(resolveEffects({ bloom: { strength: 0.5, keepHue: true } }).bloom.keepHue, true);
});

test('keepHue rejects anything but true or false and says what to pass', () => {
  assert.throws(() => resolveEffects({ bloom: { strength: 0.5, keepHue: 1 } }), /Bloom keepHue must be true or false, got 1\./);
});

test('only the keepHue program holds the keepHue code, every other post program keeps its source', () => {
  assert.doesNotMatch(createPostFragment(POST_STEPS), /bloomKeepHue/);
  assert.match(createPostFragment([...POST_STEPS, KEEP_HUE_STEP]), /uniform float bloomKeepHue;/);
});

const SIDE = 160;
const directories = [];
const sessions = new Map();
async function server() {
  if (sessions.has('server')) return sessions.get('server');
  const directory = await mkdtemp(join(tmpdir(), 'crucible-bloom-keep-hue-'));
  directories.push(directory);
  const runtime = createAgentRuntime({ backend: 'cpu', memory: 192, jobs: join(directory, 'jobs') });
  const mcp = createAgentMcpServer(runtime);
  const client = new Client({ name: 'bloom-keep-hue-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  const entry = { client, close: async () => { await client.close(); await mcp.close(); await runtime.close(); } };
  sessions.set('server', entry);
  return entry;
}
after(async () => {
  if (sessions.has('server')) await sessions.get('server').close();
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

async function call(client, name, argumentsValue) {
  const result = await client.callTool({ name, arguments: argumentsValue }, { timeout: 120000 });
  assert.equal(result.isError, undefined, result.content?.find(item => item.type === 'text')?.text);
  return result.structuredContent;
}

// A red emissive cube on a mid-grey wall. The base is a lit grey, which is the light on a neon face besides the glow that turned it pastel.
async function renderCube(bloom) {
  const { client } = await server();
  const recipe = {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'box', type: 'box', bevel: 0 }],
    materials: [
      { id: 'wall', color: [0.2, 0.2, 0.2], metallic: 0, roughness: 0.9 },
      { id: 'neon', color: [0.6, 0.6, 0.6], metallic: 0, roughness: 0.5, emission: 8, emissiveColor: [1, 0.05, 0.05] },
    ],
    nodes: [
      { id: 'wall', geometry: 'box', material: 'wall', translation: [0, 0, -0.6], scale: [12, 12, 0.1] },
      { id: 'cube', geometry: 'box', material: 'neon', translation: [0, 0, 0], scale: [1, 1, 1] },
    ],
    camera: { eye: [0, 0, 6], target: [0, 0, 0], fov: 40 },
    environment: { world: false, keyIntensity: 0, ambientIntensity: 0.65, ambientColor: [1, 1, 1], skyTop: [0.5, 0.5, 0.5], skyBottom: [0.5, 0.5, 0.5] },
    effects: bloom ? { exposure: 1, bloom } : { exposure: 1 },
  };
  const created = await call(client, 'scene_create', { recipe });
  const submitted = await call(client, 'scene_render_submit', { sessionId: created.sessionId, expectedRevision: created.revision ?? 0, settings: { kind: 'image', width: SIDE, height: SIDE } });
  for (let attempt = 0; attempt < 1200; attempt++) {
    const record = await call(client, 'scene_render_status', { jobId: submitted.jobId });
    if (record.state === 'completed') break;
    assert.ok(!['cancelled', 'failed'].includes(record.state), JSON.stringify(record));
    await delay(100);
  }
  const result = await call(client, 'scene_render_result', { jobId: submitted.jobId });
  return decodePngPixels(await readFile(result.artifacts[0].path));
}

function pixelAt(image, column, row) {
  const offset = (row * image.width + column) * image.channels;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
}

function saturationOf([red, green, blue]) {
  const peak = Math.max(red, green, blue);
  return peak === 0 ? 0 : (peak - Math.min(red, green, blue)) / peak;
}

const lumaOf = ([red, green, blue]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;

test('bloom with keepHue keeps the face saturated and the halo as bright, which plain bloom does not', { timeout: 300000 }, async () => {
  const center = SIDE / 2;
  const ringRow = center - Math.round(SIDE * 0.225) - 6;
  const off = await renderCube(null);
  const plain = await renderCube({ strength: 0.5, threshold: 1, radius: 4 });
  const keeping = await renderCube({ strength: 0.5, threshold: 1, radius: 4, keepHue: true });
  const plainFace = saturationOf(pixelAt(plain, center, center));
  const keepingFace = saturationOf(pixelAt(keeping, center, center));
  const plainRise = lumaOf(pixelAt(plain, center, ringRow)) - lumaOf(pixelAt(off, center, ringRow));
  const keepingRise = lumaOf(pixelAt(keeping, center, ringRow)) - lumaOf(pixelAt(off, center, ringRow));
  assert.ok(plainFace < 0.3, `plain bloom leaves a pastel face, saturation ${plainFace}`);
  assert.ok(keepingFace >= 0.5, `keepHue keeps the face colour, saturation ${keepingFace}`);
  assert.ok(plainRise >= 10, `the test scene needs a halo to compare, rise ${plainRise}`);
  assert.ok(keepingRise >= plainRise - 15, `keepHue keeps the halo, rise ${keepingRise} against ${plainRise}`);
});

test('keepHue false draws the same pixels as no keepHue, and keepHue with bloom off changes nothing', { timeout: 300000 }, async () => {
  const plain = await renderCube({ strength: 0.5, threshold: 1, radius: 4 });
  const explicitFalse = await renderCube({ strength: 0.5, threshold: 1, radius: 4, keepHue: false });
  assert.deepEqual(explicitFalse.data, plain.data);
  const offPlain = await renderCube({ strength: 0 });
  const offKeeping = await renderCube({ strength: 0, keepHue: true });
  assert.deepEqual(offKeeping.data, offPlain.data);
});
