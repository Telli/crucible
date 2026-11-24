// The wind a batch feels. The frame sets one strength for the scene; a material with `windScale` (0 to 1) feels that share of it.
// Ground-cover grass uses it: the blade tip moves by metres, so short blades need a smaller strength than trees and tall grass (#3290).

/** Wind strength for a batch whose material is `material`, under a scene strength of `sceneWind`. */
export function batchWindStrength(sceneWind, material) {
  return sceneWind * (material.windScale ?? 1);
}
