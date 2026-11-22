// The lighting of a packed scene, built on the page: the sky image the pack carries, or else the named lighting setup.
// Each branch loads its own code only when the pack needs it, so a scene without a sky image never loads the other path.

/** The environment map that lights a decoded pack. */
export async function createPackEnvironmentMap({ environment, environmentMap }) {
  if (environmentMap) {
    const { createEnvironmentMap } = await import('./environment.js');
    return createEnvironmentMap(environmentMap);
  }
  const { createLightingSetupMap, setupMapShowsBackground } = await import('./lighting-setups.js');
  return createLightingSetupMap(environment.setup, {
    intensity: environment.environmentIntensity,
    rotation: environment.environmentRotation,
    showBackground: setupMapShowsBackground(environment),
  });
}
