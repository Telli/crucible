// Working aids for the Studio viewport: a ground grid with the world axes, a view widget that shows where the camera
// looks and snaps to the main views, and a readout of the camera and the selection. None of them is part of the scene.

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const GRID_HALF_EXTENT = 10;
// The renderer draws its own floor at 0.019 m, so the grid has to sit above that to show. It stays within 3 mm of it,
// or the lines would cut a visible notch into the base of anything that rests on the ground.
const GRID_HEIGHT = 0.0212;
const GRID_THICKNESS = 0.002;
const GRID_LINE_WIDTH = 0.012;
const GRID_AXIS_WIDTH = 0.024;
const WIDGET_SIZE = 76;
const WIDGET_REACH = 26;

export const GRID_PART_PREFIX = 'studio-grid-';
export const AXIS_COLORS = Object.freeze({ x: '#ee7a6c', y: '#5fc48a', z: '#5ea8ff' });
const AXIS_VECTORS = Object.freeze({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
// The view each end of an axis snaps to. Looking up from below has no preset, so the low end of Y only shows.
const AXIS_VIEWS = Object.freeze({ x: ['right', 'left'], y: ['top', null], z: ['front', 'back'] });

function gridLineNode(id, material, alongX, offset, width) {
  const length = GRID_HALF_EXTENT * 2;
  return {
    id: `${GRID_PART_PREFIX}${id}`,
    geometry: 'studio-grid-line',
    material,
    translation: alongX ? [0, GRID_HEIGHT, offset] : [offset, GRID_HEIGHT, 0],
    scale: alongX ? [length, GRID_THICKNESS, width] : [width, GRID_THICKNESS, length],
    castShadow: false,
    receiveShadow: false,
  };
}

/** The recipe of the ground grid: one line per metre over 20 m, with the X axis in red and the Z axis in blue. */
export function buildGridRecipe() {
  const nodes = [];
  for (let offset = -GRID_HALF_EXTENT; offset <= GRID_HALF_EXTENT; offset += 1) {
    if (offset === 0) {
      continue;
    }
    nodes.push(gridLineNode(`x${offset}`, 'studio-grid-minor', true, offset, GRID_LINE_WIDTH));
    nodes.push(gridLineNode(`z${offset}`, 'studio-grid-minor', false, offset, GRID_LINE_WIDTH));
  }
  nodes.push(gridLineNode('axis-x', 'studio-grid-x', true, 0, GRID_AXIS_WIDTH));
  nodes.push(gridLineNode('axis-z', 'studio-grid-z', false, 0, GRID_AXIS_WIDTH));
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
