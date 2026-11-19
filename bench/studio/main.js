import '../../src/brand-fonts.css';
import '../../src/site-tokens.css';
import { loadAllAgentSceneModules } from '../../src/agent-scene.js';
import { createStudio } from '../../src/studio.js';

// ?catalog=<folder> names a same-origin folder that holds a scene's catalog files by the id the recipe uses:
// <id>.glb, <id>.hdr and <id>.cube. ?scene=<file> opens a scene.json from the same origin.
const CATALOG_REFERENCE_PATTERN = /^[0-9a-z][0-9a-z-]{0,63}$/;

function sameOriginUrl(value) {
  const url = new URL(value, window.location.href);
  if (url.origin !== window.location.origin) {
    throw new Error(`This page only reads files from ${window.location.origin}, not ${url.origin}.`);
  }
  return url;
}

async function fetchCatalogFile(folder, reference, extension) {
  if (!CATALOG_REFERENCE_PATTERN.test(reference)) {
    throw new Error(`Catalog reference ${reference.slice(0, 16)} is not an id or a bundled name.`);
  }
  const response = await fetch(new URL(`${reference}.${extension}`, folder));
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
    const sceneUrl = sameOriginUrl(sceneParameter);
    const response = await fetch(sceneUrl);
    await studio.loadExternalTextFile(await response.text(), { fileName: sceneUrl.pathname.split('/').pop(), recordUndo: false, agent: false });
  }
}

mountStudioPage().catch(error => {
  window.__studioPageError = error.message;
  console.error(error);
});
