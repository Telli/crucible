import { BUNDLED_CUBE_LOOK_NAMES, BUNDLED_ENVIRONMENT_NAMES } from '../../src/look-catalog.js';

// Literal paths, one per file, so the bundler finds each file and copies it into the build.
export const BUNDLED_FILE_URLS = Object.freeze({
  'sky-clouds.hdr': new URL('../../assets/looks/sky-clouds.hdr', import.meta.url),
  'studio-softbox.hdr': new URL('../../assets/looks/studio-softbox.hdr', import.meta.url),
  'teal-orange.cube': new URL('../../assets/looks/teal-orange.cube', import.meta.url),
  'noir.cube': new URL('../../assets/looks/noir.cube', import.meta.url),
});

const CATALOG_REFERENCE_PATTERN = /^[0-9a-z][0-9a-z-]{0,63}$/;

function bundledUrl(reference, bundledNames, extension) {
  return bundledNames.includes(reference) ? BUNDLED_FILE_URLS[`${reference}.${extension}`] : null;
}

async function readFile(url, label, fetchFile) {
  const response = await fetchFile(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`${label} is not available (HTTP ${response.status}).`);
  }
  return response;
}

function assertCatalogReference(reference) {
  if (!CATALOG_REFERENCE_PATTERN.test(reference)) {
    throw new Error(`Catalog reference ${reference.slice(0, 16)} is not an id or a bundled name.`);
  }
  return reference;
}

async function fetchCatalogFile(folder, reference, extension, fetchFile) {
  assertCatalogReference(reference);
  return readFile(new URL(`${reference}.${extension}`, folder), `${reference.slice(0, 12)}.${extension} in the catalog folder`, fetchFile);
}

function missingFolderError(reference, extension) {
  return new Error(`${reference.slice(0, 12)}.${extension} is not a bundled file, and this page has no catalog folder. Open the page with ?catalog=<folder> that holds <id>.${extension}.`);
}

const IMAGE_EXTENSIONS = Object.freeze(['png', 'jpg', 'webp']);
const NOT_FOUND = 404;

// The image hook tries each extension in turn, since the folder holds the file under the one it was saved with.
async function readCatalogImage(folder, id, fetchFile) {
  for (const extension of IMAGE_EXTENSIONS) {
    const response = await fetchFile(new URL(`${id}.${extension}`, folder), { credentials: 'omit' });
    if (response.ok) {
      return response.arrayBuffer();
    }
    if (response.status !== NOT_FOUND) {
      throw new Error(`${id.slice(0, 12)}.${extension} in the catalog folder is not available (HTTP ${response.status}).`);
    }
  }
  throw new Error(`${id.slice(0, 12)} has no .png, .jpg or .webp file in the catalog folder.`);
}

async function readCatalogName(folder, id, fetchFile) {
  const response = await fetchFile(new URL(`${id}.name`, folder), { credentials: 'omit' });
  if (response.status === NOT_FOUND) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`The name of ${id.slice(0, 12)} is not available (HTTP ${response.status}).`);
  }
  return response.text();
}

// The desktop shell keeps what the page posts under <id>.<extension> in the folder, and says why when it cannot.
async function postCatalogFile(folder, { kind, id, name, extension, bytes }, fetchFile) {
  const response = await fetchFile(folder, {
    method: 'POST',
    body: bytes,
    credentials: 'omit',
    headers: {
      'x-catalog-kind': kind,
      'x-catalog-id': id,
      'x-catalog-extension': extension,
      'x-catalog-name': encodeURIComponent(name),
    },
  });
  if (!response.ok) {
    throw new Error((await response.text()) || `The catalog folder refused ${id.slice(0, 12)}.${extension} (HTTP ${response.status}).`);
  }
}

/**
 * Builds the catalog hooks of the Studio page. Bundled HDRIs and looks come from the files shipped in assets/looks, with or
 * without a folder; every other reference is read from `folder` (a URL ending in a slash), or refused when there is none.
 * `asset`, `image` and `name` have no bundled files, so they need the folder. `store` also needs `catalogStore`, which the
 * page turns on with ?catalogStore=1 when the shell it runs in accepts a POST to the folder.
 */
export function createCatalogHooks(folder, fetchFile = globalThis.fetch.bind(globalThis), { catalogStore = false } = {}) {
  async function bundledOrFolder(reference, bundledNames, extension) {
    const url = bundledUrl(reference, bundledNames, extension);
    if (url) {
      return readFile(url, `The bundled file ${reference}.${extension}`, fetchFile);
    }
    if (!folder) {
      throw missingFolderError(reference, extension);
    }
    return fetchCatalogFile(folder, reference, extension, fetchFile);
  }
  const hooks = {
    environment: async reference => (await bundledOrFolder(reference, BUNDLED_ENVIRONMENT_NAMES, 'hdr')).arrayBuffer(),
    look: async reference => (await bundledOrFolder(reference, BUNDLED_CUBE_LOOK_NAMES, 'cube')).text(),
  };
  if (folder) {
    hooks.asset = async id => (await fetchCatalogFile(folder, id, 'glb', fetchFile)).arrayBuffer();
    hooks.image = async id => readCatalogImage(folder, assertCatalogReference(id), fetchFile);
    hooks.name = async id => readCatalogName(folder, assertCatalogReference(id), fetchFile);
    if (catalogStore) {
      hooks.store = async entry => postCatalogFile(folder, entry, fetchFile);
    }
  }
  return hooks;
}
