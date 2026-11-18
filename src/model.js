// The studio's sample model: a modern binocular laboratory microscope, fifteen separate parts, CC BY 4.0
// (credit in THIRD-PARTY-NOTICES.md). public/sample-model.glb keeps its parts as separate glTF nodes, so each one
// can lift off in the exploded view. `assembleSampleModel` gives every part its layer, section and explode offset.

const SAMPLE_SCALE = 8;

// Offsets are world-space translations in model units after SAMPLE_SCALE (the microscope stands 3.7 tall and rests on y = 0).
// The exploded view keeps the base on the floor and lifts each part just clear of its mount, with a gap of about 0.2: the optical path
// stacks above the base (stage, head, prism housing, eyepiece mounts, tubes and lenses), the illuminator, focus knobs and rack post stand
// 1.9 to the left, the condenser and its lens stand in front, and the objectives, nosepiece and stage clips stand 1.55 to the right.
const SAMPLE_PARTS = Object.freeze({
  base_stand: { label: 'Base and arm', layer: 'exterior', section: 'Stand', offset: [0, 0, 0] },
  rack_post: { label: 'Rack post', layer: 'exterior', section: 'Stand', offset: [-1.9, 1.66, 0] },
  illuminator: { label: 'Illuminator', layer: 'interior', section: 'Illumination', offset: [-1.9, 0, 0] },
  condenser: { label: 'Condenser', layer: 'interior', section: 'Illumination', offset: [0, 0.35, 1.7] },
  condenser_lens: { label: 'Condenser lens', layer: 'interior', section: 'Illumination', offset: [0, 0.95, 1.7] },
  focus_knobs: { label: 'Focus knobs', layer: 'exterior', section: 'Focus', offset: [-1.9, 0.68, 0] },
  stage: { label: 'Stage', layer: 'exterior', section: 'Stage', offset: [0, 1.4, 0] },
  stage_clips: { label: 'Stage clips', layer: 'exterior', section: 'Stage', offset: [1.55, 1.4, 0] },
  objectives: { label: 'Objectives', layer: 'interior', section: 'Optics', offset: [1.55, -0.87, 0] },
  nosepiece: { label: 'Nosepiece', layer: 'interior', section: 'Optics', offset: [1.55, -0.49, 0] },
  head: { label: 'Head', layer: 'exterior', section: 'Head', offset: [0, 0.67, 0] },
  prism_housing: { label: 'Prism housing', layer: 'exterior', section: 'Head', offset: [0, 1.23, 0] },
  eyepiece_mounts: { label: 'Eyepiece mounts', layer: 'interior', section: 'Optics', offset: [0, 1.75, 0] },
  eyepiece_tubes: { label: 'Eyepiece tubes', layer: 'exterior', section: 'Head', offset: [0, 2.27, 0] },
  eyepiece_lenses: { label: 'Eyepiece lenses', layer: 'interior', section: 'Optics', offset: [0, 2.66, 0] },
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
