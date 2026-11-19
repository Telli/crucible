// The removeTracks field of a set-motion operation: drop the motion tracks that match selectors, keep everything else.
// A leaf module, so scripts/mcp-server.mjs and the scene backends can share it without pulling in the motion compiler.
import { invalidField } from './field-error.js';
import { SELECTOR_FIELDS, selectorMatches, motionAfterRemoval } from './motion-track-selector.js';

export const MAXIMUM_TRACK_SELECTORS = 64;

function describeTrack(track) {
  return [track.kind, track.id, track.property].filter(part => part !== undefined).join('.');
}

function describeSelector(selector) {
  return JSON.stringify(selector);
}

function assertSelectors(selectors, path) {
  if (!Array.isArray(selectors) || selectors.length < 1 || selectors.length > MAXIMUM_TRACK_SELECTORS) {
    throw invalidField(path, selectors, `a list of 1 to ${MAXIMUM_TRACK_SELECTORS} track selectors, such as [{ "kind": "camera" }]`, TypeError);
  }
  selectors.forEach((selector, index) => {
    const isPlain = selector !== null && typeof selector === 'object' && !Array.isArray(selector);
    const fields = isPlain ? Object.keys(selector) : [];
    const valid = isPlain
      && fields.length > 0
      && fields.every(field => SELECTOR_FIELDS.includes(field) && typeof selector[field] === 'string' && selector[field].length > 0);
    if (!valid) {
      throw invalidField(`${path}[${index}]`, selector, 'an object with some of kind, id and property as strings, such as { "kind": "node", "id": "cube", "property": "translation" }', TypeError);
    }
  });
}

/** The motion a set-motion operation with removeTracks leaves: the tracks its selectors match are gone; null when no motion content is left. */
export function removeMotionTracks(operation, motion, path = 'operation') {
  const keys = Object.keys(operation);
  if (keys.some(key => key !== 'type' && key !== 'removeTracks')) {
    throw invalidField(`${path}.removeTracks`, 'removeTracks next to other fields', 'one of motion (replace all motion, or null) or removeTracks (drop some tracks), not both');
  }
  assertSelectors(operation.removeTracks, `${path}.removeTracks`);
  return motionWithoutTracks(motion, operation.removeTracks, `${path}.removeTracks`);
}

/** The motion without the tracks the selectors match; null when no motion content is left. */
export function motionWithoutTracks(motion, selectors, path = 'operation.removeTracks') {
  const tracks = Array.isArray(motion?.tracks) ? motion.tracks : [];
  const listed = tracks.length > 0 ? tracks.map(describeTrack).join(', ') : 'none (the scene has no motion tracks)';
  const unmatched = selectors.filter(selector => !tracks.some(track => selectorMatches(selector, track)));
  if (unmatched.length > 0) {
    throw invalidField(path, unmatched.map(describeSelector).join(', '), `selectors that each match a track the scene has; its tracks are: ${listed}`);
  }
  return motionAfterRemoval(motion, selectors).motion;
}
