import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentRenderJobs } from '../scripts/agent-render-jobs.mjs';

const OUTPUT_BYTES_PER_JOB = 160 * 1024;
const limits = { maxOutputBytes: 300 * 1024, maxFrameBytes: 200 * 1024, maxStoreBytes: 1024 ** 2, cleanupMs: 100 };
const submission = { sourceRevision: 1, snapshot: { recipe: { format: 'fixture' } }, settings: { kind: 'image', width: 64, height: 64 } };

async function writeOutputRunner({ directory, progress }) {
  await writeFile(join(directory, 'render.png.partial'), Buffer.alloc(OUTPUT_BYTES_PER_JOB, 1));
  await progress({ frames: 1, maximumPendingFrames: 1 });
  return { artifacts: [{ temporary: 'render.png.partial', filename: 'render.png', mimeType: 'image/png' }], metrics: {} };
}

async function withController(context) {
  const root = await mkdtemp(join(tmpdir(), 'crucible-render-store-'));
  const controller = await createAgentRenderJobs({ root, limits, run: writeOutputRunner });
  context.after(async () => {
    await controller.close();
    await rm(root, { recursive: true, force: true });
  });
  return { controller, root };
}

async function submitAndSettle(controller) {
  const { jobId } = await controller.submit(submission);
  while (!['completed', 'failed', 'cancelled'].includes(controller.status(jobId).state)) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(controller.status(jobId).state, 'completed', controller.status(jobId).reason);
  return jobId;
}

test('a full store releases completed jobs whose result was read, oldest first, before it refuses', async context => {
  const { controller, root } = await withController(context);
  const jobIds = [];
  for (let index = 0; index < 4; index += 1) {
    const jobId = await submitAndSettle(controller);
    controller.result(jobId);
    jobIds.push(jobId);
  }
  const fifth = await submitAndSettle(controller);
  const remaining = controller.list().map(record => record.jobId);
  assert.ok(!remaining.includes(jobIds[0]), 'the oldest fetched job is released');
  assert.ok(remaining.includes(fifth));
  await assert.rejects(access(join(root, jobIds[0])), { code: 'ENOENT' });
  assert.ok(remaining.includes(jobIds[3]), 'newer fetched jobs stay while the oldest release is enough');
});

test('a job whose result was never read is never released to make room, and the refusal names the release tool and the sizes', async context => {
  const { controller } = await withController(context);
  const unread = [];
  for (let index = 0; index < 4; index += 1) unread.push(await submitAndSettle(controller));
  await assert.rejects(controller.submit(submission), error => {
    assert.match(error.message, /scene_render_release/);
    assert.match(error.message, /needs \d+ MiB free and has \d+ MiB/);
    return true;
  });
  assert.deepEqual(controller.list().map(record => record.jobId), unread);
});
