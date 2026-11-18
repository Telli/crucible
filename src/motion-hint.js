/** The hint a preview carries when it shows frame 0 of a scene whose motion tracks, particles, physics or cloth only move on the motion clock. */
export const MOTION_NOT_SET_HINT = {
  kind: 'motion-not-set',
  message: 'This scene has motion tracks, particles, physics or cloth, and no motionTime was given, so the picture is frame 0.',
  fix: 'Pass motionTime (seconds from 0) to see the scene at that moment, such as motionTime 1.',
};

/** Whether a recipe has motion tracks or simulated content that moves only when a motion time is sampled. */
export function recipePlaysSimulation(recipe) {
  const hasTracks = Array.isArray(recipe?.motion?.tracks) && recipe.motion.tracks.length > 0;
  return Boolean(hasTracks || recipe?.physics || recipe?.cloth || recipe?.particles);
}
