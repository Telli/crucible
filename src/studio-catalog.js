import { agentAssetDecodeOptions } from './agent-asset-limits.js';
import { TEXTURE_MAP_FIELDS } from './texture-set-fields.js';
import {
  BUNDLED_CUBE_LOOK_NAMES,
  CATALOG_FILE_ID,
  BUNDLED_ENVIRONMENT_NAMES,
  catalogEnvironmentSource,
  catalogLook,
  catalogLookReferences,
  registerCatalogEnvironment,
  registerCatalogLook,
} from './look-catalog.js';

// A recipe an agent builds through MCP names catalog files by id: scans as node.asset.id, an HDRI as environment.hdri and
// a .cube look as environment.look. The MCP runtime reads them from its asset catalog. Studio runs in a browser and has
// no catalog, so the app that embeds it supplies the bytes through these hooks.
// A base colour image a material names as colorMap is read the same way, through `image`.
// `store` and `name` serve the Import command: `store` keeps a file the person brought from disk, `name` gives its file name back.
// The decoders load on first use, so a Studio that only opens procedural scenes never downloads them.
const HOOK_NAMES = Object.freeze(['asset', 'environment', 'look', 'image', 'store', 'name']);
/** What a person sees when a file from disk cannot be kept because the host passed no `store` hook. */
export const NO_STORE_MESSAGE = 'This Studio has no place to keep imported files. Open a scene.json instead, or ask the app that hosts Studio to pass catalog.store.';
const ANIMATED_PLACEMENT_FIELDS = Object.freeze(['clip', 'drive', 'crowd']);

function isRegistered(read, reference) {
  try {
    read(reference);
    return true;
  } catch {
    return false;
  }
}

// A malformed recipe reaches the normal validation, which says what to pass; nodes that are not a list name nothing to load.
function recipeNodes(recipe) {
  return Array.isArray(recipe?.nodes) ? recipe.nodes : [];
}

function describeReference(reference) {
  return reference.length > 16 ? reference.slice(0, 12) : reference;
}

function missingHookError(hookName, what, reference) {
  return new Error(`This scene uses ${what} ${describeReference(reference)}, and Studio was given no way to load it. Pass catalog: { ${hookName}: async reference => bytes } to createStudio; the reference is the id the recipe names.`);
}

function recipeMaterials(recipe) {
  return Array.isArray(recipe?.materials) ? recipe.materials : [];
}

// The ids of the catalog images the recipe's materials name, read without loading any module.
function recipeImageIds(recipe) {
  const ids = new Set();
  for (const material of recipeMaterials(recipe)) {
    for (const field of TEXTURE_MAP_FIELDS) {
      const id = material?.[field];
      if (typeof id === 'string' && CATALOG_FILE_ID.test(id.toLowerCase())) {
        ids.add(id.toLowerCase());
      }
    }
  }
  return [...ids];
}

function bytesOf(value, hookName, reference) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`catalog.${hookName} returned ${value === null ? 'null' : typeof value} for ${describeReference(reference)}. Return the file as an ArrayBuffer or a Uint8Array.`);
}

/**
 * Loads the catalog files of recipes for one Studio. `hooks` holds async functions, each taking the reference
 * a recipe names: `asset(id)` returns the bytes of a GLB, `environment(reference)` the bytes of a Radiance .hdr,
 * `image(id)` the bytes of a PNG, JPEG or WebP and `look(reference)` the text of a .cube file. Two more serve Import:
 * `store({ kind, id, name, bytes })` keeps a file (once it settles, the read hook of that kind returns the bytes) and
 * `name(id)` returns the file name kept for an id, or null. `pool` is the Map createAgentScene takes as its `assets` option; decoded
 * assets stay in it, so a file is fetched and decoded once however often the scene reloads.
 */
export function createStudioCatalog(hooks = {}) {
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw new TypeError(`catalog must be an object with any of the functions ${HOOK_NAMES.join(', ')}, such as { asset: async id => bytes }.`);
  }
  for (const [name, hook] of Object.entries(hooks)) {
    if (!HOOK_NAMES.includes(name)) {
      throw new RangeError(`catalog.${name} is not a hook Studio calls. Use ${HOOK_NAMES.join(', ')}.`);
    }
    if (hook !== undefined && typeof hook !== 'function') {
      throw new TypeError(`catalog.${name} must be a function that takes a reference and returns the file, not ${typeof hook}.`);
    }
  }
  const pool = new Map();
  const loadedAssetIds = new Set();
  const names = {};
  let queue = Promise.resolve();

  async function loadAsset(id, copies, assetCopyKey) {
    const missing = [];
    for (let copy = 0; copy < copies; copy += 1) {
      if (!pool.has(assetCopyKey(id, copy))) {
        missing.push(copy);
      }
    }
    if (missing.length === 0) {
      loadedAssetIds.add(id);
      return;
    }
    if (!hooks.asset) {
      throw missingHookError('asset', 'the catalog scan', id);
    }
    const bytes = bytesOf(await hooks.asset(id), 'asset', id);
    const { parseGltf } = await import('./gltf.js');
    for (const copy of missing) {
      // Each copy is decoded from its own bytes: a placement that plays a clip poses its copy.
      pool.set(assetCopyKey(id, copy), await parseGltf(bytes.slice().buffer, agentAssetDecodeOptions()));
    }
    loadedAssetIds.add(id);
  }

  async function loadEnvironment(reference) {
    if (isRegistered(catalogEnvironmentSource, reference)) {
      return;
    }
    if (!hooks.environment) {
      throw missingHookError('environment', BUNDLED_ENVIRONMENT_NAMES.includes(reference) ? 'the bundled HDRI' : 'the catalog HDRI', reference);
    }
    const bytes = bytesOf(await hooks.environment(reference), 'environment', reference);
    const { parseRadianceHdr } = await import('./hdri.js');
    registerCatalogEnvironment(reference, parseRadianceHdr(bytes));
  }

  async function loadLook(reference) {
    if (isRegistered(catalogLook, reference)) {
      return;
    }
    if (!hooks.look) {
      throw missingHookError('look', BUNDLED_CUBE_LOOK_NAMES.includes(reference) ? 'the bundled look' : 'the catalog look', reference);
    }
    const text = await hooks.look(reference);
    if (typeof text !== 'string') {
      throw new TypeError(`catalog.look returned ${text === null ? 'null' : typeof text} for ${describeReference(reference)}. Return the text of the .cube file.`);
    }
    const { parseCube } = await import('./view-transform.js');
    registerCatalogLook(reference, parseCube(text));
  }

  async function loadImage(id) {
    if (pool.has(id)) {
      return;
    }
    if (!hooks.image) {
      throw missingHookError('image', 'the catalog image', id);
    }
    const bytes = bytesOf(await hooks.image(id), 'image', id);
    const { decodeCatalogImage } = await import('./decode-catalog-image.js');
    pool.set(id, await decodeCatalogImage(id, bytes));
  }

  // A host may remember the file name of an id across sessions; a name it does not know leaves the short id.
  async function recallName(id) {
    if (!hooks.name || names[id] !== undefined || !CATALOG_FILE_ID.test(id)) {
      return;
    }
    try {
      const name = await hooks.name(id);
      if (typeof name === 'string' && name !== '') {
        names[id] = name;
      }
    } catch {
      // A name is a label only; the file itself still loads.
    }
  }

  async function prepareNow(recipe) {
    const { environments, looks } = catalogLookReferences(recipe);
    if (recipeNodes(recipe).some(node => node?.asset)) {
      const { assetCopyKey, recipeAssetNeeds } = await import('./agent-scene-assets.js');
      for (const { id, copies } of recipeAssetNeeds(recipe)) {
        await loadAsset(id, copies, assetCopyKey);
      }
    }
    for (const id of recipeImageIds(recipe)) {
      await loadImage(id);
    }
    for (const reference of environments) {
      await loadEnvironment(reference);
      await recallName(reference);
    }
    for (const reference of looks) {
      await loadLook(reference);
    }
  }

  // Decodes a file the person brought without registering it, so a file that does not decode leaves the pool as it was.
  // The returned function registers the decoded file; call it once the host has stored the bytes.
  async function stageFile(kind, id, bytes) {
    if (kind === 'asset') {
      const [{ parseGltf }, { assetCopyKey }] = await Promise.all([import('./gltf.js'), import('./agent-scene-assets.js')]);
      if (loadedAssetIds.has(id) && pool.has(assetCopyKey(id, 0))) {
        return () => {};
      }
      const asset = await parseGltf(bytes.slice().buffer, agentAssetDecodeOptions());
      return () => {
        pool.set(assetCopyKey(id, 0), asset);
        loadedAssetIds.add(id);
      };
    }
    if (kind === 'environment') {
      const { parseRadianceHdr } = await import('./hdri.js');
      const decoded = parseRadianceHdr(bytes);
      return () => registerCatalogEnvironment(id, decoded);
    }
    const { decodeCatalogImage } = await import('./decode-catalog-image.js');
    const decoded = await decodeCatalogImage(id, bytes);
    return () => pool.set(id, decoded);
  }

  return Object.freeze({
    pool,
    /** The file names Studio knows for catalog ids: { [id]: name }. */
    names,
    /** Whether the host gave a `store` hook, so a file from disk can be kept. */
    canStore: typeof hooks.store === 'function',
    stageFile,
    /** Keeps a file with the host. A rejection of the hook passes on unchanged, since the host words it for the person. */
    async storeFile(entry) {
      await hooks.store(entry);
      names[entry.id] = entry.name;
    },
    /** Whether the recipe names a catalog file that `prepare` has yet to load. A placement that plays a clip always counts, since it takes a copy of its own. */
    needsLoading(recipe) {
      const { environments, looks } = catalogLookReferences(recipe);
      const placements = recipeNodes(recipe).map(node => node?.asset).filter(Boolean);
      return placements.some(placement => !loadedAssetIds.has(String(placement.id).toLowerCase()) || ANIMATED_PLACEMENT_FIELDS.some(field => placement[field]))
        || recipeImageIds(recipe).some(id => !pool.has(id))
        || environments.some(reference => !isRegistered(catalogEnvironmentSource, reference))
        || looks.some(reference => !isRegistered(catalogLook, reference));
    },
    /** Fetches and decodes every catalog file the recipe names and is not loaded yet. Calls run one after another, so two loads of one scene fetch each file once. */
    prepare(recipe) {
      const result = queue.then(() => prepareNow(recipe));
      queue = result.catch(() => {});
      return result;
    },
    dispose() {
      for (const asset of pool.values()) {
        asset.dispose?.();
      }
      pool.clear();
      loadedAssetIds.clear();
      for (const id of Object.keys(names)) {
        delete names[id];
      }
    },
  });
}
