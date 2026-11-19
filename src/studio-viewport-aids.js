// Working aids for the Studio viewport: a ground grid with the world axes, a view widget that shows where the camera
// looks and snaps to the main views, and a readout of the camera and the selection. None of them is part of the scene.

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
// The renderer draws its own floor at 0.019 m, so the grid has to sit above that to show. Up close it stays within 3 mm
// of it, or the lines would cut a visible notch into the base of anything that rests on the ground; from far away the
// gap grows with the view, or the depth buffer could no longer tell the lines from the floor.
const GRID_FLOOR_HEIGHT = 0.019;
const GRID_MINIMUM_LIFT = 0.0022;
const GRID_LIFT_PIXELS = 0.25;
// Three sets of lines, each ten times coarser than the one before, with up to 30 lines either side of the middle.
const GRID_LEVELS = 3;
const GRID_REACH = 30;
const GRID_LINE_PIXELS = 1.2;
const GRID_COARSE_PIXELS = 1.6;
const GRID_AXIS_PIXELS = 2.4;
// About this many fine steps fit the height of the view before the grid moves to the next step.
const GRID_STEPS_IN_VIEW = 4;
// A set of lines stops where its lines would come closer than this on screen: past that they only make noise.
const GRID_CLOSEST_PIXELS = 5;
const GRID_PARKED_HEIGHT = -1e5;
const DEFAULT_GRID_VIEW = Object.freeze({ visibleHeight: 5, viewportHeight: 720, target: [0, 0.5, 0], eye: [4.2, 2.9, 4.9] });
const VIEWPORT_NEAR_SHARE = 100;
const VIEWPORT_FAR_REACH = 80;
const VIEWPORT_FLOOR_REACH = 40000;
const WIDGET_SIZE = 76;
const WIDGET_REACH = 26;

export const GRID_PART_PREFIX = 'studio-grid-';
export const AXIS_COLORS = Object.freeze({ x: '#ee7a6c', y: '#5fc48a', z: '#5ea8ff' });
const AXIS_VECTORS = Object.freeze({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
// The view each end of an axis snaps to. Looking up from below has no preset, so the low end of Y only shows.
const AXIS_VIEWS = Object.freeze({ x: ['right', 'left'], y: ['top', null], z: ['front', 'back'] });

/** How much of the world the camera sees from top to bottom at its target, in metres. The grid sizes itself from it. */
export function cameraVisibleHeight(camera) {
  if (camera.projection === 'orthographic') {
    return camera.orthoScale ?? 4;
  }
  const distance = Math.hypot(camera.eye[0] - camera.target[0], camera.eye[1] - camera.target[1], camera.eye[2] - camera.target[2]);
  if (Number.isFinite(camera.focalLength)) {
    return (distance * 24) / camera.focalLength;
  }
  return 2 * distance * Math.tan(((camera.fov ?? 45) * Math.PI) / 360);
}

/**
 * Where every grid line goes for a view: `{ step, lines }`, each line `{ id, translation, scale }`. The step is 1 m
 * up close and grows tenfold as the camera pulls back (10 m, 100 m), the way Blender's floor does. Three sets of lines
 * are drawn at once, at 1, 10 and 100 steps; each set reaches as far from the camera as its lines stay apart on
 * screen, so the floor is covered far out without the far lines crowding into noise. Lines are about a pixel wide
 * where they pass the camera; the finest set thins out as the next step takes over, so the change has no jump. The
 * grid follows the camera target in whole steps.
 */
export function gridLayout({ visibleHeight, viewportHeight, target, eye } = DEFAULT_GRID_VIEW) {
  const level = Math.log10(Math.max(1e-3, visibleHeight) / GRID_STEPS_IN_VIEW);
  const step = 10 ** Math.floor(level);
  const blend = level - Math.floor(level);
  const pixel = visibleHeight / Math.max(1, viewportHeight);
  const lift = Math.max(GRID_MINIMUM_LIFT, pixel * GRID_LIFT_PIXELS);
  const height = GRID_FLOOR_HEIGHT + lift;
  const thickness = lift * 0.9;
  const viewDistance = Math.max(1e-3, Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]));
  const eyeHeight = Math.max(Math.abs(eye[1] - GRID_FLOOR_HEIGHT), viewDistance * 0.05);
  const focalPixels = viewDistance / pixel;
  const lines = [];
  const place = (id, alongX, center, offset, length, width, raise) => {
    lines.push({
      id: `${GRID_PART_PREFIX}${id}`,
      translation: alongX ? [center[0], height + raise, offset] : [offset, height + raise, center[1]],
      scale: alongX ? [length, thickness, width] : [width, thickness, length],
    });
  };
  const park = id => {
    lines.push({ id: `${GRID_PART_PREFIX}${id}`, translation: [0, GRID_PARKED_HEIGHT, 0], scale: [1e-3, 1e-3, 1e-3] });
  };
  const levelPixels = [GRID_LINE_PIXELS * (1 - blend), GRID_LINE_PIXELS + (GRID_COARSE_PIXELS - GRID_LINE_PIXELS) * (1 - blend), GRID_COARSE_PIXELS];
  let farthest = 0;
  let outerCenter = [0, 0];
  for (let levelIndex = 0; levelIndex < GRID_LEVELS; levelIndex += 1) {
    const spacing = step * 10 ** levelIndex;
    const snap = spacing * 10;
    const center = [Math.round(target[0] / snap) * snap, Math.round(target[2] / snap) * snap];
    const readable = Math.sqrt((spacing * eyeHeight * focalPixels) / GRID_CLOSEST_PIXELS);
    const count = Math.max(2, Math.min(GRID_REACH, Math.floor(readable / spacing)));
    const reach = count * spacing;
    farthest = reach;
    outerCenter = center;
    for (let index = -GRID_REACH; index <= GRID_REACH; index += 1) {
      for (const alongX of [true, false]) {
        const id = `level${levelIndex}-${alongX ? 'x' : 'z'}${index}`;
        if (Math.abs(index) > count) {
          park(id);
          continue;
        }
        const offset = (alongX ? center[1] : center[0]) + index * spacing;
        // A line that passes far from the camera is widened to stay about a pixel wide where it comes closest.
        const passing = Math.hypot(eyeHeight, offset - (alongX ? eye[2] : eye[0]));
        const width = pixel * levelPixels[levelIndex] * Math.max(1, passing / viewDistance);
        place(id, alongX, center, offset, reach * 2, width, thickness * 0.2 * levelIndex);
      }
    }
  }
  place('axis-x', true, outerCenter, 0, farthest * 2, pixel * GRID_AXIS_PIXELS, thickness * 0.6);
  place('axis-z', false, outerCenter, 0, farthest * 2, pixel * GRID_AXIS_PIXELS, thickness * 0.6);
  return { step, lines };
}

/**
 * The near and far planes the viewport draws with. They follow how far the camera has pulled back: a scene camera that
 * stops at 120 m would cut the floor, the grid and every object away once the view is further out than that, and
 * leave a frame of plain background.
 */
export function viewportClipPlanes(camera) {
  const distance = Math.hypot(camera.eye[0] - camera.target[0], camera.eye[1] - camera.target[1], camera.eye[2] - camera.target[2]);
  return {
    near: Math.max(camera.near ?? 0.1, distance / VIEWPORT_NEAR_SHARE),
    far: Math.max(camera.far ?? 100, distance * VIEWPORT_FAR_REACH),
  };
}

/** The floor of the viewport as a renderer part. It reaches the horizon at any zoom the camera allows, so its edge never shows. */
export function viewportFloorPart(floorHeight) {
  const reach = VIEWPORT_FLOOR_REACH;
  return {
    name: 'Studio floor',
    geometry: {
      positions: new Float32Array([-reach, floorHeight, -reach, -reach, floorHeight, reach, reach, floorHeight, reach, reach, floorHeight, -reach]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    },
    matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    material: { color: [0.04, 0.05, 0.06], metallic: 0, roughness: 1, emission: 0, tag: 'floor' },
  };
}

/** Moves the grid parts to a layout. Each part keeps its geometry and material; only its matrix is rewritten in place. */
export function placeGridParts(partsByName, layout) {
  for (const line of layout.lines) {
    const matrix = partsByName.get(line.id)?.matrix;
    if (!matrix) {
      continue;
    }
    matrix.fill(0);
    matrix[0] = line.scale[0];
    matrix[5] = line.scale[1];
    matrix[10] = line.scale[2];
    matrix[12] = line.translation[0];
    matrix[13] = line.translation[1];
    matrix[14] = line.translation[2];
    matrix[15] = 1;
  }
}

/** The grid step as the readout shows it, such as "10 cm", "1 m" or "100 m". */
export function describeGridStep(step) {
  if (step >= 1000) {
    return `${Math.round(step / 1000)} km`;
  }
  if (step >= 1) {
    return `${Math.round(step)} m`;
  }
  return step >= 0.01 ? `${Math.round(step * 100)} cm` : `${Math.round(step * 1000)} mm`;
}

/** The recipe of the ground grid as the starting view sees it, with the X axis in red and the Z axis in blue. */
export function buildGridRecipe() {
  const material = id => (id.endsWith('axis-x') ? 'studio-grid-x' : id.endsWith('axis-z') ? 'studio-grid-z' : 'studio-grid-minor');
  const nodes = gridLayout().lines.map(line => ({
    id: line.id,
    geometry: 'studio-grid-line',
    material: material(line.id),
    translation: line.translation,
    scale: line.scale,
    castShadow: false,
    receiveShadow: false,
  }));
  const glow = (id, color, emission) => ({ id, tag: 'surface', color: [0, 0, 0], roughness: 1, metallic: 0, emission, emissiveColor: color });
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'studio-grid-line', type: 'box', bevel: 0 }],
    materials: [
      glow('studio-grid-minor', [0.6, 0.6, 0.66], 0.28),
      glow('studio-grid-x', [0.93, 0.38, 0.32], 0.9),
      glow('studio-grid-z', [0.28, 0.6, 1], 0.9),
    ],
    nodes,
  };
}

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function dot(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

/**
 * Where the six axis ends fall for a camera, as seen on screen: `x` and `y` from -1 to 1 (y grows downward) and
 * `depth` from -1 (pointing away) to 1 (pointing at the viewer). Sorted far to near, so the near ends draw last.
 */
export function axisWidgetEnds(camera) {
  const forward = normalize([camera.target[0] - camera.eye[0], camera.target[1] - camera.eye[1], camera.target[2] - camera.eye[2]]);
  const right = normalize(cross(forward, camera.up ?? [0, 1, 0]));
  const up = cross(right, forward);
  const ends = [];
  for (const axis of Object.keys(AXIS_VECTORS)) {
    for (const sign of [1, -1]) {
      const direction = AXIS_VECTORS[axis].map(component => component * sign);
      ends.push({
        axis,
        positive: sign === 1,
        view: AXIS_VIEWS[axis][sign === 1 ? 0 : 1],
        x: dot(direction, right),
        y: -dot(direction, up),
        depth: -dot(direction, forward),
      });
    }
  }
  return ends.sort((first, second) => first.depth - second.depth);
}

function svgElement(documentReference, tagName, attributes) {
  const element = documentReference.createElementNS(SVG_NAMESPACE, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

/** The view widget: the three world axes as the camera sees them. Clicking an end calls `onPickView` with its view name. */
export function createViewWidget(documentReference, { onPickView }) {
  const widget = svgElement(documentReference, 'svg', {
    class: 'crucible-studio-view-widget',
    viewBox: `0 0 ${WIDGET_SIZE} ${WIDGET_SIZE}`,
    role: 'group',
    'aria-label': 'View direction',
  });
  const centre = WIDGET_SIZE / 2;
  let lastKey = '';

  function update(camera) {
    const ends = axisWidgetEnds(camera);
    const key = ends.map(end => `${end.axis}${end.positive ? '+' : '-'}${end.x.toFixed(2)},${end.y.toFixed(2)}`).join('|');
    if (key === lastKey) {
      return;
    }
    lastKey = key;
    const marks = [];
    for (const end of ends) {
      const x = centre + end.x * WIDGET_REACH;
      const y = centre + end.y * WIDGET_REACH;
      const color = AXIS_COLORS[end.axis];
      if (end.positive) {
        marks.push(svgElement(documentReference, 'line', { x1: centre, y1: centre, x2: x.toFixed(1), y2: y.toFixed(1), stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
      }
      const knob = svgElement(documentReference, 'circle', {
        cx: x.toFixed(1),
        cy: y.toFixed(1),
        r: end.positive ? 8.5 : 6,
        fill: end.positive ? color : 'var(--studio-panel)',
        stroke: color,
        'stroke-width': 1.5,
        'data-axis-end': `${end.positive ? '+' : '-'}${end.axis}`,
      });
      marks.push(knob);
      if (end.view) {
        knob.setAttribute('data-view', end.view);
        knob.setAttribute('role', 'button');
        knob.setAttribute('aria-label', `${end.view[0].toUpperCase()}${end.view.slice(1)} view`);
        knob.addEventListener('click', () => onPickView(end.view));
      }
      if (end.positive) {
        const letter = svgElement(documentReference, 'text', { x: x.toFixed(1), y: (y + 3.6).toFixed(1), 'text-anchor': 'middle', class: 'crucible-studio-view-letter' });
        letter.textContent = end.axis.toUpperCase();
        marks.push(letter);
      }
    }
    widget.replaceChildren(...marks);
  }

  return { element: widget, update };
}

function metres(value) {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
}

/** The camera half of the readout, such as "Perspective · 50 mm" or "Orthographic". */
export function describeCamera(camera) {
  if (camera.projection === 'orthographic') {
    return 'Orthographic';
  }
  return Number.isFinite(camera.focalLength) ? `Perspective · ${Math.round(camera.focalLength)} mm` : `Perspective · ${Math.round(camera.fov ?? 45)}°`;
}

/** The selection half of the readout: the object's size in metres, width × height × depth. */
export function describeBounds(bounds) {
  return `${metres(bounds.size[0])} × ${metres(bounds.size[1])} × ${metres(bounds.size[2])} m`;
}
