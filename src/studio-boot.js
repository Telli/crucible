// How the Studio page hands over from its loading state to the app. The page paints the theme background and the loading
// element from its HTML alone (bench/studio/index.html); this module takes the loading element away once Studio has drawn
// its first frame, opens the first-run setup over that frame, and turns the element into an error when the boot fails.
// Nothing here is imported by Studio itself, so no Studio bundle carries it.

export const STUDIO_LOADING_ELEMENT_ID = 'studio-loading';

const LOADING_MESSAGE_SELECTOR = '[data-loading-message]';
const PROGRESS_PROPERTY = '--progress';
const WIND_DOWN_LIMIT_MILLISECONDS = 700;

/**
 * Where the fill of the loading bar stands (0 to 1) once the page script reaches each step. The page starts at 0.12 from its
 * CSS alone, and the bar reaches 1 only when Studio is ready. The fill eases toward each value, so it creeps between steps.
 */
export const STUDIO_LOADING_MILESTONES = Object.freeze({
  modulesLoaded: 0.35,
  sceneModulesLoaded: 0.55,
  studioCreated: 0.75,
  sceneFileLoaded: 0.9,
});

const HIGHEST_VALUE_BEFORE_READY = 0.97;

/** Moves the fill forward to the value. It never moves back and never reaches full: only the wind-down does. */
export function reportStudioLoadingProgress(documentReference, value) {
  const style = documentReference.getElementById(STUDIO_LOADING_ELEMENT_ID)?.style;
  if (!style) {
    return;
  }
  const current = Number(style.getPropertyValue(PROGRESS_PROPERTY)) || 0;
  const next = Math.min(Math.max(value, current), HIGHEST_VALUE_BEFORE_READY);
  style.setProperty(PROGRESS_PROPERTY, String(next));
}

/** Fills the bar. */
function completeStudioLoadingProgress(documentReference) {
  documentReference.getElementById(STUDIO_LOADING_ELEMENT_ID)?.style?.setProperty(PROGRESS_PROPERTY, '1');
}

/**
 * Studio is ready: the bar fills, the stream thins and stops and the pot rights itself. All of it starts now; the returned
 * promise resolves when those animations end, at most a moment later.
 */
export function windDownStudioLoading(documentReference) {
  const loadingElement = documentReference.getElementById(STUDIO_LOADING_ELEMENT_ID);
  if (!loadingElement) {
    return Promise.resolve();
  }
  completeStudioLoadingProgress(documentReference);
  loadingElement.dataset.state = 'done';
  const finishingAnimations = (loadingElement.getAnimations?.({ subtree: true }) ?? []).filter(animation =>
    Number.isFinite(animation.effect.getComputedTiming().endTime),
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
