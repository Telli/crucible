// Stroke icons for Studio, drawn on a 24 unit grid. Each value is one SVG path.
export const STUDIO_ICON_PATHS = Object.freeze({
  select: 'M5 3l14 7-6 2.5L10.5 19z',
  translate: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  rotate: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5',
  scale: 'M4 20V10M4 20h10M4 20L20 4M14 4h6v6',
  snap: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4',
  undo: 'M8 5L3 10l5 5M3 10h11a5.5 5.5 0 0 1 0 11h-3',
  redo: 'M16 5l5 5-5 5M21 10H10a5.5 5.5 0 0 0 0 11h3',
  add: 'M12 5v14M5 12h14',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z',
  eyeOff: 'M3 3l18 18M10.6 5.2A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.6 8.5 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  export: 'M12 15V3M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  keyframe: 'M12 3l7 9-7 9-7-9z',
  duplicate: 'M9 9h11v11H9zM5 15H4V4h11v1',
  remove: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  frame: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  panels: 'M3 5h18v14H3zM9 5v14M5.5 9h1M5.5 12h1',
  minimize: 'M6 15l6-6 6 6',
  expand: 'M6 9l6 6 6-6',
  chevron: 'M9 6l6 6-6 6',
  grid: 'M4 4h16v16H4zM9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16',
  link: 'M9.5 14.5l5-5M11 6.5l1.2-1.2a4.2 4.2 0 0 1 6 6L17 12.5M13 17.5l-1.2 1.2a4.2 4.2 0 0 1-6-6L7 11.5',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4.2-4.2',
  scene: 'M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
  help: 'M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  node: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  material: 'M12 3s6.5 6.4 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 9.4 12 3 12 3zM9 14.5a3 3 0 0 0 3 3',
  look: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5',
  camera: 'M3 7h12v10H3zM15 10.5l6-3v9l-6-3z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  pointLight: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  spotLight: 'M9 3h6l-1 5h-4zM10 8l-5 13h14L14 8M5 21c1.2-1 12.8-1 14 0',
  areaLight: 'M4 6h16v8H4zM8 14v3M16 14v3M7 20h10',
  sphere: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5',
  cylinder: 'M5 6.5C5 4.6 8.1 3 12 3s7 1.6 7 3.5v11c0 1.9-3.1 3.5-7 3.5s-7-1.6-7-3.5zM5 6.5C5 8.4 8.1 10 12 10s7-1.6 7-3.5',
  cone: 'M12 3L4.5 17.5c0 1.9 3.4 3.5 7.5 3.5s7.5-1.6 7.5-3.5zM4.5 17.5c0-1.9 3.4-3.5 7.5-3.5s7.5 1.6 7.5 3.5',
  torus: 'M12 6c5 0 9 2.7 9 6s-4 6-9 6-9-2.7-9-6 4-6 9-6zM8.5 11.5c0 1 1.6 1.8 3.5 1.8s3.5-.8 3.5-1.8',
  plane: 'M6.5 8h15l-4 8h-15z',
  group: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1zM8 3v5h7V3M8 21v-7h8v7',
  saveAs: 'M12 4v10M8 10l4 4 4-4M5 17v2h14v-2',
  code: 'M8 4c-2 0-3 1-3 3v2c0 1.5-.8 3-2 3 1.2 0 2 1.5 2 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5.8 3 2 3-1.2 0-2 1.5-2 3v2c0 2-1 3-3 3',
  image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 16l4.5-4.5 4 4 2.5-2.5 5 5M15.5 8.5h.01',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z',
  keyboard: 'M4 7h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM7 10.5h.01M11 10.5h.01M15 10.5h.01M8 14h8',
  agent: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  check: 'M5 12.5l4.5 4.5L19 7',
});

export const STUDIO_ICON_NAMES = Object.freeze(Object.keys(STUDIO_ICON_PATHS));

export function studioIconPath(name) {
  const path = STUDIO_ICON_PATHS[name];
  if (!path) {
    throw new RangeError(`Unknown Studio icon "${name}". Use one of: ${STUDIO_ICON_NAMES.join(', ')}.`);
  }
  return path;
}
