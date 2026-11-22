// A web pack holds plain data only (scene-pack-format.js). A placed catalog scan brings decoded textures (ImageData) that
// the pack cannot carry yet, and the format's own message names a path inside the encoder. This turns that message into a
// refusal that names the part and what to do, and leaves every other error as it came.
const TEXTURE_PATH = /^scene\.parts\[(\d+)\]\.material\.(\w+)[.:]/;

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
  return new Error(`Web pack refused: part ${partName} carries an imported image on its ${match[2]} texture, and a pack holds plain data only. Remove the placed catalog assets that bring textures and pack again, or export the scene as a GLB model instead.`);
}
