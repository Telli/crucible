// A coplanar street scene (flush road markings, kerb tops and paving sharing planes) panned slowly at a grazing angle,
// drawn without flicker because coplanar surfaces are resolved by default. Rendered into public/previews/feature-flicker-fixed.webp.
const stripes = Array.from({ length: 9 }, (_, index) => ({ id: `stripe-${index}`, geometry: 'slab', material: 'paint', translation: [0, 0.0, -12 + index * 3], scale: [0.18, 0.1, 1.6] }));
const crossings = Array.from({ length: 7 }, (_, index) => ({ id: `zebra-${index}`, geometry: 'slab', material: 'paint', translation: [-1.8 + index * 0.6, 0.0, 2.5], scale: [0.32, 0.1, 2.2] }));

export const recipe = {
  format: 'crucible.scene', schemaVersion: 1,
  geometries: [{ id: 'slab', type: 'box', bevel: 0 }],
  materials: [
    { id: 'asphalt', color: [0.12, 0.12, 0.13], roughness: 0.95, pattern: { type: 'concrete', size: 3, bump: 0.2, seed: 4 } },
    { id: 'paint', color: [0.92, 0.92, 0.88], roughness: 0.7 },
    { id: 'yellow', color: [0.9, 0.7, 0.1], roughness: 0.7 },
    { id: 'paving', color: [0.6, 0.55, 0.5], roughness: 0.9, pattern: { type: 'tiles', size: 1.5, count: 8, seed: 6 } },
    { id: 'kerb', color: [0.7, 0.68, 0.64], roughness: 0.85 },
  ],
  nodes: [
    { id: 'road', geometry: 'slab', material: 'asphalt', translation: [0, -0.05, 0], scale: [4.4, 0.1, 40] },
    { id: 'pavement-left', geometry: 'slab', material: 'paving', translation: [-4.2, -0.05, 0], scale: [4, 0.1, 40] },
    { id: 'pavement-right', geometry: 'slab', material: 'paving', translation: [4.2, -0.05, 0], scale: [4, 0.1, 40] },
    { id: 'kerb-left', geometry: 'slab', material: 'kerb', translation: [-2.3, -0.05, 0], scale: [0.2, 0.1, 40] },
    { id: 'kerb-right', geometry: 'slab', material: 'kerb', translation: [2.3, -0.05, 0], scale: [0.2, 0.1, 40] },
    { id: 'edge-line-left', geometry: 'slab', material: 'yellow', translation: [-2.05, 0, 0], scale: [0.08, 0.1, 40] },
    { id: 'edge-line-right', geometry: 'slab', material: 'yellow', translation: [2.05, 0, 0], scale: [0.08, 0.1, 40] },
    ...stripes,
    ...crossings,
  ],
  camera: { eye: [-3.2, 0.5, 11], target: [0, 0, 0], fov: 40 },
  environment: { setup: 'daylight', hdri: 'sky-clouds', world: true, environmentIntensity: 1, keyIntensity: 1.5, lightDirection: [-0.4, 0.55, -0.3] },
  effects: { exposure: 1, saturation: 1, contrast: 1.05 },
  motion: { duration: 5, loop: false, tracks: [
    { kind: 'camera', property: 'eye', interpolation: 'LINEAR', keyframes: [{ time: 0, value: [-3.2, 0.5, 11] }, { time: 5, value: [3.2, 0.55, 10] }] },
    { kind: 'camera', property: 'target', interpolation: 'LINEAR', keyframes: [{ time: 0, value: [-0.5, 0, 0] }, { time: 5, value: [0.5, 0, 0] }] } ] },
};

/** Render settings of the clip at a size: 50 frames over the 5 s pan. */
export function renderSettings({ width, height, fps, seconds }) {
  return { kind: 'video', width, height, fps, duration: seconds, motion: { start: 0 } };
}
