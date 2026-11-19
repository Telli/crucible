// Proves new tests pin a fix: reverts the branch's changes under src/, bin/ and packages/ (committed and uncommitted,
// compared with the base ref), runs the given tests, reports which fail, then puts the changes back.
// At least one test must fail; if every test still passes, it does not test the change and the command exits 1.
// Usage: npm run test:mutation-check -- tests/foo.test.js [tests/bar.test.js ...] [--base <ref>]
// The patch is saved to artifacts/mutation-check/ first, so an interrupted run can be restored with git apply <patch>.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule, repositoryRoot, runTestFiles } from './test-run.mjs';

export const REVERTED_FOLDERS = ['src', 'bin', 'packages', 'scripts'];

function git(arguments_, folder, input) {
  const result = spawnSync('git', arguments_, { cwd: folder, encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
  return { ok: result.status === 0, output: result.stdout ?? '', error: result.stderr ?? '' };
}

function isUnderRevertedFolder(path) {
  return REVERTED_FOLDERS.some(folderName => path.startsWith(`${folderName}/`));
}

// Porcelain lines: "XY path". Refuses what the revert cannot restore faithfully.
export function findBlockingChanges(porcelainText) {
  const blockers = [];
  for (const line of porcelainText.split('\n').filter(Boolean)) {
    const status = line.slice(0, 2);
    const path = line.slice(3).replace(/\\/g, '/');
    if (status === '??' && isUnderRevertedFolder(path)) {
      blockers.push(`${path} is a new untracked file under a reverted folder; run git add -N ${path} so the revert includes it.`);
    } else if (status !== '??' && status[1] !== ' ' && !isUnderRevertedFolder(path)) {
      blockers.push(`${path} has unstaged changes outside ${REVERTED_FOLDERS.join('/, ')}/; stage or commit them (git add ${path}) first.`);
    }
  }
  return blockers;
}

function branchPatch(baseRef, folder) {
  const mergeBase = git(['merge-base', baseRef, 'HEAD'], folder);
  const diff = git(['diff', '--binary', '--no-renames', mergeBase.ok ? mergeBase.output.trim() : baseRef, '--', ...REVERTED_FOLDERS], folder);
  if (!diff.ok) throw new Error(`git diff against ${baseRef} failed: ${diff.error.trim()}. Pass --base <ref> with a ref that exists.`);
  return diff.output;
}

// Returns { failingTests, passingRun, patchPath, restored }. Throws before touching the tree when the call is invalid.
export function runMutationCheck(testFiles, { folder = repositoryRoot, baseRef = 'origin/main', runTests = runTestFiles } = {}) {
  if (testFiles.length === 0) throw new Error('Name the tests to run: npm run test:mutation-check -- tests/<name>.test.js');
  const missing = testFiles.filter(testFile => !existsSync(join(folder, testFile)));
  if (missing.length > 0) throw new Error(`Test file not found: ${missing.join(', ')}. Pass paths like tests/<name>.test.js.`);
  const status = git(['status', '--porcelain'], folder);
  if (!status.ok) throw new Error(`git status failed: ${status.error.trim()}`);
  const blockers = findBlockingChanges(status.output);
  if (blockers.length > 0) throw new Error(`Refusing to run:\n${blockers.join('\n')}`);
  const patch = branchPatch(baseRef, folder);
  if (!patch.trim()) {
    throw new Error(`Nothing to revert: ${REVERTED_FOLDERS.join(', ')} match ${baseRef}. A fix needs a change there; commit or stage it first.`);
  }

  const patchFolder = join(folder, 'artifacts', 'mutation-check');
  mkdirSync(patchFolder, { recursive: true });
  const patchPath = join(patchFolder, `${new Date().toISOString().replace(/[:.]/g, '-')}.patch`);
  writeFileSync(patchPath, patch);

  const reverted = git(['apply', '-R', '--whitespace=nowarn'], folder, patch);
  if (!reverted.ok) throw new Error(`Could not revert the changes cleanly: ${reverted.error.trim()}`);
  let run;
  try {
    run = runTests(testFiles, { folder });
  } finally {
    const restoredNow = git(['apply', '--whitespace=nowarn'], folder, patch);
    if (!restoredNow.ok) {
      throw new Error(`The changes could not be restored: ${restoredNow.error.trim()}. Run git apply ${patchPath}`);
    }
  }
  const restored = branchPatch(baseRef, folder) === patch;
  if (!restored) throw new Error(`The tree differs from before the check. Run git diff, then git apply ${patchPath} if changes are missing.`);
  return { failingTests: run.failures, passingRun: run.code === 0, patchPath, restored };
}

export function parseArguments(arguments_) {
  let baseRef = 'origin/main';
  const testFiles = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--base' || argument.startsWith('--base=')) {
      baseRef = argument === '--base' ? arguments_[(index += 1)] : argument.slice('--base='.length);
      if (!baseRef) throw new Error('--base needs a ref: --base <ref> or --base=<ref>, for example --base origin/main.');
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option ${argument}. The only option is --base <ref>.`);
    } else {
      testFiles.push(argument);
    }
  }
  return { baseRef, testFiles };
}

function main(arguments_) {
  let result;
  try {
    const { baseRef, testFiles } = parseArguments(arguments_);
    result = runMutationCheck(testFiles, { baseRef });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (result.failingTests.length === 0) {
    console.error('MUTATION CHECK FAILED: every test still passes with the changes reverted, so none of them pins the change.');
    process.exit(1);
  }
  console.log(`MUTATION CHECK OK: ${result.failingTests.length} test(s) fail without the change:`);
  for (const failure of result.failingTests.slice(0, 20)) console.log(`  ${failure.file} :: ${failure.name}`);
  console.log('Changes restored.');
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
