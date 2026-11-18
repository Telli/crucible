import { loadAllAgentSceneModules } from './agent-scene.js';
import { createStudio } from './studio.js';

function defaultStudioRecipe() {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [
      { id: 'floor', type: 'box', bevel: 0 },
      { id: 'plinth', type: 'cone', radiusTop: 1.2, radiusBottom: 1.35, segments: 48 },
      { id: 'ring', type: 'torus', tubeRadius: 0.14, segments: 64, sides: 28 },
      { id: 'core', type: 'sphere', segments: 48, rings: 24 },
      { id: 'beacon', type: 'box', bevel: 0.05 },
    ],
    materials: [
      { id: 'slate', tag: 'surface', color: [0.07, 0.08, 0.1], roughness: 0.85, metallic: 0.05 },
      { id: 'stone', tag: 'surface', color: [0.26, 0.27, 0.29], roughness: 0.48, metallic: 0.02 },
      { id: 'brass', tag: 'surface', color: [0.72, 0.42, 0.07], roughness: 0.24, metallic: 0.92 },
      { id: 'teal-glow', tag: 'surface', color: [0.04, 0.48, 0.42], roughness: 0.28, metallic: 0.1, emission: 1.35, emissiveColor: [0.08, 0.72, 0.62] },
      { id: 'coral', tag: 'surface', color: [0.64, 0.08, 0.06], roughness: 0.34, metallic: 0.08 },
    ],
    nodes: [
      { id: 'stage-floor', label: 'Stage floor', geometry: 'floor', material: 'slate', translation: [0, -0.1, 0], scale: [12, 0.2, 12] },
      { id: 'plinth-base', label: 'Plinth', geometry: 'plinth', material: 'stone', translation: [0, 0.275, 0], scale: [1, 0.55, 1] },
      { id: 'gyro-ring', label: 'Gyro ring', geometry: 'ring', material: 'brass', translation: [0, 1.45, 0], rotation: [0.28, 0.34, 0, 0.9], scale: [0.95, 0.95, 0.95] },
      { id: 'energy-core', label: 'Energy core', geometry: 'core', material: 'teal-glow', translation: [0, 1.45, 0], scale: [0.48, 0.48, 0.48] },
      { id: 'side-beacon', label: 'Side beacon', geometry: 'beacon', material: 'coral', translation: [1.9, 0.45, -0.8], scale: [0.42, 0.9, 0.42] },
    ],
    camera: {
      eye: [4.2, 2.9, 4.9],
      target: [0, 1.15, 0],
      up: [0, 1, 0],
      fov: 42,
      near: 0.1,
      far: 120,
    },
    environment: {
      setup: 'studio',
      lightDirection: [-3.2, 5.2, 3.8],
      keyIntensity: 1.65,
      viewTransform: 'agx',
    },
    effects: {
      exposure: 0.96,
      bloom: { strength: 0.12, threshold: 1.05, radius: 0.9 },
    },
    motion: {
      duration: 4,
      loop: true,
      tracks: [
        {
          kind: 'node',
          id: 'gyro-ring',
          property: 'rotation',
          keyframes: [
            { time: 0, value: [0.28, 0.34, 0, 0.9] },
            { time: 2, value: [-0.28, 0.72, 0.2, 0.6] },
            { time: 4, value: [0.28, 0.34, 0, 0.9] },
          ],
        },
      ],
    },
    timeline: {
      shots: [
        {
          name: 'Hero',
          duration: 2,
          motionStart: 0,
          camera: { eye: [4.2, 2.9, 4.9], target: [0, 1.15, 0], up: [0, 1, 0], fov: 42 },
        },
        {
          name: 'Detail',
          duration: 2,
          motionStart: 0,
          camera: { eye: [1.9, 1.85, 2.35], target: [0, 1.45, 0], up: [0, 1, 0], fov: 36 },
        },
        {
          name: 'Top',
          duration: 2,
          motionStart: 0,
          camera: { eye: [0.05, 6.8, 0.25], target: [0, 0.6, 0], up: [0, 1, 0], fov: 45 },
        },
      ],
    },
  };
}

async function mountStudioPage() {
  const root = document.querySelector('#studio-root');
  if (!root) {
    return;
  }
  await loadAllAgentSceneModules();
  const studio = createStudio(root, { recipe: defaultStudioRecipe() });
  studio.selectNode('gyro-ring');
  window.__studioPage = studio;
}

mountStudioPage();
