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
import { shaderFeaturesOfParts } from '../src/renderer.js';
import { FADING_SHADOWS_FEATURE, createDepthFragmentShader, createDepthVertexShader, depthFragmentShader, depthVertexShader } from '../src/shaders.js';
import { decodePngPixels, meanBrightness } from './support/png-pixels.mjs';

// A part an opacity track fades casts a depth shadow through a dithered alpha test, so the shadow thins with the part where no
// tint map exists: cascades (environment.sunAngularRadius) and local light tiles (#2933).

test('the dithered shadow test is compiled in only for scenes that have a fading caster', () => {
  assert.equal(createDepthFragmentShader([]), depthFragmentShader);
  assert.equal(createDepthVertexShader([]), depthVertexShader);
  for (const features of [[FADING_SHADOWS_FEATURE], [FADING_SHADOWS_FEATURE, 'tintedShadows']]) {
    assert.match(createDepthFragmentShader(features), /if \(tintOpacity <= threshold\) discard;/);
    assert.match(createDepthVertexShader(features), /tintOpacity = instanceEmissive\.w/);
    assert.equal(createDepthFragmentShader(features).match(/in float tintOpacity;/g).length, 1, 'one declaration, even beside the tint pass');
  }
  assert.doesNotMatch(createDepthFragmentShader(['tintedShadows']), /shadowDither/);
});

test('only a blended or transmissive caster that an opacity track fades asks for the dithered shadow', () => {
  const glass = { geometry: { positions: [], indices: [] }, material: { alphaMode: 'blend' } };
  assert.ok(shaderFeaturesOfParts([{ ...glass, opacityScale: { value: 1 } }]).has(FADING_SHADOWS_FEATURE));
  assert.ok(!shaderFeaturesOfParts([glass]).has(FADING_SHADOWS_FEATURE), 'no opacity track, no feature, so shadows stay byte for byte');
  assert.ok(!shaderFeaturesOfParts([{ ...glass, castShadow: false, opacityScale: { value: 1 } }]).has(FADING_SHADOWS_FEATURE));
});

const SIDE = 128;
const directories = [];
const sessions = new Map();
async function server() {
  if (sessions.has('server')) return sessions.get('server');
  const directory = await mkdtemp(join(tmpdir(), 'crucible-fading-shadows-'));
  directories.push(directory);
  const runtime = createAgentRuntime({ backend: 'cpu', memory: 192, jobs: join(directory, 'jobs') });
  const mcp = createAgentMcpServer(runtime);
  const client = new Client({ name: 'fading-shadows-test', version: '1' });
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

// Two boxes on a floor: the left fades from 0 to 1 over one second, the right stays opaque. Returns the floor shadow under each
// as how much darker than bare floor it is, at each time.
async function shadowDarkness(environment, times) {
  const { client } = await server();
  const recipe = {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'box', type: 'box' }],
    materials: [{ id: 'paint', color: [0.8, 0.2, 0.2], roughness: 0.6 }, { id: 'ground', color: [0.7, 0.7, 0.7], roughness: 0.9 }],
    nodes: [
      { id: 'floor', geometry: 'box', material: 'ground', scale: [20, 0.1, 20], translation: [0, -0.05, 0] },
      { id: 'fading', geometry: 'box', material: 'paint', castShadow: true, translation: [-2, 0.5, 0] },
      { id: 'steady', geometry: 'box', material: 'paint', translation: [2, 0.5, 0] },
    ],
    motion: { duration: 1, tracks: [{ kind: 'node', id: 'fading', property: 'opacity', keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }] }] },
    camera: { eye: [0, 12, 0.01], target: [0, 0, 0], fov: 45 },
    environment: { lightDirection: [1, 1.2, 0.4], ...environment },
  };
  const created = await call(client, 'scene_create', { recipe });
  const regions = { fading: [0.174, 0.47, 0.224, 0.53], steady: [0.6, 0.47, 0.65, 0.53], floor: [0.0, 0.1, 0.1, 0.2] };
  const results = [];
  for (const time of times) {
    const submitted = await call(client, 'scene_render_submit', { sessionId: created.sessionId, expectedRevision: created.revision ?? 0, settings: { kind: 'image', width: SIDE, height: SIDE, motion: { start: time } } });
    for (let attempt = 0; attempt < 900; attempt++) {
      const record = await call(client, 'scene_render_status', { jobId: submitted.jobId });
      if (record.state === 'completed') break;
      assert.ok(!['cancelled', 'failed'].includes(record.state), JSON.stringify(record));
      await delay(100);
    }
    const result = await call(client, 'scene_render_result', { jobId: submitted.jobId });
    const picture = decodePngPixels(await readFile(result.artifacts[0].path));
    const floor = meanBrightness(picture, regions.floor);
    results.push({ fading: floor - meanBrightness(picture, regions.fading), steady: floor - meanBrightness(picture, regions.steady) });
  }
  return results;
}

test('on the cascaded sun path opacity 0 casts no shadow, half opacity a lighter one and opacity 1 the full shadow', { timeout: 240000 }, async () => {
  const [gone, half, full] = await shadowDarkness({ sunAngularRadius: 0.02 }, [0, 0.5, 1]);
  assert.ok(full.steady > 8, `the opaque box must cast a clear shadow, measured ${full.steady}`);
  assert.ok(gone.fading < 1, `opacity 0 casts nothing, measured darkness ${gone.fading}`);
  assert.ok(half.fading > 0.15 * full.fading && half.fading < 0.85 * full.fading, `half opacity casts part of the shadow: ${half.fading} against ${full.fading}`);
  assert.ok(Math.abs(full.fading - full.steady) < 0.1 * full.steady, `a fully faded in part casts like an opaque one: ${full.fading} against ${full.steady}`);
});
