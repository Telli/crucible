import test from 'node:test';
import assert from 'node:assert/strict';
import * as z from 'zod/v4';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createAgentMcpServer } from '../scripts/mcp-server.mjs';
import { describeUnionIssue } from '../scripts/mcp-union-errors.mjs';

async function withClient(check) {
  const server = createAgentMcpServer({ async close() {}, activeSessionId() { return null; } });
  const client = new Client({ name: 'mcp-union-errors-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await check(client);
  } finally {
    await client.close();
  }
}

async function createSceneError(client, recipePart) {
  const recipe = { format: 'crucible.scene', schemaVersion: 1, materials: [], nodes: [], ...recipePart };
  const result = await client.callTool({ name: 'scene_create', arguments: { recipe } });
  assert.equal(result.isError, true);
  return result.content[0].text;
}

test('a union of literals names the allowed values and the value received', async () => {
  await withClient(async (client) => {
    const text = await createSceneError(client, { materials: [{ id: 'm', color: [1, 1, 1], pattern: { type: 'bricks', resolution: 2048 } }] });
    assert.match(text, /recipe\.materials\.0\.pattern\.resolution: Invalid input: expected 256, 512 or 1024 \(got 2048\)/);
  });
});

test('a field expression names every accepted shape and where the operators are listed', async () => {
  await withClient(async (client) => {
    const instances = { scatter: { count: 3, min: [0, 0, 0], max: [1, 1, 1] }, where: 'abc' };
    const text = await createSceneError(client, { nodes: [{ id: 'n', geometry: 'g', material: 'm', instances }] });
    assert.match(text, /recipe\.nodes\.0\.instances\.where: Invalid input: expected a number, a boolean, an array of 3 numbers or an object \(got "abc"\); see scene_capabilities fieldExpressions/);
  });
});

test('a long rejected value is cut in a union error', () => {
  const schema = z.union([z.literal(1), z.literal(2)]);
  const issue = schema.safeParse('x'.repeat(200)).error.issues[0];
  const message = describeUnionIssue({ ...issue, input: "x".repeat(200), inst: schema });
  assert.match(message, /\(got "x+\.\.\.\)$/);
});

test('errors that are not plain unions keep their exact wording', async () => {
  await withClient(async (client) => {
    assert.match(await createSceneError(client, { materials: [{ id: 'paint', color: [0.5, 0.5, 2] }] }), /recipe\.materials\.0\.color\.2: Too big: expected number to be <=1 \(got 2\)/);
    assert.match(await createSceneError(client, { materials: [{ id: 'paint', color: 'red' }] }), /recipe\.materials\.0\.color: Invalid input: expected tuple, received string/);
    assert.match(await createSceneError(client, { nodes: [{ id: 'n', unknownField: 1 }] }), /recipe\.nodes\.0: Unrecognized key: "unknownField"/);
    assert.match(await createSceneError(client, { nodes: [{ id: 7 }] }), /recipe\.nodes\.0\.id: Invalid input: expected string, received number/);
  });
});

test('discriminated unions and unions the formatter cannot describe keep the library wording', () => {
  const discriminated = z.discriminatedUnion('type', [z.strictObject({ type: z.literal('box') }), z.strictObject({ type: z.literal('ball') })]);
  const discriminatedIssue = discriminated.safeParse({ type: 'cone' }).error.issues[0];
  assert.equal(describeUnionIssue({ ...discriminatedIssue, inst: discriminated }), undefined);
  const opaque = z.union([z.number(), z.custom(() => false)]);
  const opaqueIssue = opaque.safeParse('x').error.issues[0];
  assert.equal(describeUnionIssue({ ...opaqueIssue, inst: opaque }), undefined);
});

function collectUnions(node, path, found) {
  if (!node || typeof node !== 'object') {
    return;
  }
  const options = node.anyOf ?? node.oneOf;
  if (Array.isArray(options)) {
    found.push({ path, options });
  }
  for (const [key, child] of Object.entries(node)) {
    collectUnions(child, `${path}.${key}`, found);
  }
}

// A nullable field is an anyOf of the value and null in JSON Schema, but the validator reports it as a plain type error.
function isNullable(union) {
  return union.options.length === 2 && union.options.some((option) => option.type === 'null');
}

function isDescribable(option) {
  return option && (option.const !== undefined || option.enum || option.type || option.anyOf || option.oneOf);
}

test('every union in a tool input schema is made of shapes the formatter can name', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const undescribable = [];
    for (const tool of tools) {
      const unions = [];
      collectUnions(tool.inputSchema, tool.name, unions);
      for (const union of unions) {
        if (!isNullable(union) && !union.options.every(isDescribable)) {
          undescribable.push(union.path);
        }
      }
    }
    assert.deepEqual(undescribable, [], 'these unions would answer a bad value with a bare "Invalid input"; give each option a type');
  });
});
