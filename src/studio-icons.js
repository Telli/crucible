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
  panels: 'M3 5h18v14H3zM9 5v14M15 5v14',
  help: 'M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  node: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  material: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 8.5a5.5 5.5 0 0 1 4-2',
  look: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5',
  camera: 'M3 7h12v10H3zM15 10.5l6-3v9l-6-3z',
  agent: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
});

export const STUDIO_ICON_NAMES = Object.freeze(Object.keys(STUDIO_ICON_PATHS));

export function studioIconPath(name) {
  const path = STUDIO_ICON_PATHS[name];
  if (!path) {
    throw new RangeError(`Unknown Studio icon "${name}". Use one of: ${STUDIO_ICON_NAMES.join(', ')}.`);
  }
  return path;
}
