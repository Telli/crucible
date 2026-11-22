import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BUNDLED_FILE_URLS, createCatalogHooks } from '../bench/studio/catalog-hooks.js';
import { BUNDLED_CUBE_LOOK_NAMES, BUNDLED_ENVIRONMENT_NAMES } from '../src/look-catalog.js';

const FOLDER = new URL('http://localhost/catalog/');
const SCAN_ID = 'cd'.repeat(32);

function fileFetch(requested) {
  return async url => {
    requested.push(String(url));
    if (url.protocol === 'file:') {
      const bytes = await readFile(url);
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => bytes.toString('utf8') };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(3), text: async () => 'LUT_3D_SIZE 2' };
  };
}

test('every bundled HDRI and look has a file URL that reads', async () => {
  const requested = [];
  const hooks = createCatalogHooks(null, fileFetch(requested));
  for (const name of BUNDLED_ENVIRONMENT_NAMES) {
    assert.ok(BUNDLED_FILE_URLS[`${name}.hdr`], name);
    assert.ok((await hooks.environment(name)).byteLength > 0, name);
  }
  for (const name of BUNDLED_CUBE_LOOK_NAMES) {
    assert.ok(BUNDLED_FILE_URLS[`${name}.cube`], name);
    assert.match(await hooks.look(name), /LUT_3D_SIZE/, name);
  }
});

test('bundled names resolve without a catalog folder and never touch it with one', async () => {
  const requested = [];
  await createCatalogHooks(null, fileFetch(requested)).environment('studio-softbox');
  await createCatalogHooks(FOLDER, fileFetch(requested)).look('noir');
  assert.equal(requested.length, 2);
  assert.ok(requested.every(url => url.startsWith('file:')), requested.join(' '));
});

test('an id goes to the catalog folder', async () => {
  const requested = [];
  const hooks = createCatalogHooks(FOLDER, fileFetch(requested));
  await hooks.environment(SCAN_ID);
  await hooks.look(SCAN_ID);
  await hooks.asset(SCAN_ID);
  assert.deepEqual(requested, [`${FOLDER}${SCAN_ID}.hdr`, `${FOLDER}${SCAN_ID}.cube`, `${FOLDER}${SCAN_ID}.glb`]);
});

test('an id with no catalog folder throws a message that names the fix', async () => {
  const hooks = createCatalogHooks(null, fileFetch([]));
  await assert.rejects(hooks.environment(SCAN_ID), /no catalog folder.*\?catalog=<folder>/);
  await assert.rejects(hooks.look(SCAN_ID), /no catalog folder.*\?catalog=<folder>/);
  assert.equal(hooks.asset, undefined);
});
