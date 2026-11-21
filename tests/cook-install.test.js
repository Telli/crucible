import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  checkCookInstall, compareCookInstall, FIX_COMMANDS, pinnedCookFromLock, readInstalledCook, unpinnedCookAllowed,
} from '../scripts/cook-install-check.mjs';

const PINNED_COMMIT = '55f2448dbb5121d82a5b125c3564403b64798d03';
const OTHER_COMMIT = '212c0bafaf2dfbbf60cb5c759c5cf759d23198c7';
const PINNED = { version: '0.2.0', commit: PINNED_COMMIT };

function lockText(resolved, version = '0.2.0') {
  return JSON.stringify({ packages: { 'node_modules/@codepawlhq/cook': { version, resolved } } });
}

// The check that keeps a Cook that is not the pinned one from failing deep inside Cook (#2274).
test('the Cook installed in this checkout is the one package-lock.json pins, or absent', () => {
  const result = checkCookInstall();
  assert.notEqual(result.status, 'mismatch', result.message);
});

test('the pin is the version and the commit after the # of the resolved git URL', () => {
  assert.deepEqual(pinnedCookFromLock(lockText(`git+https://github.com/codepawl/cook.git#${PINNED_COMMIT}`)), PINNED);
  assert.deepEqual(pinnedCookFromLock(lockText('https://registry.npmjs.org/x.tgz', '0.3.0')), { version: '0.3.0', commit: null });
  assert.equal(pinnedCookFromLock(JSON.stringify({ packages: {} })), null);
  assert.throws(() => pinnedCookFromLock(undefined), /pass the text of package-lock.json/);
});

test('a matching version without git, or a matching commit, is a match', () => {
  assert.equal(compareCookInstall({ pinned: PINNED, installed: { version: '0.2.0', commit: null, directory: 'cook' } }).status, 'match');
  assert.equal(compareCookInstall({ pinned: PINNED, installed: { version: '0.2.0', commit: PINNED_COMMIT, directory: 'cook' } }).status, 'match');
  assert.equal(compareCookInstall({ pinned: null, installed: { version: '0.1.0', commit: null, directory: 'cook' } }).status, 'match');
  assert.equal(compareCookInstall({ pinned: PINNED, installed: null }).status, 'absent');
});

test('another version or another commit is a mismatch that names both and the command to run', () => {
  const linked = compareCookInstall({ pinned: PINNED, installed: { version: '0.1.1', commit: OTHER_COMMIT, directory: 'cook-checkout' } });
  assert.equal(linked.status, 'mismatch');
  for (const part of ['0.1.1 (212c0baf)', 'cook-checkout', '0.2.0 (55f2448d)', FIX_COMMANDS, 'check out 55f2448d there']) {
    assert.ok(linked.message.includes(part), `${part} is missing from: ${linked.message}`);
  }
  const sameVersionOtherCommit = compareCookInstall({ pinned: PINNED, installed: { version: '0.2.0', commit: OTHER_COMMIT, directory: 'cook' } });
  assert.equal(sameVersionOtherCommit.status, 'mismatch');
  const copied = compareCookInstall({ pinned: PINNED, installed: { version: '0.1.1', commit: null, directory: 'cook' } });
  assert.equal(copied.status, 'mismatch');
  assert.ok(!copied.message.includes('git checkout'));
});

test('Cook CI and COOK_ALLOW_UNPINNED=1 allow a mismatch, Crucible CI and a plain shell do not', () => {
  assert.equal(unpinnedCookAllowed({ GITHUB_REPOSITORY: 'codepawl/cook' }), true);
  assert.equal(unpinnedCookAllowed({ COOK_ALLOW_UNPINNED: '1' }), true);
  assert.equal(unpinnedCookAllowed({ GITHUB_REPOSITORY: 'codepawl/crucible' }), false);
  assert.equal(unpinnedCookAllowed({}), false);
  const installed = { version: '0.1.1', commit: OTHER_COMMIT, directory: 'cook' };
  assert.equal(compareCookInstall({ pinned: PINNED, installed, environment: { GITHUB_REPOSITORY: 'codepawl/cook' } }).status, 'allowed');
});

test('the installed Cook is read from node_modules, with no commit when it is not a git checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'cook-install-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}');
    assert.equal(readInstalledCook(root), null);
    assert.equal(checkCookInstall({ root, environment: {} }).status, 'absent');
    const cookDirectory = join(root, 'node_modules', '@codepawlhq', 'cook');
    mkdirSync(cookDirectory, { recursive: true });
    writeFileSync(join(cookDirectory, 'package.json'), JSON.stringify({ name: '@codepawlhq/cook', version: '0.1.1', main: 'index.mjs' }));
    const installed = readInstalledCook(root);
    assert.equal(installed.version, '0.1.1');
    assert.equal(installed.commit, null);
    writeFileSync(join(root, 'package-lock.json'), lockText(`git+https://github.com/codepawl/cook.git#${PINNED_COMMIT}`));
    assert.equal(checkCookInstall({ root, environment: {} }).status, 'mismatch');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
