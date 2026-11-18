// Runs `icons` render jobs through the MCP server on the cpu backend, for the smoke script and the tests that need real pixels.
//   const server = await startIconsServer({ assets: '<folder of .glb files>' });
//   const { artifacts, manifest } = await server.runJob({ items: ['a.glb'], size: 64, style: 'sketch' });
//   await server.close();
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const COMMAND_LINE_INTERFACE = fileURLToPath(new URL('../bin/crucible-mcp.mjs', import.meta.url));
const FINISHED_STATES = ['completed', 'failed', 'cancelled'];
const JOB_TIMEOUT_MS = 580000;
const EMPTY_SCENE = { format: 'crucible.scene', schemaVersion: 1, geometries: [{ id: 'g', type: 'box' }], materials: [{ id: 'm' }], nodes: [{ id: 'n', geometry: 'g', material: 'm' }] };

/** Starts the MCP server on the cpu backend over a folder of GLB files. `close()` stops it and removes its job folder. */
export async function startIconsServer({ assets, memory = 256 }) {
  const workFolder = await mkdtemp(join(tmpdir(), 'crucible-icons-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [COMMAND_LINE_INTERFACE, '--backend', 'cpu', '--memory', String(memory), '--assets', resolve(assets), '--jobs', join(workFolder, 'jobs')],
    stderr: 'pipe',
  });
  let diagnostics = '';
  transport.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-4096); });
  const client = new Client({ name: 'crucible-icons-proof', version: '1' });
  await client.connect(transport);

  async function call(name, argumentsValue = {}) {
    const result = await client.callTool({ name, arguments: argumentsValue }, { timeout: JOB_TIMEOUT_MS });
    assert.equal(result.isError, undefined, `${result.content?.find(item => item.type === 'text')?.text}\n${diagnostics}`);
    return result.structuredContent;
  }

  async function runJob(settings) {
    const created = await call('scene_create', { recipe: EMPTY_SCENE });
    const submitted = await call('scene_render_submit', { sessionId: created.sessionId, expectedRevision: 0, settings: { kind: 'icons', ...settings } });
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    for (;;) {
      const record = await call('scene_render_status', { jobId: submitted.jobId });
      if (FINISHED_STATES.includes(record.state)) {
        assert.equal(record.state, 'completed', `${record.reason}\n${diagnostics}`);
        break;
      }
      assert.ok(Date.now() < deadline, 'The icons job did not finish in time.');
      await new Promise(done => setTimeout(done, 300));
    }
    const result = await call('scene_render_result', { jobId: submitted.jobId });
    const artifacts = new Map(result.artifacts.map(artifact => [artifact.filename, artifact.path]));
    const manifest = JSON.parse(await readFile(artifacts.get('icons.json'), 'utf8'));
    return { jobId: submitted.jobId, artifacts, manifest, metrics: result.metrics };
  }

  return {
    runJob,
    call,
    async close() {
      await client.close();
      await rm(workFolder, { recursive: true, force: true });
    },
  };
}
