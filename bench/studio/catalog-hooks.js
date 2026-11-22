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

async function fetchCatalogFile(folder, reference, extension, fetchFile) {
  if (!CATALOG_REFERENCE_PATTERN.test(reference)) {
    throw new Error(`Catalog reference ${reference.slice(0, 16)} is not an id or a bundled name.`);
  }
  return readFile(new URL(`${reference}.${extension}`, folder), `${reference.slice(0, 12)}.${extension} in the catalog folder`, fetchFile);
}

function missingFolderError(reference, extension) {
  return new Error(`${reference.slice(0, 12)}.${extension} is not a bundled file, and this page has no catalog folder. Open the page with ?catalog=<folder> that holds <id>.${extension}.`);
}

/**
 * Builds the catalog hooks of the Studio page. Bundled HDRIs and looks come from the files shipped in assets/looks, with or
 * without a folder; every other reference is read from `folder` (a URL ending in a slash), or refused when there is none.
 * `asset` has no bundled files, so it needs the folder.
 */
export function createCatalogHooks(folder, fetchFile = globalThis.fetch.bind(globalThis)) {
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
  }
  return hooks;
}
