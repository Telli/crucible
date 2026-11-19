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

export const STUDIO_PREFERENCE_DEFAULTS = Object.freeze({
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
    if (choices) {
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
