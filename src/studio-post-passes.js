// Draws a recipe's postPasses in the Studio viewport and names every pass the viewport cannot run. The recipe is never
// touched: a pass that is not drawn here stays in the scene, is saved unchanged and still draws in the preview and exports.
import { agentSceneModule, agentSceneModuleLoaded } from './agent-scene-modules.js';

const COMPILE_FAILURE_HEADER = /^Post pass "([^"]+)" failed to compile as GLSL ES 3\.00\./;
const READS_SCENE_DEPTH = /\b(?:sceneDepth|depthAt|worldPointAt|worldNormalAt)\b/;

function scenePasses(scene) {
  return scene.postPasses ?? [];
}

export function sceneHasPostPasses(scene) {
  return scenePasses(scene).length > 0;
}

function rendererCanTakePasses(renderer) {
  return agentSceneModuleLoaded('userPass') && typeof renderer.resolveFrame === 'function' && Array.isArray(renderer.postStages);
}

/** Adds the user pass stage to a renderer that can take it; a renderer that cannot is left alone. */
export function installPostPasses(renderer) {
  if (!renderer.userPasses && rendererCanTakePasses(renderer)) {
    agentSceneModule('userPass').installUserPasses(renderer);
  }
  return renderer;
}

// The useful reason is the first line after the header: the header only says which pass and which language.
function firstReasonLine(message) {
  const [, ...reasonLines] = String(message).split('\n');
  return reasonLines.map(line => line.trim()).find(line => line !== '') ?? 'it did not compile';
}

function whyRendererCannotRun(renderer) {
  if (!agentSceneModuleLoaded('userPass')) {
    return 'the post pass code is not loaded';
  }
  return 'this renderer cannot draw post passes';
}

/**
 * Decides, per renderer, which passes of the scene are drawn and which are named as not drawn, and applies the drawn ones
 * to the renderer once per change. `userPasses.set` compares a JSON copy on every call, so a frame that changed nothing
 * must not reach it.
 */
export function createPostPassPlanner() {
  // Keyed by fragment text: a fixed pass is tried again, an unchanged broken one is not.
  const refusedByFragment = new Map();
  const resolvedByRenderer = new WeakMap();

  function resolve(renderer, scene) {
    const canTake = Boolean(renderer.userPasses);
    const cached = resolvedByRenderer.get(renderer);
    const unchanged = cached
      && cached.scene === scene
      && cached.revision === scene.revision
      && cached.refusedCount === refusedByFragment.size
      && cached.canTake === canTake;
    if (unchanged) {
      return cached;
    }
    const passes = scenePasses(scene);
    const drawn = [];
    const notDrawn = [];
    for (const pass of passes) {
      const refusal = refusedByFragment.get(pass.fragment);
      if (refusal) {
        notDrawn.push({ name: pass.name, reason: refusal });
      } else if (!canTake) {
        notDrawn.push({ name: pass.name, reason: whyRendererCannotRun(renderer) });
      } else if (!renderer.depth && READS_SCENE_DEPTH.test(pass.fragment)) {
        notDrawn.push({ name: pass.name, reason: 'it reads the scene depth and this renderer has none' });
      } else {
        drawn.push(pass);
      }
    }
    const resolved = {
      scene,
      revision: scene.revision,
      refusedCount: refusedByFragment.size,
      canTake,
      drawn,
      notDrawn,
      needsObjectIds: drawn.some(pass => pass.objects),
    };
    resolvedByRenderer.set(renderer, resolved);
    if (canTake) {
      renderer.userPasses.set(drawn);
      renderer.userPasses.setAntialias(scene.postPassesAntialias);
    }
    return resolved;
  }

  /**
   * Remembers a pass that failed to compile when the error names a pass of this scene, and says whether it did. Any other
   * error, and a pass already refused, answer false so the caller lets the error through.
   */
  function refuseFailedPass(error, scene) {
    const match = COMPILE_FAILURE_HEADER.exec(error?.message ?? '');
    const pass = match && scenePasses(scene).find(candidate => candidate.name === match[1]);
    if (!pass || refusedByFragment.has(pass.fragment)) {
      return false;
    }
    refusedByFragment.set(pass.fragment, firstReasonLine(error.message));
    return true;
  }

  return { resolve, refuseFailedPass };
}

/**
 * The notice that stays over the viewport while any pass is not drawn, one line per pass. It leads with a warning icon and
 * sits on the plain island surface, apart from the paused notice, which never shows for this.
 */
export function createPostPassNotice({ documentReference, createIcon }) {
  const lines = documentReference.createElement('div');
  const element = documentReference.createElement('div');
  element.className = 'crucible-studio-island crucible-studio-pass-notice';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.hidden = true;
  element.append(createIcon('warning'), lines);

  let shownText = '';

  function show(notDrawn) {
    const text = notDrawn.map(({ name, reason }) => `Post pass "${name}" is not drawn here: ${reason}`).join('\n');
    if (text === shownText) {
      return;
    }
    shownText = text;
    lines.replaceChildren(...notDrawn.map(({ name, reason }) => {
      const line = documentReference.createElement('p');
      line.textContent = `Post pass "${name}" is not drawn here: ${reason}`;
      return line;
    }));
    element.hidden = notDrawn.length === 0;
  }

  return { element, show };
}
