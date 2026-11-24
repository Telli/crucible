// How the Studio page hands over from its loading state to the app. The page paints the theme background and the loading
// element from its HTML alone (bench/studio/index.html); this module takes the loading element away once Studio has drawn
// its first frame, opens the first-run setup over that frame, and turns the element into an error when the boot fails.
// Nothing here is imported by Studio itself, so no Studio bundle carries it.

export const STUDIO_LOADING_ELEMENT_ID = 'studio-loading';

const LOADING_MESSAGE_SELECTOR = '[data-loading-message]';
const PROGRESS_PROPERTY = '--progress';
const FILL_SELECTOR = '.fill';
const WIND_DOWN_LIMIT_MILLISECONDS = 1200;
const FILL_CREEP_MILLISECONDS = 30000;
const FILL_CREEP_EASING = 'cubic-bezier(0.1, 0.5, 0.2, 1)';
const FILL_CREEP_SHARE = 0.85;
const FILL_COMPLETE_MILLISECONDS = 350;
const FILL_COMPLETE_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Where the fill of the loading bar stands (0 to 1) once the page script reaches each step. The page's CSS starts a slow creep
 * toward 0.3 at first paint. At each step the fill eases, over thirty seconds with a strong ease-out, toward a point
 * 85 percent of the way to the next step, so it keeps moving while the load waits and never arrives early. It reaches 1 only
 * when Studio is ready.
 */
export const STUDIO_LOADING_MILESTONES = Object.freeze({
  modulesLoaded: 0.35,
  sceneModulesLoaded: 0.55,
  studioCreated: 0.75,
  sceneFileLoaded: 0.9,
});

const HIGHEST_VALUE_BEFORE_READY = 0.97;

/** The point the fill creeps toward while the load waits for the step after the one at `value`: short of that step, never full. */
export function creepTargetAfter(value) {
  const nextStep = Object.values(STUDIO_LOADING_MILESTONES).find(milestone => milestone > value) ?? 1;
  return Math.min(value + (nextStep - value) * FILL_CREEP_SHARE, HIGHEST_VALUE_BEFORE_READY);
}

function currentFillScale(fillElement) {
  const transform = fillElement.ownerDocument.defaultView.getComputedStyle(fillElement).transform;
  const scale = /^matrix[(]([-\d.e]+)/.exec(transform);
  return scale ? Number(scale[1]) : 0;
}

const runningFillAnimations = new WeakMap();

/** Eases the fill from where it stands now to the target. A new run replaces the one before it and never goes backward. */
function animateFill(loadingElement, target, milliseconds, easing) {
  const fillElement = loadingElement.querySelector(FILL_SELECTOR);
  if (!fillElement?.animate) {
    return;
  }
  const start = currentFillScale(fillElement);
  const animation = fillElement.animate(
    [{ transform: `scaleX(${start})` }, { transform: `scaleX(${Math.max(target, start)})` }],
    { duration: milliseconds, easing, fill: 'forwards' },
  );
  runningFillAnimations.get(fillElement)?.cancel();
  runningFillAnimations.set(fillElement, animation);
}

/**
 * Moves the fill forward to the step. It never moves back and never reaches full: only the wind-down does. The value goes on
 * the loading element as --progress (the resting size of the fill), and a long ease starts toward the next step.
 */
export function reportStudioLoadingProgress(documentReference, value) {
  const loadingElement = documentReference.getElementById(STUDIO_LOADING_ELEMENT_ID);
  if (!loadingElement?.style) {
    return;
  }
  const current = Number(loadingElement.style.getPropertyValue(PROGRESS_PROPERTY)) || 0;
  const reached = Math.min(Math.max(value, current), HIGHEST_VALUE_BEFORE_READY);
  loadingElement.style.setProperty(PROGRESS_PROPERTY, String(reached));
  animateFill(loadingElement, creepTargetAfter(reached), FILL_CREEP_MILLISECONDS, FILL_CREEP_EASING);
}

/** Fills the bar. */
function completeStudioLoadingProgress(loadingElement) {
  loadingElement.style?.setProperty(PROGRESS_PROPERTY, '1');
  animateFill(loadingElement, 1, FILL_COMPLETE_MILLISECONDS, FILL_COMPLETE_EASING);
}

/**
 * Studio is ready: the bar fills (350 ms), the stream thins and stops and the pot rights itself (250 ms), the picture holds,
 * then the loading state fades out (180 ms, 780 ms in all; 630 ms with reduced motion). All of it starts now; the returned
 * promise resolves when those animations end.
 */
export function windDownStudioLoading(documentReference) {
  const loadingElement = documentReference.getElementById(STUDIO_LOADING_ELEMENT_ID);
  if (!loadingElement) {
    return Promise.resolve();
  }
  completeStudioLoadingProgress(loadingElement);
  loadingElement.dataset.state = 'done';
  const finishingAnimations = (loadingElement.getAnimations?.({ subtree: true }) ?? []).filter(
    animation => animation.effect.getComputedTiming().endTime <= WIND_DOWN_LIMIT_MILLISECONDS,
  );
  const limit = new Promise(resolve => setTimeout(resolve, WIND_DOWN_LIMIT_MILLISECONDS));
  return Promise.race([Promise.allSettled(finishingAnimations.map(animation => animation.finished)), limit]);
}

/** Resolves after the browser has painted one frame of whatever is on the page now. */
export function waitForNextPaint(requestFrame) {
  return new Promise(resolve => {
    requestFrame(() => requestFrame(() => resolve()));
  });
}

/** Removes the loading element and the boot theme the page's own script set on the root element. */
export function removeStudioLoading(documentReference) {
  documentReference.getElementById(STUDIO_LOADING_ELEMENT_ID)?.remove();
  documentReference.documentElement.removeAttribute('data-theme');
}

/** Shows the failure in place of the progress bar. The message is text, never markup. */
export function showStudioLoadingFailure(documentReference, error) {
  const loadingElement = documentReference.getElementById(STUDIO_LOADING_ELEMENT_ID);
  if (!loadingElement) {
    return;
  }
  loadingElement.dataset.state = 'error';
  const messageElement = loadingElement.querySelector(LOADING_MESSAGE_SELECTOR);
  if (messageElement) {
    messageElement.textContent = error?.message ?? String(error);
  }
}

/**
 * Waits for Studio to be ready and for its first frame to be on screen, then winds the pour down, takes the loading state away and, on a first
 * visit, opens the setup over the drawn app. `?setup=off` never opens it.
 */
export async function revealStudio({ studio, setupParameter, documentReference, requestFrame }) {
  await studio.ready;
  const windDown = windDownStudioLoading(documentReference);
  await waitForNextPaint(requestFrame);
  await windDown;
  removeStudioLoading(documentReference);
  if (setupParameter !== 'off' && !studio.setupDone) {
    studio.openSetup();
  }
}
