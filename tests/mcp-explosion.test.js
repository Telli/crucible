import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createAgentRuntime } from '../scripts/agent-runtime.mjs';
import { createAgentMcpServer } from '../scripts/mcp-server.mjs';

// add-explosion through the real MCP tools (#1050): the hidden shaping nodes must reach the preview's part list after the apply,
// and the exported recipe must pass the scene_create input schema, which the internal validator alone does not prove.

async function startServer(context) {
  const directory = await mkdtemp(join(tmpdir(), 'crucible-explosion-mcp-'));
  const runtime = createAgentRuntime({ backend: 'cpu', memory: 192, jobs: join(directory, 'jobs') });
  const server = createAgentMcpServer(runtime);
  const client = new Client({ name: 'explosion-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  context.after(async () => {
    await client.close();
    await server.close();
    await runtime.close?.();
  });
  return client;
}

async function call(client, name, argumentsValue) {
  const result = await client.callTool({ name, arguments: argumentsValue }, { timeout: 120000 });
  assert.equal(result.isError, undefined, result.content?.find(item => item.type === 'text')?.text);
  return result.structuredContent;
}

// The tests read the exported recipe, not the picture, so the preview is drawn small: the software renderer on a CI runner costs time by the pixel (#2779).
const SMALL_LOOK = { width: 256, height: 170 };

const recipe = {
  format: 'crucible.scene', schemaVersion: 1,
  geometries: [{ id: 'box', type: 'box' }],
  materials: [{ id: 'matte', color: [0.7, 0.7, 0.7] }],
  nodes: [{ id: 'floor', geometry: 'box', material: 'matte', scale: [4, 0.1, 4] }],
  camera: { eye: [0, 2, 5], target: [0, 0, 0] },
};

test('scene_look draws a blast added by scene_apply, and the exported recipe is created fresh', { timeout: 240000 }, async context => {
  const client = await startServer(context);
  const created = await call(client, 'scene_create', { recipe });
  await call(client, 'scene_look', SMALL_LOOK);
  const applied = await call(client, 'scene_apply', { sessionId: created.sessionId, expectedRevision: created.revision, operations: [{ type: 'add-explosion', id: 'blast', center: [0, 0, 0], size: 2 }] });
  assert.ok(applied.revision > created.revision);
  for (const motionTime of [0, 0.3, 1.5]) {
    await call(client, 'scene_look', { sessionId: created.sessionId, motionTime, ...SMALL_LOOK });
  }
  const exported = await call(client, 'scene_export_recipe', { sessionId: created.sessionId });
  const exportedRecipe = exported.recipe ?? exported;
  const [volume] = exportedRecipe.environment.localVolumes;
  assert.equal(volume.shape, 'grid');
  assert.equal(volume.castShadow, true);
  // The recipe names grids that exist in no folder: the server bakes them from their names, so a fresh scene can be created from the export.
  const again = await call(client, 'scene_create', { recipe: exportedRecipe });
  assert.ok(again.sessionId);
});

test('sparks and motionBlur options go through scene_apply, and the exported recipe is created fresh', { timeout: 240000 }, async context => {
  const client = await startServer(context);
  const created = await call(client, 'scene_create', { recipe });
  const operation = { type: 'add-explosion', id: 'blast', center: [0, 0, 0], size: 2, sparks: { count: 50, lifetime: [0.5, 1] }, motionBlur: false };
  await call(client, 'scene_apply', { sessionId: created.sessionId, expectedRevision: created.revision, operations: [operation] });
  await call(client, 'scene_look', { sessionId: created.sessionId, motionTime: 0.5, ...SMALL_LOOK });
  const exported = await call(client, 'scene_export_recipe', { sessionId: created.sessionId });
  const exportedRecipe = exported.recipe ?? exported;
  const [sparks] = exportedRecipe.particles.systems;
  assert.equal(sparks.type, 'sparks');
  assert.equal(sparks.count, 50);
  assert.ok(!exportedRecipe.environment.localVolumes[0].frames.some(name => name.includes('velocity')));
  assert.ok((await call(client, 'scene_create', { recipe: exportedRecipe })).sessionId);
});

test('the default blast sends velocity grids and an exported recipe with them is created fresh', { timeout: 240000 }, async context => {
  const client = await startServer(context);
  const created = await call(client, 'scene_create', { recipe });
  await call(client, 'scene_apply', { sessionId: created.sessionId, expectedRevision: created.revision, operations: [{ type: 'add-explosion', id: 'blast', center: [0, 0, 0], size: 2 }] });
  await call(client, 'scene_look', { sessionId: created.sessionId, motionTime: 0.3, ...SMALL_LOOK });
  const exported = await call(client, 'scene_export_recipe', { sessionId: created.sessionId });
  const exportedRecipe = exported.recipe ?? exported;
  assert.ok(exportedRecipe.environment.localVolumes[0].frames.every(name => name.includes('velocity')));
  assert.ok(exportedRecipe.effects.motionBlur.shutter > 0);
  assert.ok((await call(client, 'scene_create', { recipe: exportedRecipe })).sessionId);
});
