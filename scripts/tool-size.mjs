import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { listTools, estimateTokens } from './measure-tool-cost.mjs';

// One row per MCP tool: the byte length of its JSON entry in tools/list, largest first.
export async function measureToolSizes() {
  const tools = await listTools();
  const rows = tools
    .map(tool => ({ name: tool.name, bytes: Buffer.byteLength(JSON.stringify(tool)) }))
    .sort((first, second) => second.bytes - first.bytes || first.name.localeCompare(second.name));
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  return { rows, totalBytes, estimatedTokens: estimateTokens(totalBytes) };
}

export function formatToolSizes({ rows, totalBytes, estimatedTokens }) {
  const nameWidth = Math.max(...rows.map(row => row.name.length));
  const lines = rows.map(row => `${row.name.padEnd(nameWidth)}  ${row.bytes.toLocaleString('en-US').padStart(7)} B  ${estimateTokens(row.bytes).toLocaleString('en-US').padStart(6)} tokens`);
  lines.push(`${'total'.padEnd(nameWidth)}  ${totalBytes.toLocaleString('en-US').padStart(7)} B  ${estimatedTokens.toLocaleString('en-US').padStart(6)} tokens (${rows.length} tools)`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(formatToolSizes(await measureToolSizes()));
  process.exit(0);
}
