// scripts/validate-gltf.mjs: the Khronos glTF-Validator through loadGltf({ strict, validator }) (issue 2981).
// The real validator is an optional devDependency; its tests skip, saying why, when the package cannot be resolved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { plateGlb } from './helpers/plate-glb.mjs';
import { findGlbFiles, resolveValidator, validateGlbFile } from '../scripts/validate-gltf.mjs';

const SCRIPT = resolve('scripts/validate-gltf.mjs');
const realValidator = await resolveValidator();
const SKIP_WITHOUT_VALIDATOR = realValidator ? false : 'gltf-validator is not installed: run npm ci, or set GLTF_VALIDATOR to the folder of the gltf-validator package';

function fakeValidator(errorCount) {
  return { validateBytes: async () => ({ issues: { numErrors: errorCount, messages: errorCount ? [{ severity: 0, code: 'FAKE_ERROR', pointer: '/fake' }] : [] } }) };
}

async function withTemporaryGlb(indexList, run) {
  const directory = await mkdtemp(join(tmpdir(), 'crucible-validate-gltf-'));
  try {
    const path = join(directory, 'plate.glb');
    await writeFile(path, plateGlb(indexList));
    return await run(path, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('validateGlbFile passes a file the validator accepts and reports the mesh-check warnings', async () => {
  await withTemporaryGlb([0, 1, 2, 0, 1, 2], async path => {
    const result = await validateGlbFile(path, fakeValidator(0));
    assert.equal(result.passed, true);
    assert.equal(result.meshWarnings.length, 1);
    assert.match(result.meshWarnings[0], /1 duplicate triangle\(s\)/);
  });
});

test('validateGlbFile fails a file the validator rejects and names its first error', async () => {
  await withTemporaryGlb([0, 1, 2], async path => {
    const result = await validateGlbFile(path, fakeValidator(1));
    assert.equal(result.passed, false);
    assert.match(result.message, /glTF-Validator reported 1 error\(s\): FAKE_ERROR at \/fake/);
  });
});

test('findGlbFiles lists only .glb files, in order, from a folder', async () => {
  await withTemporaryGlb([0, 1, 2], async (path, directory) => {
    await writeFile(join(directory, 'notes.txt'), 'x');
    assert.deepEqual(await findGlbFiles(directory), [path]);
  });
});

test('the script exits 2 and says how to install the validator when it cannot find it', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--validator', join(tmpdir(), 'no-such-validator-folder'), 'public/sample-model.glb'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Run npm ci .*--validator <folder/);
});

test('the real validator passes a clean GLB through strict', { skip: SKIP_WITHOUT_VALIDATOR }, async () => {
  const result = await validateGlbFile(resolve('public/sample-model.glb'), realValidator);
  assert.equal(result.passed, true, result.message);
});

test('the real validator fails a GLB whose index points past its vertices', { skip: SKIP_WITHOUT_VALIDATOR }, async () => {
  await withTemporaryGlb([0, 1, 7], async path => {
    const result = await validateGlbFile(path, realValidator);
    assert.equal(result.passed, false);
    assert.match(result.message, /glTF-Validator reported \d+ error\(s\): ACCESSOR_INDEX_OOB/);
  });
});
