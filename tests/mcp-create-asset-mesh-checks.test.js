// scene_create_asset checkMesh through the real MCP server on the CPU backend (issue 2981): the loader's mesh-check counts come back
// in assetWarnings only when asked for, and a validator (code) is not accepted.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { plateGlb } from './helpers/plate-glb.mjs';
import { agentAssetDecodeOptions, MAX_CHECKED_TRIANGLES } from '../src/agent-asset-limits.js';

let directory;
let client;
let assetId;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'crucible-asset-mesh-checks-'));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'assets', 'plate.glb'), plateGlb([0, 1, 2, 0, 1, 2]));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve('bin/crucible-mcp.mjs'), '--backend', 'cpu', '--memory', '96', '--assets', join(directory, 'assets')], cwd: directory, stderr: 'pipe' });
  client = new Client({ name: 'crucible-asset-mesh-checks-test', version: '1' });
  await client.connect(transport, { timeout: 240000 });
  const catalog = (await client.callTool({ name: 'scene_asset_catalog', arguments: {} })).structuredContent;
  const plate = catalog.assets.find(asset => asset.name === 'plate.glb' || asset.filename === 'plate.glb');
  assetId = plate.assetId ?? plate.id;
});

after(async () => {
  await client?.close();
  await rm(directory, { recursive: true, force: true });
});

const recipe = () => ({ format: 'crucible.asset', schemaVersion: 1, assetId });

test('the catalog decode options add the bounded mesh checks only on request', () => {
  assert.equal(agentAssetDecodeOptions().checkMesh, undefined);
  const options = agentAssetDecodeOptions({ checkMesh: true });
  assert.equal(options.checkMesh, true);
  assert.equal(options.maxCheckedTriangles, MAX_CHECKED_TRIANGLES);
  assert.equal(options.strict, undefined);
  assert.equal(options.validator, undefined);
});

test('scene_create_asset with checkMesh returns the duplicate-triangle count in assetWarnings', { timeout: 300000 }, async () => {
  const created = await client.callTool({ name: 'scene_create_asset', arguments: { recipe: recipe(), checkMesh: true } }, { timeout: 120000 });
  assert.equal(created.isError, undefined, created.content?.[0]?.text);
  const warnings = created.structuredContent.assetWarnings;
  assert.ok(Array.isArray(warnings), 'assetWarnings is a list');
  assert.ok(warnings.some(warning => warning.includes('1 duplicate triangle(s)')), warnings.join(' | '));
});

test('scene_create_asset without checkMesh stays as before and reports no assetWarnings', { timeout: 300000 }, async () => {
  const created = await client.callTool({ name: 'scene_create_asset', arguments: { recipe: recipe() } }, { timeout: 120000 });
  assert.equal(created.isError, undefined, created.content?.[0]?.text);
  assert.equal(created.structuredContent.assetWarnings, undefined);
});

test('scene_create_asset refuses a validator, strict and a non-boolean checkMesh', async () => {
  for (const extra of [{ strict: true }, { validator: 'gltf-validator' }, { checkMesh: 'yes' }]) {
    const result = await client.callTool({ name: 'scene_create_asset', arguments: { recipe: recipe(), ...extra } });
    assert.equal(result.isError, true, JSON.stringify(extra));
  }
});
