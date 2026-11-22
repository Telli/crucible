import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createAgentMcpServer } from '../scripts/mcp-server.mjs';
import { AGENT_SCENE_CAPABILITIES } from '../src/agent-scene.js';

// Issue 3018: agents ask for a geometry by its bare name (cylinder), and the server already knew the one topic they meant.

async function connectClient(context) {
  const runtime = {
    async capabilities() { return { scene: AGENT_SCENE_CAPABILITIES, phase: 'idle', availableIn: 'test' }; },
    async close() {},
    activeSessionId() { return null; },
  };
  const server = createAgentMcpServer(runtime);
  const client = new Client({ name: 'capabilities-bare-topic-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  context.after(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

async function ask(client, topic) {
  return client.callTool({ name: 'scene_capabilities', arguments: { topic } });
}

test('a bare name that is the branch of one topic is answered as that topic', async context => {
  const client = await connectClient(context);
  const bare = await ask(client, 'cylinder');
  const dotted = await ask(client, 'geometries.cylinder');
  assert.notEqual(bare.isError, true, bare.content?.[0]?.text);
  assert.equal(bare.structuredContent.topic, 'geometries.cylinder');
  assert.deepEqual(bare.structuredContent, dotted.structuredContent);
});

test('a bare name shared by two topics still fails and names both', async context => {
  const client = await connectClient(context);
  const answer = await ask(client, 'bevel');
  assert.equal(answer.isError, true);
  assert.match(answer.content[0].text, /Unknown topic bevel\. Did you mean meshStack\.bevel or meshEdit\.bevel\?/);
});

test('each entry of a topic list resolves a bare branch name the same way', async context => {
  const client = await connectClient(context);
  const answer = await ask(client, ['lathe', 'tube']);
  assert.notEqual(answer.isError, true, answer.content?.[0]?.text);
  const text = JSON.stringify(answer.structuredContent);
  assert.match(text, /geometries\.lathe/);
  assert.match(text, /geometries\.tube/);
});

test('a name that matches no topic and no branch still fails with the topic list', async context => {
  const client = await connectClient(context);
  const answer = await ask(client, 'teleporter');
  assert.equal(answer.isError, true);
  assert.match(answer.content[0].text, /Unknown topic teleporter\. Topics: format/);
});
