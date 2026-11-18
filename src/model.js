// The studio's sample model: a vintage brass microscope, nine separate parts, CC0 from Poly Haven
// (credit in THIRD-PARTY-NOTICES.md). public/sample-model.glb keeps its parts as separate glTF nodes, so each one
// can lift off in the exploded view. `assembleSampleModel` gives every part its layer, section and explode offset.

const SAMPLE_SCALE = 9;
const SAMPLE_PREFIX = /^vintage_microscope_(01_)?/;

// Offsets are world-space translations in model units after SAMPLE_SCALE (the microscope stands 3.6 tall and rests on y = 0).
// The exploded view stacks the parts up the stand's axis in assembly order, mirror and focus parts fanned to the sides,
// and never pushes a part below the floor.
const SAMPLE_PARTS = Object.freeze({
  base: { label: 'Base', layer: 'exterior', section: 'Base and mirror', offset: [0, 0, 0] },
  mirror_arm: { label: 'Mirror arm', layer: 'exterior', section: 'Base and mirror', offset: [-1.6, 0, 0] },
  mirror_base: { label: 'Mirror frame', layer: 'exterior', section: 'Base and mirror', offset: [-1.6, 1.3, 0.3] },
  mirror_base_1: { label: 'Mirror glass', layer: 'exterior', section: 'Base and mirror', offset: [-1.6, 2.1, 0.3] },
  rack_mount_support: { label: 'Limb and rack', layer: 'exterior', section: 'Limb', offset: [0, 1, 0] },
  condenser: { label: 'Condenser', layer: 'interior', section: 'Optics', offset: [1.6, 0.8, 0] },
  revolver: { label: 'Objective turret', layer: 'interior', section: 'Optics', offset: [0, 2.3, 0] },
  adjustment: { label: 'Focus knobs', layer: 'interior', section: 'Focus', offset: [1.6, 1.6, 0] },
  eye_piece: { label: 'Eyepiece tube', layer: 'interior', section: 'Optics', offset: [0, 3, 0] },
});

export const SAMPLE_PART_NAMES = Object.freeze(Object.values(SAMPLE_PARTS).map(entry => entry.label));

function scaledMatrix(matrix) {
  const scaled = new Float32Array(matrix);
  for (let index = 0; index < 15; index++) scaled[index] *= SAMPLE_SCALE;
  return scaled;
}

/**
 * Turns the parts parsed from public/sample-model.glb into explodable studio parts: a readable name, the matrix scaled
 * to studio size, and `assembly: { layer, section, offset }`. Throws for a part the table does not know.
 */
export function assembleSampleModel(parts) {
  if (!Array.isArray(parts) || parts.length === 0) throw new TypeError('assembleSampleModel expects the parts array that loadGltf or parseGltf returns for sample-model.glb.');
  return parts.map(part => {
    const key = String(part.name).replace(SAMPLE_PREFIX, '');
    const entry = Object.hasOwn(SAMPLE_PARTS, key) ? SAMPLE_PARTS[key] : null;
    if (!entry) throw new Error(`Sample model part "${part.name}" has no assembly entry. Pass the parts of public/sample-model.glb, or add the part to SAMPLE_PARTS in src/model.js.`);
    return { ...part, name: entry.label, matrix: scaledMatrix(part.matrix), assembly: { layer: entry.layer, section: entry.section, offset: [...entry.offset] } };
  });
}

/** Loads sample-model.glb from a URL, File or Blob and returns its explodable parts. */
export async function loadSampleModel(source, options = {}) {
  if (source === undefined) throw new TypeError("loadSampleModel needs the model's URL, File or Blob, for example loadSampleModel('/sample-model.glb').");
  const { loadGltf } = await import('./gltf.js');
  const asset = await loadGltf(source, options);
  return assembleSampleModel(asset.parts);
}
