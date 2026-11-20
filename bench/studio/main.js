import '../../src/brand-fonts.css';
import '../../src/site-tokens.css';
import { loadAllAgentSceneModules } from '../../src/agent-scene.js';
import { createStudio } from '../../src/studio.js';
import { createCatalogHooks } from './catalog-hooks.js';

// ?catalog=<folder> names a same-origin folder that holds a scene's catalog files by the id the recipe uses:
// <id>.glb, <id>.hdr and <id>.cube. ?scene=<file> opens a scene.json from the same origin.
// The bundled HDRIs and looks load from assets/looks with no folder.
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

function catalogHooksFor(folderParameter) {
  const folder = folderParameter ? sameOriginUrl(folderParameter.endsWith('/') ? folderParameter : `${folderParameter}/`) : null;
  return createCatalogHooks(folder);
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
