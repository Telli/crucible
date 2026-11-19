import '../../src/brand-fonts.css';
import '../../src/site-tokens.css';
import { loadAllAgentSceneModules } from '../../src/agent-scene.js';
import { createStudio } from '../../src/studio.js';

async function mountStudioPage() {
  const root = document.querySelector('#studio-root');
  if (!root) {
    return;
  }
  await loadAllAgentSceneModules();
  const studio = createStudio(root);
  studio.selectNode('cube');
  window.__studioPage = studio;
}

mountStudioPage();
