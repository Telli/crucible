// A web pack holds plain data and ImageData pixels only (scene-pack-format.js). A texture that is anything else (an image
// element, an ImageBitmap) makes the format throw a message that names a path inside the encoder. This turns that message
// into a refusal that names the part and what to do, and leaves every other error as it came.
const TEXTURE_PATH = /^scene\.parts\[(\d+)\]\.material\.(\w+)[.:]\S* got an? (\w+);/;

/** Encodes the scene with `encodePack`; a texture the pack cannot carry throws a named refusal, any other error passes through. */
export function encodePackOrRefuse(encodePack, scene) {
  try {
    return encodePack(scene);
  } catch (error) {
    throw packRefusalFor(error, scene.parts ?? []);
  }
}

function packRefusalFor(error, parts) {
  const message = String(error?.message ?? '');
  const match = TEXTURE_PATH.exec(message);
  if (!match || !message.includes('expected plain data')) {
    return error;
  }
  const partIndex = Number(match[1]);
  const partName = parts[partIndex]?.name ? `"${parts[partIndex].name}"` : `number ${partIndex + 1}`;
  return new Error(`Web pack refused: part ${partName} carries a ${match[3]} on its ${match[2]} texture, and a pack holds plain data and ImageData pixels only. Remove the placed catalog assets that bring such textures and pack again, or export the scene as a GLB model instead.`);
}
