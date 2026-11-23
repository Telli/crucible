import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createAgentMcpServer } from '../scripts/mcp-server.mjs';
import { previewHarness } from './support/preview-harness.mjs';

async function connect(context, runtime) {
  const server = createAgentMcpServer(runtime);
  const client = new Client({ name: 'fit-look-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  context.after(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

const validArguments = () => ({
  shots: [{ name: 'coast', camera: { eye: [0, 2, 8], target: [0, 1, 0], fov: 45 } }],
  regions: [{ label: 'high sky', shot: 'coast', rect: [0.3, 0.02, 0.7, 0.15], lab: [0.72, -0.03, -0.08] }],
  parameters: [{ name: 'keyIntensity', min: 0.5, max: 3 }],
});

test('scene_fit_look passes the scene id and the arguments to the runtime and returns its result as JSON', async context => {
  const calls = [];
  const client = await connect(context, {
    activeSessionId: () => 'scene-1',
    async close() {},
    async fitLook(input) {
      calls.push(input);
      return { sessionId: input.sessionId, revision: 12, operations: [] };
    },
  });
  const result = await client.callTool({ name: 'scene_fit_look', arguments: validArguments() });
  assert.equal(result.isError, undefined);
  assert.equal(calls[0].sessionId, 'scene-1');
  assert.equal(calls[0].parameters[0].name, 'keyIntensity');
  assert.equal(JSON.parse(result.content[0].text).revision, 12);
});

test('scene_fit_look rejects unbounded counts, unknown parameters and extra fields before the runtime runs', async context => {
  let runs = 0;
  const client = await connect(context, { activeSessionId: () => 'scene-1', async close() {}, async fitLook() { runs += 1; return {}; } });
  const region = validArguments().regions[0];
  const rejects = [
    { shots: [] },
    { shots: Array.from({ length: 5 }, (_, index) => ({ name: `shot ${index}` })) },
    { regions: Array.from({ length: 33 }, (_, index) => ({ ...region, label: `region ${index}` })) },
    { regions: [{ ...region, rect: [0, 0, 1] }] },
    { regions: [{ ...region, imagePath: 'C:/reference.png' }] },
    { regions: [{ ...region, imageUrl: 'https://example.com/reference.png' }] },
    { parameters: [] },
    { parameters: [{ name: 'sunAngle' }] },
    { parameters: Array.from({ length: 9 }, () => ({ name: 'keyIntensity' })) },
    { maxIterations: 9 },
    { width: 1024 },
    { code: 'alert(1)' },
  ];
  for (const override of rejects) {
    const rejected = await client.callTool({ name: 'scene_fit_look', arguments: { ...validArguments(), ...override } }).catch(error => ({ isError: true, message: error.message }));
    assert.equal(rejected.isError, true, JSON.stringify(override).slice(0, 80));
  }
  assert.equal(runs, 0);
});

const physicalSkyRecipe = () => ({ format: 'crucible.scene', schemaVersion: 1,
  geometries: [{ id: 'cube', type: 'box', bevel: 0 }], materials: [{ id: 'paint', color: [0.4, 0.5, 0.6] }],
  nodes: [{ id: 'cube', geometry: 'cube', material: 'paint' }],
  environment: { sky: { type: 'physical', sunElevation: 20 } }, effects: { exposure: 1 } });

test('the preview draws a candidate look on the live scene, and restoreRecipe puts the recipe back', () => {
  const { preview } = previewHarness();
  const sessionId = 'fit';
  preview.create({ recipe: physicalSkyRecipe(), sessionId, backend: 'cpu', memoryBudgetMiB: 192 });
  const original = preview.exportRecipe({ sessionId });
  const frame = preview.fitLookFrame({ sessionId, operations: [
    { type: 'set-camera', eye: [0, 3, 9], target: [0, 1, 0], fov: 40 },
    { type: 'set-environment', environment: { keyIntensity: 2.5, sky: { type: 'physical', sunElevation: 12 } } },
    { type: 'set-effects', effects: { exposure: 1.4 } },
  ] });
  assert.equal(frame.mimeType, 'image/png');
  const edited = preview.exportRecipe({ sessionId });
  assert.equal(edited.recipe.environment.keyIntensity, 2.5);
  assert.equal(edited.recipe.environment.sky.sunElevation, 12);
  assert.equal(edited.recipe.effects.exposure, 1.4);
  assert.equal(edited.recipe.camera.fov, 40);
  const restored = preview.restoreRecipe({ sessionId, recipe: original.recipe });
  assert.deepEqual(preview.exportRecipe({ sessionId }).recipe, original.recipe);
  assert.ok(restored.revision > original.revision, 'the revision advances: the caller must read it from the result');
});

test('the preview refuses a candidate look that the scene rejects, and the recipe stays as it was', () => {
  const { preview } = previewHarness();
  const sessionId = 'fit-bad';
  preview.create({ recipe: physicalSkyRecipe(), sessionId, backend: 'cpu', memoryBudgetMiB: 192 });
  const before = preview.exportRecipe({ sessionId });
  assert.throws(() => preview.fitLookFrame({ sessionId, operations: [{ type: 'set-effects', effects: { exposure: -4 } }] }));
  assert.deepEqual(preview.exportRecipe({ sessionId }), before);
});
