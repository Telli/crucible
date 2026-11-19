import { loopedClipTime } from './hero-lab/loop/clip-time.js';

// Plays the first animation clip of a scene file's GLB, the way the showcase page does, so a headless frame shows the pose the
// page shows instead of the bind pose. The clip loops: the time inside it is the frame time modulo the clip length.
//
// The renderer holds the parts of the scene as it was built: water reflection and dense levels of detail swap some parts for
// copies, one per original part and in the same order. A copy shares the original's matrix and skin arrays, so posing the asset
// moves it too, but `renderer.updateParts` only knows the copies. `sceneParts` is the list the asset's parts were joined into
// (its order is the one `rendererParts` follows), `rendererParts` is the list the renderer was built from and `posedParts` are
// the parts the asset itself poses (its own parts, before the staged files were joined in).
export function createFileSceneClipPlayer({ asset, posedParts, sceneParts, rendererParts }) {
  const clip = asset.animations?.[0];
  if (!clip) return null;
  if (sceneParts.length !== rendererParts.length) {
    throw new Error(`The renderer parts (${rendererParts.length}) must match the scene parts (${sceneParts.length}) one for one.`);
  }
  const posed = new Set(posedParts);
  const partsToUpdate = rendererParts.filter((part, index) => posed.has(sceneParts[index]));
  return {
    clip,
    // Poses the asset's parts without a renderer: the native path tracer packs the parts themselves (skinned vertices included),
    // so it needs the pose and no updateParts call.
    applyAt(seconds) {
      asset.applyAnimation(loopedClipTime(seconds, clip.duration), 0);
    },
    poseAt(renderer, seconds) {
      this.applyAt(seconds);
      renderer.updateParts(partsToUpdate, { shadows: true });
    },
  };
}
