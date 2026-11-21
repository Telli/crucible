// The three worlds of the loop, in playing order. Each has a flight (keys at 0..1 along the route, played over `seconds`),
// a scrim strength for the headline on the left, and the credits the page must show while it plays.
// Eye and target are in the world's own units (metres). Flights were scouted against the real scenes, see FLIGHT NOTES in each entry.
const NVIDIA_SIMREADY = { label: 'NVIDIA SimReady assets', licence: 'CC BY 4.0', href: 'https://docs.omniverse.nvidia.com/usd/latest/usd_content_samples/simready_assets.html' };

export const SCENES = [
  {
    id: 'port',
    name: 'Container port',
    description: '/showcase/port/scene.json',
    poster: '/hero-lab/poster-b-port.webp',
    seconds: 10,
    scrim: 0.72,
    near: 2,
    far: 60000,
    keys: [
      { at: 0, eye: [-20, 130, -300], target: [0, -10, 10], fov: 38 },
      { at: 0.35, eye: [-150, 60, -150], target: [0, 20, 20], fov: 40 },
      { at: 0.68, eye: [30, 34, -170], target: [20, 26, 10], fov: 42 },
      { at: 1, eye: [205, 24, -62], target: [0, 22, 0], fov: 45 },
    ],
    credits: [
      { label: 'Gantry Crane by alanUscanga', licence: 'CC BY 4.0', href: 'https://sketchfab.com/3d-models/76119b46c26f436ba78f4b53c98fc935' },
      { label: 'KR Scania R_Draft by radzig541', licence: 'CC BY', href: 'https://sketchfab.com/3d-models/c46e8ee246aa4863a2cf602cddf1bfeb' },
    ],
  },
  {
    id: 'datacenter',
    name: 'Data center',
    description: '/showcase/datacenter/scene.json',
    seconds: 10,
    scrim: 0.7,
    near: 0.5,
    far: 400,
    keys: [
      { at: 0, eye: [17, 26, 38], target: [4, 0.4, 0.5], fov: 30 },
      { at: 1, eye: [-4, 9, 14], target: [4, 1.5, 0], fov: 34 },
    ],
    credits: [
      { label: 'Substation Transformer by HalfCarrot', licence: 'CC BY', href: 'https://sketchfab.com/3d-models/3a033547daaa4ec8b7b0426a3ecac987' },
      { label: 'Compact 07 by Daniel Zhabotinsky', licence: 'CC BY 4.0', href: 'https://sketchfab.com/3d-models/compact-07-low-poly-model-25c6874d173a4f6ca63e150bbd505686' },
    ],
  },
  {
    id: 'darkstore',
    name: 'Dark store',
    description: '/showcase/darkstore/scene.json',
    seconds: 10,
    scrim: 0.62,
    near: 0.25,
    far: 300,
    keys: [
      { at: 0, eye: [0, 2.2, 21], target: [0, 2, -8], fov: 54 },
      { at: 0.28, eye: [-1.5, 3.2, 6], target: [1.5, 2, -12], fov: 52 },
      { at: 0.55, eye: [2.5, 6.2, 1.5], target: [-4, 1.5, -10], fov: 48 },
      { at: 0.8, eye: [8, 9, 3], target: [-3, 1, -12], fov: 44 },
      { at: 1, eye: [14, 12, 15], target: [-3, 0.5, -10], fov: 42 },
    ],
    credits: [NVIDIA_SIMREADY],
  },
];

