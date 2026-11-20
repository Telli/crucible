// What a removeTracks selector matches and what motion a removal leaves. Small and always loaded, so the apply report
// can count removed tracks itself; the validating code lives in motion-track-removal.js and loads on demand.

export const SELECTOR_FIELDS = ['kind', 'id', 'property'];
const NO_MOTION_KEYS = new Set(['duration', 'loop', 'tracks']);

export function selectorMatches(selector, track) {
  return SELECTOR_FIELDS.every(field => selector[field] === undefined || selector[field] === track[field]);
}

/** The motion without the tracks the selectors match, and how many went; motion is null when no motion content is left. */
export function motionAfterRemoval(motion, selectors) {
  const tracks = Array.isArray(motion?.tracks) ? motion.tracks : [];
  const kept = tracks.filter(track => !selectors.some(selector => selectorMatches(selector, track)));
  const remaining = { ...motion, tracks: kept };
  const hasOtherMotion = Object.keys(remaining).some(key => !NO_MOTION_KEYS.has(key) && remaining[key] !== undefined);
  return { motion: kept.length === 0 && !hasOtherMotion ? null : remaining, removed: tracks.length - kept.length };
}
