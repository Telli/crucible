import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_FILE_LIMIT_MS,
  DEFAULT_GRACE_AFTER_TIMEOUT_MS,
  childrenByParent,
  descendantsOf,
  fileLimitMilliseconds,
  graceAfterTimeoutMilliseconds,
} from '../scripts/test-hang-guard.mjs';

const repositoryRoot = join(import.meta.dirname, '..');
const guardPath = join(repositoryRoot, 'scripts', 'test-hang-guard.mjs');
const hangingFixturePath = join(repositoryRoot, 'tests', 'fixtures', 'hanging-test-file.js');
const leftoverFixturePath = join(repositoryRoot, 'tests', 'fixtures', 'leftover-child-test-file.js');

function isProcessAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function runFixture(fixturePath, { testTimeout, environment }) {
  // The runner this test runs in marks its environment; a nested runner must not think it is already inside one.
  const { NODE_TEST_CONTEXT: _outerRunner, ...baseEnvironment } = process.env;
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    ['--test', '--import', pathToFileURL(guardPath).href, `--test-timeout=${testTimeout}`, fixturePath],
    { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, timeout: 110000, env: { ...baseEnvironment, ...environment } },
  );
  return { ...result, seconds: (Date.now() - startedAt) / 1000, output: `${result.stdout}\n${result.stderr}` };
}

function processIdFrom(output, label) {
  const processId = Number(new RegExp(`${label}=(\\d+)`).exec(output)?.[1]);
  assert.ok(Number.isInteger(processId), `the fixture prints ${label}, output:\n${output}`);
  return processId;
}

test('a hang ends a short grace after its test times out, not at the file limit, names the test and leaves no child or grandchild', () => {
  const run = runFixture(hangingFixturePath, {
    testTimeout: 2000,
    environment: { CRUCIBLE_TEST_FILE_LIMIT_MS: '90000', CRUCIBLE_TEST_GRACE_AFTER_TIMEOUT_MS: '2000' },
  });

  assert.notEqual(run.status, 0, `the hanging file must fail the run, output:\n${run.output}`);
  assert.ok(run.seconds < 30, `the run took ${run.seconds} s: the file lived on towards its 90 s limit instead of stopping after the grace`);
  assert.match(run.output, /this test hangs on purpose while a child process runs/, 'the hanging test is named');
  assert.match(run.output, /test timed out after 2000ms/);
  assert.match(run.output, /TEST FILE HUNG: .*hanging-test-file\.js .*after a test timed out/, 'the guard names the file and why');

  assert.equal(isProcessAlive(processIdFrom(run.output, 'HANGING_CHILD_PID')), false, 'the child was left running');
  assert.equal(isProcessAlive(processIdFrom(run.output, 'HANGING_GRANDCHILD_PID')), false, "the child's own child was left running");
});

test('a file that hangs without any test timing out is still stopped at the file limit', () => {
  const run = runFixture(hangingFixturePath, {
    testTimeout: 100000,
    environment: { CRUCIBLE_TEST_FILE_LIMIT_MS: '4000', CRUCIBLE_TEST_GRACE_AFTER_TIMEOUT_MS: '60000' },
  });

  assert.notEqual(run.status, 0);
  assert.match(run.output, /TEST FILE HUNG: .*hanging-test-file\.js was still running after 4000 ms/);
  assert.equal(isProcessAlive(processIdFrom(run.output, 'HANGING_GRANDCHILD_PID')), false);
});

test('a passing file that leaves an unref\'d child running has the child killed when it exits', () => {
  const run = runFixture(leftoverFixturePath, { testTimeout: 100000, environment: {} });

  assert.equal(run.status, 0, `the passing file must pass, output:\n${run.output}`);
  assert.doesNotMatch(run.output, /TEST FILE HUNG/);
  assert.equal(isProcessAlive(processIdFrom(run.output, 'LEFTOVER_CHILD_PID')), false, 'the leftover child outlived its file');
});

test('descendantsOf walks every level of a process listing', () => {
  const listing = ['  1 0', ' 10 1', ' 11 10', ' 12 11', ' 20 1', 'junk line', ' 13 10'].join('\n');
  const found = descendantsOf(10, childrenByParent(listing));
  assert.deepEqual([...found].sort((a, b) => a - b), [11, 12, 13]);
  assert.deepEqual(descendantsOf(99, childrenByParent(listing)), []);
});

test('the limits have defaults and reject a value that is not a positive number', () => {
  assert.equal(fileLimitMilliseconds({}), DEFAULT_FILE_LIMIT_MS);
  assert.equal(fileLimitMilliseconds({ CRUCIBLE_TEST_FILE_LIMIT_MS: '5000' }), 5000);
  assert.equal(graceAfterTimeoutMilliseconds({}), DEFAULT_GRACE_AFTER_TIMEOUT_MS);
  assert.equal(graceAfterTimeoutMilliseconds({ CRUCIBLE_TEST_GRACE_AFTER_TIMEOUT_MS: '3000' }), 3000);
  assert.throws(() => fileLimitMilliseconds({ CRUCIBLE_TEST_FILE_LIMIT_MS: 'soon' }), /must be a positive number of milliseconds/);
  assert.throws(() => fileLimitMilliseconds({ CRUCIBLE_TEST_FILE_LIMIT_MS: '-1' }), /must be a positive number of milliseconds/);
  assert.throws(() => graceAfterTimeoutMilliseconds({ CRUCIBLE_TEST_GRACE_AFTER_TIMEOUT_MS: '0' }), /must be a positive number of milliseconds/);
});

test('a limit longer than a timer can hold is refused instead of stopping the file after 1 ms', () => {
  assert.equal(fileLimitMilliseconds({ CRUCIBLE_TEST_FILE_LIMIT_MS: '2147483647' }), 2147483647);
  assert.throws(() => fileLimitMilliseconds({ CRUCIBLE_TEST_FILE_LIMIT_MS: '3000000000' }), /at most 2147483647/);
  assert.throws(() => graceAfterTimeoutMilliseconds({ CRUCIBLE_TEST_GRACE_AFTER_TIMEOUT_MS: '2147483648' }), /at most 2147483647/);
});
