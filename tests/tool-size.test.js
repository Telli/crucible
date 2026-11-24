import test from 'node:test';
import assert from 'node:assert/strict';
import { measureToolSizes, formatToolSizes } from '../scripts/tool-size.mjs';

test('tool sizes: the total equals the sum of the rows and rows are sorted largest first', async () => {
  const sizes = await measureToolSizes();
  assert.ok(sizes.rows.length > 20, 'expected every MCP tool to be listed');
  assert.equal(sizes.totalBytes, sizes.rows.reduce((sum, row) => sum + row.bytes, 0));
  for (let index = 1; index < sizes.rows.length; index += 1) {
    assert.ok(sizes.rows[index - 1].bytes >= sizes.rows[index].bytes, `${sizes.rows[index].name} is out of order`);
  }
  assert.equal(sizes.estimatedTokens, Math.ceil(sizes.totalBytes / 3.5));
});

test('tool sizes: the printed table has one line per tool and a total line', async () => {
  const sizes = await measureToolSizes();
  const lines = formatToolSizes(sizes).split('\n');
  assert.equal(lines.length, sizes.rows.length + 1);
  assert.ok(lines.at(-1).startsWith('total') && lines.at(-1).includes(`${sizes.totalBytes.toLocaleString('en-US')} B`) && lines.at(-1).endsWith(`(${sizes.rows.length} tools)`), lines.at(-1));
  assert.ok(lines[0].startsWith(sizes.rows[0].name), lines[0]);
});
