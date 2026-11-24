import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// A draft pull request runs no CI job, so the rounds a worker pushes to a draft take no runner slot (#3267).
// Marking it ready (ready_for_review) starts the full run.
const draftGuard = '!github.event.pull_request.draft';

function readWorkflow(name) {
  return readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function jobBlocks(workflowText) {
  const jobsText = workflowText.slice(workflowText.indexOf('\njobs:\n'));
  return [...jobsText.matchAll(/\n {2}([a-z0-9-]+):\n((?: {4}.*\n|\s*\n)*)/g)].map(match => ({ name: match[1], body: match[2] }));
}

for (const workflowName of ['test.yml', 'cook-addon.yml']) {
  test(`${workflowName} runs again when a draft is marked ready`, () => {
    assert.match(readWorkflow(workflowName), /pull_request:\n {4}(?:#.*\n {4})?types: \[opened, synchronize, reopened, ready_for_review\]/);
  });

  test(`every job in ${workflowName} skips a draft pull request`, () => {
    const jobs = jobBlocks(readWorkflow(workflowName));
    assert.ok(jobs.length > 0, `no jobs found in ${workflowName}`);
    for (const job of jobs) {
      const condition = /^ {4}if: (.*)$/m.exec(job.body);
      const guarded = condition && condition[1].includes(draftGuard);
      const followsGuardedJob = !condition && /^ {4}needs: /m.test(job.body);
      assert.ok(guarded || followsGuardedJob, `job ${job.name} in ${workflowName} must have "if: ... ${draftGuard}" or only need jobs that have it`);
    }
  });
}
