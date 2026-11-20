// The decisions of the home page story that need no browser: which beat of the text is shown at a scroll progress, and whether a
// visitor gets the live scene or the five still stages.

// Scroll progress, from 0 to 1 through the story, at which each beat takes over the text column.
export const BEAT_STARTS = Object.freeze([0, 0.1, 0.36, 0.6, 0.8]);
const SLOW_CONNECTION_TYPES = Object.freeze(['slow-2g', '2g', '3g']);
const LARGEST_SMALL_MEMORY_GIGABYTES = 4;
// A page opened by a capture, measurement or scout script always shows the live scene, whatever the connection.
const FORCED_LIVE_PARAMETERS = Object.freeze(['capture', 'measure', 'scout']);

export function beatIndexAt(progress) {
  let beatIndex = 0;
  for (let index = 0; index < BEAT_STARTS.length; index++) {
    if (progress >= BEAT_STARTS[index]) beatIndex = index;
  }
  return beatIndex;
}

// A visitor on a light connection (data saver, a 3G link or slower) or with 4 GB of memory or less gets the stills.
export function prefersStillStory({ connection = {}, deviceMemory, search = '' } = {}) {
  const parameters = new URLSearchParams(search);
  if (FORCED_LIVE_PARAMETERS.some((name) => parameters.has(name))) return false;
  const slowConnection = connection.saveData === true || SLOW_CONNECTION_TYPES.includes(connection.effectiveType);
  const smallMemory = deviceMemory !== undefined && deviceMemory <= LARGEST_SMALL_MEMORY_GIGABYTES;
  return slowConnection || smallMemory;
}
