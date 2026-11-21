import '../../src/brand-fonts.css';
import '../../src/site-tokens.css';
import { loadAllAgentSceneModules } from '../../src/agent-scene.js';
import { createStudio } from '../../src/studio.js';

// ?catalog=<folder> names a same-origin folder that holds a scene's catalog files by the id the recipe uses:
// <id>.glb, <id>.hdr and <id>.cube. ?scene=<file> opens a scene.json from the same origin.
const CATALOG_REFERENCE_PATTERN = /^[0-9a-z][0-9a-z-]{0,63}$/;

const SCENE_FILE_PATTERN = /^\/[\w\-./]+\.json$/;

// The address bar chooses these files, so the page reads them only from its own origin, by path alone (no query, no
// credentials sent), and a link to this page cannot make it call anything else.
function sameOriginUrl(value) {
  const requested = new URL(value, window.location.href);
  if (requested.origin !== window.location.origin) {
    throw new Error(`This page only reads files from ${window.location.origin}, not ${requested.origin}.`);
  }
  return new URL(requested.pathname, window.location.origin);
}

function sceneFileUrl(value) {
  const url = sameOriginUrl(value);
  if (!SCENE_FILE_PATTERN.test(url.pathname) || url.pathname.includes('..')) {
    throw new Error('?scene= takes the path of a .json scene file on this origin.');
  }
  return url;
}

async function fetchCatalogFile(folder, reference, extension) {
  if (!CATALOG_REFERENCE_PATTERN.test(reference)) {
    throw new Error(`Catalog reference ${reference.slice(0, 16)} is not an id or a bundled name.`);
  }
  const response = await fetch(new URL(`${reference}.${extension}`, folder), { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`${reference.slice(0, 12)}.${extension} is not in the catalog folder (HTTP ${response.status}).`);
  }
  return response;
}

function catalogHooksFor(folderParameter) {
  if (!folderParameter) {
    return {};
  }
  const folder = sameOriginUrl(folderParameter.endsWith('/') ? folderParameter : `${folderParameter}/`);
  return {
    asset: async id => (await fetchCatalogFile(folder, id, 'glb')).arrayBuffer(),
    environment: async reference => (await fetchCatalogFile(folder, reference, 'hdr')).arrayBuffer(),
    look: async reference => (await fetchCatalogFile(folder, reference, 'cube')).text(),
  };
}

async function mountStudioPage() {
  const root = document.querySelector('#studio-root');
  if (!root) {
    return;
  }
  const parameters = new URLSearchParams(window.location.search);
  await loadAllAgentSceneModules();
  const studio = createStudio(root, { catalog: catalogHooksFor(parameters.get('catalog')) });
  studio.selectNode('cube');
  window.__studioPage = studio;
  const sceneParameter = parameters.get('scene');
  if (sceneParameter) {
    const sceneUrl = sceneFileUrl(sceneParameter);
    const response = await fetch(sceneUrl, { credentials: 'omit' });
    if (!response.ok) {
      throw new Error(`${sceneUrl.pathname} did not load (HTTP ${response.status}).`);
    }
    await studio.loadExternalTextFile(await response.text(), { fileName: sceneUrl.pathname.split('/').pop(), recordUndo: false, agent: false });
  }
}

mountStudioPage().catch(error => {
  window.__studioPageError = error.message;
  console.error(error);
});
