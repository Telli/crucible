import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packIndexScript = fileURLToPath(new URL('../scripts/build-pack-index.mjs', import.meta.url));

function temporaryFolder(context) {
  const folder = mkdtempSync(join(tmpdir(), 'crucible-script-green-'));
  context.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function runPackIndex(...args) {
  return spawnSync(process.execPath, [packIndexScript, ...args], { encoding: 'utf8', windowsHide: true });
}

test('the pack index build fails when the packs folder does not exist, and leaves the output alone', (context) => {
  const folder = temporaryFolder(context);
  const result = runPackIndex('--packs', join(folder, 'pakcs'), '--out', join(folder, 'out'));
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /packs folder .*pakcs.* does not exist/);
  assert.equal(existsSync(join(folder, 'out', 'index.json')), false);
});

test('the pack index build names the flag that has no folder after it', (context) => {
  const folder = temporaryFolder(context);
  const result = runPackIndex('--packs', folder, '--out');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--out needs a folder/);
});

test('the change note gate accepts only a note the fold reads', async () => {
  const { planChecks } = await import('../scripts/preflight.mjs');
  const noteCheck = paths => planChecks(['src/camera.js', ...paths]).find(check => check.name === 'change note');
  assert.equal(noteCheck(['changes/700.md']).failure, null);
  for (const ignoredByFold of ['changes/archive/700.md', 'changes/readme.md', 'changes/README.md']) {
    assert.match(noteCheck([ignoredByFold]).failure, /adds no changes\/<issue>\.md/, ignoredByFold);
  }
});

test('a group heading in one fragment does not regroup the bullets of the next fragment after the fold', async () => {
  const { foldIntoChangelog, parseChangelogSections, parseEntries } = await import('../scripts/changelog-fragments.mjs');
  const fragments = [
    { name: '1.md', text: '### Breaking changes\n- Breaking: the old export is gone (#1)' },
    { name: '2.md', text: '- A new option (#2)\n  media: https://example.com/a.png The option' },
  ];
  const folded = foldIntoChangelog('# Changelog\n\n## 0.1.0\n\n- First (#0)\n', '0.2.0', fragments);
  const section = parseChangelogSections(folded).find(candidate => candidate.version === '0.2.0');
  const entries = parseEntries(section.body);
  const option = entries.find(entry => entry.issue === 2);
  assert.equal(option.breaking, false);
  assert.equal(option.group, undefined);
  assert.equal(option.media.alt, 'The option');
  assert.equal(entries.find(entry => entry.issue === 1).group, 'Breaking changes');
  assert.equal(entries.length, 2);
});

test('test-each-file fails and names the fragment when no test file matches', () => {
  const script = fileURLToPath(new URL('../scripts/test-each-file.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'no-such-test-file-fragment'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /No test file in tests\/ matches "no-such-test-file-fragment"/);
  assert.doesNotMatch(result.stdout, /0 of 0/);
});
