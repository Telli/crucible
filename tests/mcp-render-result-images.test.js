import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createAgentMcpServer } from '../scripts/mcp-server.mjs';

const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const jobId = randomUUID();

async function connectWithStills(context, stillCount = 3) {
  const directory = await mkdtemp(join(tmpdir(), 'crucible-render-result-images-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const artifacts = [];
  for (let index = 1; index <= stillCount; index++) {
    const path = join(directory, `still-${index}.png`);
    await writeFile(path, ONE_PIXEL_PNG);
    artifacts.push({ filename: `still-${index}.png`, mimeType: 'image/png', bytes: ONE_PIXEL_PNG.length, path, sha256: 'a'.repeat(64) });
  }
  const runtime = {
    activeSessionId: () => null,
    async close() {},
    async jobResult() { return { jobId, sourceRevision: 1, metrics: { backend: 'cpu' }, artifacts: structuredClone(artifacts) }; },
  };
  const server = createAgentMcpServer(runtime);
  const client = new Client({ name: 'render-result-images-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  context.after(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

const countOf = (result, type) => result.content.filter(block => block.type === type).length;

test('scene_render_result attaches every PNG by default and none with images: false (#2056)', async context => {
  const client = await connectWithStills(context);
  for (const response_format of [undefined, 'concise', 'detailed']) {
    const withImages = await client.callTool({ name: 'scene_render_result', arguments: { jobId, ...(response_format && { response_format }) } });
    assert.equal(countOf(withImages, 'image'), 3, `${response_format}: images attached by default`);
  }
  const pathsOnly = await client.callTool({ name: 'scene_render_result', arguments: { jobId, images: false } });
  assert.equal(countOf(pathsOnly, 'image'), 0);
  assert.equal(countOf(pathsOnly, 'resource_link'), 3, 'every file keeps its resource link');
  assert.equal(pathsOnly.structuredContent.artifacts.length, 3, 'the paths stay in the answer');
});

test('scene_render_result says in its description that PNGs are attached and how to turn that off', async context => {
  const client = await connectWithStills(context);
  const { tools } = await client.listTools();
  const tool = tools.find(candidate => candidate.name === 'scene_render_result');
  assert.ok(tool.description.includes('images: false for paths only'));
  assert.ok(tool.inputSchema.properties.images);
});

test('a job of more than 8 stills returns paths and byte counts, not every picture (#2316)', async context => {
  const client = await connectWithStills(context, 96);
  const result = await client.callTool({ name: 'scene_render_result', arguments: { jobId } });
  assert.equal(countOf(result, 'image'), 0, 'no inline picture for a 96-frame job');
  assert.equal(result.structuredContent.artifacts.length, 96);
  assert.ok(result.structuredContent.artifacts.every(artifact => artifact.path && artifact.bytes > 0));
  assert.ok(JSON.stringify(result).length < 100_000, 'the whole answer stays small');
});

test('images with artifact indexes attaches only those frames of a large job (#2316)', async context => {
  const client = await connectWithStills(context, 96);
  const chosen = await client.callTool({ name: 'scene_render_result', arguments: { jobId, images: [0, 95] } });
  assert.equal(countOf(chosen, 'image'), 2);
  const tooMany = await client.callTool({ name: 'scene_render_result', arguments: { jobId, images: [0, 1, 2, 3, 4, 5, 6, 7, 8] } });
  assert.equal(tooMany.isError, true, 'more than 8 indexes is refused');
  const pastEnd = await client.callTool({ name: 'scene_render_result', arguments: { jobId, images: [96] } });
  assert.equal(pastEnd.isError, true);
  assert.match(pastEnd.content[0].text, /past the last artifact/);
});

test('a job of exactly 8 stills keeps every picture attached (#2316)', async context => {
  const client = await connectWithStills(context, 8);
  const result = await client.callTool({ name: 'scene_render_result', arguments: { jobId } });
  assert.equal(countOf(result, 'image'), 8);
});
