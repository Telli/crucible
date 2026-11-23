// Gate scripts that exited 0 when they should fail: a tool schema finding, an empty change note and an lcov with no branch records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function runGit(folder, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: folder, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('check-tool-schemas ends with exit code 1 when a tool breaks a portable rule', async () => {
  const { reportToolSchemas } = await import('../scripts/check-tool-schemas.mjs');
  const goodTool = { name: 'scene_ok', description: 'Does a thing.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
  const badTool = { ...goodTool, name: 'scene ok with spaces' };
  assert.equal(reportToolSchemas([goodTool]).exitCode, 0);
  const report = reportToolSchemas([goodTool, badTool]);
  assert.equal(report.exitCode, 1);
  assert.match(report.lines.join('\n'), /tool-name/);
  assert.match(report.lines.at(-1), /^FAIL 1 portable finding\(s\)\. Fix:/);
});

test('an added change note with no bullet fails check-change-note, because the fold would drop it', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'empty-note-gate-'));
  try {
    runGit(folder, 'init', '-q');
    mkdirSync(join(folder, 'changes'));
    mkdirSync(join(folder, 'src'));
    writeFileSync(join(folder, 'package.json'), '{"version":"1.0.0"}\n');
    writeFileSync(join(folder, 'src', 'a.js'), 'export const a = 1;\n');
    runGit(folder, 'add', '.');
    runGit(folder, 'commit', '-q', '-m', 'base');
    writeFileSync(join(folder, 'src', 'a.js'), 'export const a = 2;\n');
    writeFileSync(join(folder, 'changes', '7.md'), 'Fixed a thing.\n');
    runGit(folder, 'add', '.');
    runGit(folder, 'commit', '-q', '-m', 'change');
    const failing = spawnSync(process.execPath, [join(root, 'scripts', 'check-change-note.mjs'), '--base', 'HEAD~1'], { cwd: folder, encoding: 'utf8' });
    assert.equal(failing.status, 1, failing.stdout + failing.stderr);
    assert.match(failing.stderr, /changes\/7\.md has no "- " bullet/);
    writeFileSync(join(folder, 'changes', '7.md'), '- Fixed a thing (#7)\n');
    runGit(folder, 'add', '.');
    runGit(folder, 'commit', '-q', '-m', 'bullet');
    const passing = spawnSync(process.execPath, [join(root, 'scripts', 'check-change-note.mjs'), '--base', 'HEAD~2'], { cwd: folder, encoding: 'utf8' });
    assert.equal(passing.status, 0, passing.stdout + passing.stderr);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('emptyNoteGates reads only top-level change notes and skips size notes', async () => {
  const { emptyNoteGates } = await import('../scripts/check-change-note.mjs');
  const texts = { 'changes/1.md': '- ok (#1)', 'changes/2.md': '  \n', 'changes/3.size.md': 'no bullet', 'changes\\4.md': 'prose', 'changes/sub/5.md': 'prose' };
  const gates = emptyNoteGates(Object.keys(texts), path => texts[path]);
  assert.deepEqual(gates.map(gate => gate.failure.split(' ')[0]), ['changes/2.md', 'changes\\4.md']);
});

test('an lcov with lines but no branch or function records fails the coverage gate', () => {
  const folder = mkdtempSync(join(tmpdir(), 'coverage-no-branches-'));
  try {
    const lcovPath = join(folder, 'lines-only.lcov');
    const baselinePath = join(folder, 'baseline.json');
    writeFileSync(lcovPath, ['SF:src/a.js', 'DA:1,1', 'DA:2,1', 'end_of_record', ''].join('\n'));
    writeFileSync(baselinePath, JSON.stringify({ lines: 90, branches: 80, functions: 90 }));
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'coverage-gate.mjs'), lcovPath, '--baseline', baselinePath], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /no branches or functions records/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('check-change-note reports a clear message when --base has no ref after it', () => {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'check-change-note.mjs'), '--base'], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Pass a branch or commit after --base/);
});
