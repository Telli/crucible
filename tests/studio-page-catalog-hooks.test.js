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

function answers(statuses, log = []) {
  return async (url, init = {}) => {
    log.push({ url: String(url), init });
    const answer = statuses[String(url).split('/').pop()] ?? statuses.default ?? 404;
    const status = typeof answer === 'number' ? answer : 200;
    return { ok: status === 200, status, arrayBuffer: async () => new ArrayBuffer(2), text: async () => (typeof answer === 'string' ? answer : '') };
  };
}

test('the image hook tries .png, .jpg and .webp in that order and says when none exists', async () => {
  const log = [];
  const hooks = createCatalogHooks(FOLDER, answers({ [`${SCAN_ID}.webp`]: 200 }, log));
  assert.equal((await hooks.image(SCAN_ID)).byteLength, 2);
  assert.deepEqual(log.map(entry => entry.url), [`${FOLDER}${SCAN_ID}.png`, `${FOLDER}${SCAN_ID}.jpg`, `${FOLDER}${SCAN_ID}.webp`]);
  await assert.rejects(createCatalogHooks(FOLDER, answers({})).image(SCAN_ID), /no \.png, \.jpg or \.webp file in the catalog folder/);
  await assert.rejects(createCatalogHooks(FOLDER, answers({ default: 500 })).image(SCAN_ID), /\.png in the catalog folder is not available \(HTTP 500\)/);
  assert.equal(createCatalogHooks(null, answers({})).image, undefined, 'images need the folder');
});

test('the name hook reads <id>.name and answers null for a file that is not there', async () => {
  const hooks = createCatalogHooks(FOLDER, answers({ [`${SCAN_ID}.name`]: 'My Rock.glb' }));
  assert.equal(await hooks.name(SCAN_ID), 'My Rock.glb');
  assert.equal(await createCatalogHooks(FOLDER, answers({})).name(SCAN_ID), null);
  await assert.rejects(createCatalogHooks(FOLDER, answers({ default: 500 })).name(SCAN_ID), /name of cdcdcdcdcdcd is not available \(HTTP 500\)/);
});

test('the store hook exists only with catalogStore, posts the raw bytes with the catalog headers and passes on the refusal text', async () => {
  assert.equal(createCatalogHooks(FOLDER, answers({})).store, undefined);
  assert.equal(createCatalogHooks(null, answers({}), { catalogStore: true }).store, undefined, 'a store needs the folder to post to');
  const log = [];
  const hooks = createCatalogHooks(FOLDER, answers({ default: 'stored' }, log), { catalogStore: true });
  const bytes = new Uint8Array([1, 2, 3]);
  await hooks.store({ kind: 'asset', id: SCAN_ID, name: 'Rock é.glb', extension: 'glb', bytes });
  assert.equal(log[0].url, String(FOLDER));
  assert.equal(log[0].init.method, 'POST');
  assert.equal(log[0].init.body, bytes);
  assert.deepEqual(log[0].init.headers, { 'x-catalog-kind': 'asset', 'x-catalog-id': SCAN_ID, 'x-catalog-extension': 'glb', 'x-catalog-name': 'Rock%20%C3%A9.glb' });
  const refusing = async () => ({ ok: false, status: 409, text: async () => 'Save the scene first.' });
  await assert.rejects(createCatalogHooks(FOLDER, refusing, { catalogStore: true }).store({ kind: 'image', id: SCAN_ID, name: 'a.png', extension: 'png', bytes }), error => error.message === 'Save the scene first.');
});
