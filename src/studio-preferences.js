// How one person likes Studio set up. It is kept in the browser, never in the scene recipe: two people who open the
// same scene keep their own snap steps and their own panels.

export const STUDIO_PREFERENCES_KEY = 'crucible-studio-preferences';

export const STUDIO_GIZMO_PIXELS = Object.freeze({ small: 58, medium: 74, large: 92 });

export const STUDIO_PREFERENCE_CHOICES = Object.freeze({
  moveSnapStep: Object.freeze([0.05, 0.1, 0.25, 0.5, 1]),
  rotateSnapDegrees: Object.freeze([5, 10, 15, 30, 45, 90]),
  gizmoSize: Object.freeze(Object.keys(STUDIO_GIZMO_PIXELS)),
  startWorkspace: Object.freeze(['build', 'look', 'animate']),
});

export const STUDIO_PANEL_WIDTH = Object.freeze({ least: 240, most: 520, initial: 284 });

// The Scene card's share of the panel column, in percent. Zero leaves it as tall as its rows need.
export const STUDIO_SCENE_SHARE = Object.freeze({ least: 15, most: 75, automatic: 0 });

function panelWidthInRange(value) {
  return Math.round(Math.min(STUDIO_PANEL_WIDTH.most, Math.max(STUDIO_PANEL_WIDTH.least, value)));
}

function sceneShareInRange(value) {
  if (value <= STUDIO_SCENE_SHARE.automatic) {
    return STUDIO_SCENE_SHARE.automatic;
  }
  return Math.round(Math.min(STUDIO_SCENE_SHARE.most, Math.max(STUDIO_SCENE_SHARE.least, value)));
}

// Preferences that are a size: a saved number outside the range is pulled back into it.
const STUDIO_PREFERENCE_SIZES = Object.freeze({
  panelWidth: panelWidthInRange,
  sceneShare: sceneShareInRange,
});

export const STUDIO_PREFERENCE_DEFAULTS = Object.freeze({
  panelWidth: STUDIO_PANEL_WIDTH.initial,
  sceneShare: STUDIO_SCENE_SHARE.automatic,
  sceneMinimized: false,
  propertiesMinimized: false,
  moveSnapStep: 0.25,
  rotateSnapDegrees: 15,
  gizmoSize: 'medium',
  startWorkspace: 'build',
  gridVisible: true,
  readoutVisible: true,
  viewWidgetVisible: true,
  agentCursorVisible: true,
});

/** The preferences in `value` that are valid, over the defaults. Anything unknown or out of range is dropped. */
export function normalizeStudioPreferences(value) {
  const preferences = { ...STUDIO_PREFERENCE_DEFAULTS };
  if (!value || typeof value !== 'object') {
    return preferences;
  }
  for (const [name, fallback] of Object.entries(STUDIO_PREFERENCE_DEFAULTS)) {
    const candidate = value[name];
    const choices = STUDIO_PREFERENCE_CHOICES[name];
    const sizeInRange = STUDIO_PREFERENCE_SIZES[name];
    if (sizeInRange) {
      if (Number.isFinite(candidate)) {
        preferences[name] = sizeInRange(candidate);
      }
    } else if (choices) {
      if (choices.includes(candidate)) {
        preferences[name] = candidate;
      }
    } else if (typeof candidate === typeof fallback) {
      preferences[name] = candidate;
    }
  }
  return preferences;
}

/** Reads the saved preferences. A browser that blocks storage, or a damaged entry, gives the defaults. */
export function loadStudioPreferences(storage) {
  try {
    const saved = storage?.getItem(STUDIO_PREFERENCES_KEY);
    return normalizeStudioPreferences(saved ? JSON.parse(saved) : null);
  } catch {
    return normalizeStudioPreferences(null);
  }
}

/** Saves the preferences and reports whether the browser kept them. */
export function saveStudioPreferences(storage, preferences) {
  try {
    storage.setItem(STUDIO_PREFERENCES_KEY, JSON.stringify(normalizeStudioPreferences(preferences)));
    return true;
  } catch {
    return false;
  }
}
