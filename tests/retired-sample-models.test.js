import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The owner retired these sample models: the Wall-E robot (#2218) and the lantern scene of the old
// modeling page (#2822). Tests, smokes, benches, docs and evidence use the models that ship now
// (public/sample-model.glb, public/showcase/*) or new scenes built with Crucible.
// The patterns are built from pieces so this file does not match itself.
const RETIRED = [
  { name: 'the Wall-E robot', pattern: new RegExp(['wall', '[-_ ]?e\\b'].join(''), 'i') },
  { name: 'the lantern scene of the old modeling page', pattern: new RegExp(['modeling', '-(scene|player)'].join(''), 'i') },
  { name: 'the lantern scene smoke', pattern: new RegExp(['smoke', '-modeling\\b'].join(''), 'i') },
];

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SEARCHED_FOLDERS = ['src', 'bin', 'packages', 'scripts', 'tests', 'bench', 'docs', 'site', 'skills', 'public', 'README.md', 'FEATURES.md', 'package.json'];
const TEXT_FILE = /\.(m?js|cjs|ts|json|md|html|css|py|txt|ya?ml)$/i;
const THIS_FILE = 'tests/retired-sample-models.test.js';

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '--', ...SEARCHED_FOLDERS], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
  return output.split('\n').filter(Boolean);
}

test('no tracked file is named after a retired sample model', () => {
  const offenders = [];
  for (const path of trackedFiles()) {
    for (const retired of RETIRED) {
      if (retired.pattern.test(path)) offenders.push(`${path} (${retired.name})`);
    }
  }
  assert.deepEqual(offenders, [], 'Use public/sample-model.glb, a showcase scene or a new Crucible scene instead of a retired sample model.');
});

test('no tracked text file loads or names a retired sample model', () => {
  const offenders = [];
  for (const path of trackedFiles()) {
    if (path === THIS_FILE || !TEXT_FILE.test(path)) continue;
    const text = readFileSync(new URL(path, `file:///${REPOSITORY_ROOT.replaceAll('\\', '/')}`), 'utf8');
    for (const retired of RETIRED) {
      if (retired.pattern.test(text)) offenders.push(`${path} (${retired.name})`);
    }
  }
  assert.deepEqual(offenders, [], 'Use public/sample-model.glb, a showcase scene or a new Crucible scene instead of a retired sample model.');
});
