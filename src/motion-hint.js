/** The hint a preview carries when it shows frame 0 of a scene whose motion tracks, particles, physics or cloth only move on the motion clock. */
export const MOTION_NOT_SET_HINT = {
  kind: 'motion-not-set',
  message: 'This scene has motion tracks, particles, physics or cloth, and no motionTime was given, so the picture is frame 0.',
  fix: 'Pass motionTime (seconds from 0) to see the scene at that moment, such as motionTime 1.',
};

/** Whether a track has keyframes at two or more different times, so it changes something when the motion clock runs. */
function trackSpansTime(track) {
  const times = Array.isArray(track?.keyframes) ? track.keyframes.map(keyframe => keyframe?.time) : [];
  return new Set(times).size > 1;
}

/** Whether a recipe has anything that moves on the motion clock: motion tracks with keyframes over time, particles, physics or cloth. */
export function recipeMoves(recipe) {
  const hasMovingTrack = Array.isArray(recipe?.motion?.tracks) && recipe.motion.tracks.some(trackSpansTime);
  return Boolean(hasMovingTrack || recipe?.physics || recipe?.cloth || recipe?.particles);
}
