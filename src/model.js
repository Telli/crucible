// The studio's sample model: a modern binocular laboratory microscope, fifteen separate parts, CC BY 4.0
// (credit in THIRD-PARTY-NOTICES.md). public/sample-model.glb keeps its parts as separate glTF nodes, so each one
// can lift off in the exploded view. `assembleSampleModel` gives every part its layer, section and explode offset.

const SAMPLE_SCALE = 8;

// Offsets are world-space translations in model units after SAMPLE_SCALE (the microscope stands 3.7 tall and rests on y = 0).
// The exploded view keeps the base on the floor and fans the rest into three columns that never overlap: the optical
// path rises above the base, the lower assembly (illumination, focus, condenser) stands to the left and the
// objectives with the stage clips and eyepiece lenses to the right.
const SAMPLE_PARTS = Object.freeze({
  base_stand: { label: 'Base and arm', layer: 'exterior', section: 'Stand', offset: [0, 0, 0] },
  rack_post: { label: 'Rack post', layer: 'exterior', section: 'Stand', offset: [-2.3, 1.69, 0] },
  illuminator: { label: 'Illuminator', layer: 'interior', section: 'Illumination', offset: [-2.3, -0.22, 0] },
  condenser: { label: 'Condenser', layer: 'interior', section: 'Illumination', offset: [-2.3, 2.3, 0] },
  condenser_lens: { label: 'Condenser lens', layer: 'interior', section: 'Illumination', offset: [-2.3, 2.99, 0] },
  focus_knobs: { label: 'Focus knobs', layer: 'exterior', section: 'Focus', offset: [-2.3, 0.59, 0] },
  stage: { label: 'Stage', layer: 'exterior', section: 'Stage', offset: [0, 1.65, 0] },
  stage_clips: { label: 'Stage clips', layer: 'exterior', section: 'Stage', offset: [2.3, 0.54, 0] },
  objectives: { label: 'Objectives', layer: 'interior', section: 'Optics', offset: [2.3, 0.71, 0] },
  nosepiece: { label: 'Nosepiece', layer: 'interior', section: 'Optics', offset: [2.3, 1.16, 0] },
  head: { label: 'Head', layer: 'exterior', section: 'Head', offset: [0, 1.03, 0] },
  prism_housing: { label: 'Prism housing', layer: 'exterior', section: 'Head', offset: [0, 1.7, 0] },
  eyepiece_mounts: { label: 'Eyepiece mounts', layer: 'interior', section: 'Optics', offset: [0, 2.34, 0] },
  eyepiece_tubes: { label: 'Eyepiece tubes', layer: 'exterior', section: 'Head', offset: [0, 2.98, 0] },
  eyepiece_lenses: { label: 'Eyepiece lenses', layer: 'interior', section: 'Optics', offset: [2.3, 2.73, 0] },
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
    const key = String(part.name);
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
