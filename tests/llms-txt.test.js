import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildLlmsText, listRegisteredTools, summarize } from '../scripts/generate-llms.mjs';

// A Windows checkout may turn LF into CRLF; compare the text, not the line endings.
const llmsText = (await readFile(new URL('../public/llms.txt', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('summarize does not end a sentence at e.g. or i.e.', () => {
  assert.equal(summarize('Use e.g. a JSON recipe to build a scene. Then render it.'), 'Use e.g. a JSON recipe to build a scene.');
  assert.equal(summarize('Use i.e. the recipe form. Then render.'), 'Use i.e. the recipe form.');
});

test('summarize cuts before an unclosed code span', () => {
  const summary = summarize('Use `scene_create` with ' + 'x '.repeat(40) + '`a long code span with words inside it` then finish.');
  assert.equal((summary.match(/`/g) ?? []).length % 2, 0, summary);
});

test('llms.txt names every registered MCP tool', async () => {
  const tools = await listRegisteredTools();
  const missing = tools.filter(tool => !llmsText.includes(`\`${tool.name}\``)).map(tool => tool.name);
  assert.deepEqual(missing, [], 'run `npm run llms` to add the tool to public/llms.txt');
});

test('llms.txt is what the generator writes from the current registry', async () => {
  const expected = buildLlmsText(await listRegisteredTools());
  assert.equal(llmsText, expected, 'public/llms.txt is stale, run `npm run llms`');
});

test('llms.txt points agents at the server, the plugin and the changelog data', () => {
  assert.doesNotMatch(llmsText, /does not expose an MCP server/);
  assert.match(llmsText, /\/plugin marketplace add codepawl\/crucible/);
  assert.match(llmsText, /\/plugin install crucible@crucible/);
  assert.match(llmsText, /@codepawlhq\/crucible/);
  assert.match(llmsText, /changelog\.json/);
});
