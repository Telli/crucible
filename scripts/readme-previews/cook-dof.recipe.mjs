// Rack focus with the camera f-stop on the native Cook path tracer: focus travels from the red sphere in front to the gold and
// purple spheres behind it. Rendered into public/previews/feature-cook-dof.webp. Needs the Cook native addon.
const spheres = [
  ['near', [-0.45, 0.22, 2.8], 0.22, 'red'],
  ['mid-left', [0.55, 0.3, 0.9], 0.3, 'gold'],
  ['mid-right', [-0.5, 0.3, -0.7], 0.3, 'teal'],
  ['far', [0.6, 0.4, -2.6], 0.4, 'purple'],
];

export const recipe = {
  format: 'crucible.scene', schemaVersion: 1,
  geometries: [{ id: 'sphere', type: 'sphere', segments: 48, rings: 32 }, { id: 'slab', type: 'box', bevel: 0.02 }],
  materials: [
    { id: 'wood', color: [0.72, 0.52, 0.34], roughness: 0.55, pattern: { type: 'planks', size: 2.2, count: 6, seed: 8 } },
    { id: 'red', color: [0.8, 0.1, 0.08], roughness: 0.25 },
    { id: 'gold', color: [1, 0.77, 0.34], metallic: 1, roughness: 0.2 },
    { id: 'teal', color: [0.1, 0.55, 0.55], roughness: 0.35 },
    { id: 'purple', color: [0.45, 0.2, 0.65], roughness: 0.4 },
  ],
  nodes: [
    { id: 'table', geometry: 'slab', material: 'wood', translation: [0, -0.1, 0], scale: [8, 0.2, 10] },
    ...spheres.map(([id, translation, radius, material]) => ({ id, geometry: 'sphere', material, translation, scale: [radius * 2, radius * 2, radius * 2] })),
  ],
  camera: { eye: [0.2, 0.7, 4.2], target: [-0.45, 0.22, 2.8], fov: 32, fStop: 0.7 },
  environment: { setup: 'daylight', hdri: 'sky-clouds', world: true, environmentIntensity: 1, keyIntensity: 1.5, lightDirection: [-0.45, 0.8, 0.5] },
  motion: { duration: 4, loop: false, tracks: [
    { kind: 'camera', property: 'target', interpolation: 'SMOOTH', keyframes: [
      { time: 0, value: [-0.45, 0.22, 2.8] }, { time: 1.2, value: [-0.45, 0.22, 2.8] },
      { time: 2.4, value: [0.6, 0.4, -2.6] }, { time: 4, value: [0.6, 0.4, -2.6] } ] },
    { kind: 'camera', property: 'eye', interpolation: 'SMOOTH', keyframes: [
      { time: 0, value: [0.2, 0.7, 4.2] }, { time: 4, value: [-0.1, 0.75, 4.0] } ] } ] },
};

/** Render settings of the clip at a size, traced at `samples` paths per pixel. */
export function renderSettings({ width, height, fps, seconds, samples }) {
  return { kind: 'video', width, height, fps, duration: seconds, motion: { start: 0 },
    renderer: { type: 'pathTracer', backend: 'native', samples, bounces: 5, denoise: true, maxSeconds: 120, seed: 3 } };
}
