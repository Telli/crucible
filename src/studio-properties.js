import { cameraFieldOfView } from './camera.js';
import { DEFAULT_SUN_ANGULAR_RADIUS } from './environment-shading.js';

// The properties of the camera, the sun and the lights that Studio lets a person edit, as one declarative table.
// Studio draws its property panels from these rows, so a later area (world, effects) adds rows and no panel code.
// Ranges and enums repeat the validators of agent-look.js, agent-scene.js and camera.js, which stay the authority.
//
// A row says:
//   id             the name of the field in the recipe (or of the group of fields it writes)
//   label          the short title the panel shows
//   control        number, slider, colour, toggle, vector or sunpad
//   appliesTo      the object kinds that show the row (camera, sun, point, spot, area)
//   section        the group title the row sits under
//   read           (source, context) => the value the control shows; source is the camera, the environment or one light
//   write          (value, source, context) => the patch for that object; undefined values remove a field
//   motionProperty the name a motion track or driver uses for this field when it differs from id
//   visibleWhen    (source) => false hides the row while it has no meaning (a focal length of an orthographic camera)

const POSITION_LIMIT = 1e6;
const DEFAULT_SENSOR_WIDTH = 36;
const DEFAULT_LIGHT_COLOR = Object.freeze([1, 1, 1]);
const LIGHT_KINDS = Object.freeze(['point', 'spot', 'area']);
const LIGHT_KINDS_WITH_RADIUS = Object.freeze(['point', 'spot']);
const LIGHT_KINDS_WITH_DIRECTION = Object.freeze(['spot', 'area']);

export const PROPERTY_SECTIONS = Object.freeze({
  light: 'Light',
  shape: 'Shape',
  shadow: 'Shadows',
  transform: 'Transform',
  lens: 'Lens',
  depthOfField: 'Depth of field',
  sun: 'Sun',
});

function isPerspective(camera) {
  return camera.projection !== 'orthographic';
}

function distanceBetween(from, to) {
  return Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]);
}

/** The focal length in millimetres of a camera, read from its focal length or worked out from its field of view. */
function focalLengthOf(camera, context) {
  if (camera.focalLength !== undefined) {
    return camera.focalLength;
  }
  const sensorWidth = camera.sensorWidth ?? DEFAULT_SENSOR_WIDTH;
  const verticalFieldOfView = cameraFieldOfView(camera, context.aspect);
  return sensorWidth / context.aspect / (2 * Math.tan((verticalFieldOfView * Math.PI) / 360));
}

function lightRow(id, label, control, section, appliesTo, extra = {}) {
  return { id, label, control, section, appliesTo, ...extra };
}

const LIGHT_ROWS = [
  lightRow('color', 'Color', 'colour', 'light', LIGHT_KINDS, {
    read: light => light.color ?? DEFAULT_LIGHT_COLOR,
    write: value => ({ color: value }),
  }),
  lightRow('intensity', 'Intensity', 'number', 'light', LIGHT_KINDS, {
    min: 0, max: 1e5, step: 0.1,
    read: light => light.intensity ?? 1,
    write: value => ({ intensity: value }),
  }),
  lightRow('radius', 'Radius', 'number', 'light', LIGHT_KINDS_WITH_RADIUS, {
    min: 0.001, max: 1e6, step: 0.01,
    read: light => light.radius ?? 0.05,
    write: value => ({ radius: value }),
  }),
  lightRow('range', 'Range', 'number', 'light', LIGHT_KINDS_WITH_RADIUS, {
    min: 0, max: 1e6, step: 0.5,
    read: light => light.range ?? 0,
    write: value => ({ range: value }),
  }),
  lightRow('width', 'Width', 'number', 'shape', ['area'], {
    min: 0.001, max: 1e4, step: 0.1,
    read: light => light.width,
    write: value => ({ width: value }),
  }),
  lightRow('height', 'Height', 'number', 'shape', ['area'], {
    min: 0.001, max: 1e4, step: 0.1,
    read: light => light.height,
    write: value => ({ height: value }),
  }),
  lightRow('angle', 'Angle °', 'slider', 'shape', ['spot'], {
    min: 1, max: 89, step: 1,
    read: light => Math.round(((light.angle ?? Math.PI / 4) * 180) / Math.PI),
    write: value => ({ angle: (value * Math.PI) / 180 }),
  }),
  lightRow('penumbra', 'Penumbra', 'slider', 'shape', ['spot'], {
    min: 0, max: 1, step: 0.01,
    read: light => light.penumbra ?? 0.15,
    write: value => ({ penumbra: value }),
  }),
  lightRow('castShadow', 'Shadow', 'toggle', 'shadow', LIGHT_KINDS, {
    read: light => light.castShadow === true,
    write: value => ({ castShadow: value }),
  }),
  lightRow('softFalloff', 'Soft falloff', 'toggle', 'shadow', LIGHT_KINDS_WITH_RADIUS, {
    read: light => light.softFalloff === true,
    write: value => ({ softFalloff: value }),
  }),
  lightRow('portal', 'Portal', 'toggle', 'shadow', ['area'], {
    read: light => light.portal === true,
    write: value => ({ portal: value }),
  }),
  lightRow('position', 'Light position', 'vector', 'transform', LIGHT_KINDS, {
    min: -POSITION_LIMIT, max: POSITION_LIMIT, step: 0.05,
    read: light => light.position,
    write: value => ({ position: value }),
  }),
  lightRow('direction', 'Light direction', 'vector', 'transform', LIGHT_KINDS_WITH_DIRECTION, {
    min: -POSITION_LIMIT, max: POSITION_LIMIT, step: 0.05,
    read: light => light.direction,
    write: value => ({ direction: value }),
  }),
];

const SUN_ROWS = [
  {
    id: 'direction', label: 'Sun direction', control: 'sunpad', section: 'sun', appliesTo: ['sun'],
    read: environment => environment.lightDirection ?? [0, 1, 0],
  },
  {
    id: 'keyIntensity', label: 'Sun strength', control: 'slider', section: 'sun', appliesTo: ['sun'],
    min: 0, max: 8, step: 0.1, motionProperty: 'intensity',
    read: environment => environment.keyIntensity ?? 1.5,
    write: value => ({ keyIntensity: value }),
  },
  {
    id: 'keyColor', label: 'Sun color', control: 'colour', section: 'sun', appliesTo: ['sun'],
    motionProperty: 'color',
    read: environment => environment.keyColor ?? DEFAULT_LIGHT_COLOR,
    write: value => ({ keyColor: value }),
  },
  {
    id: 'sunAngularRadius', label: 'Sun size', control: 'number', section: 'sun', appliesTo: ['sun'],
    min: 0.0005, max: 0.2, step: 0.0005,
    read: environment => environment.sunAngularRadius ?? DEFAULT_SUN_ANGULAR_RADIUS,
    write: value => ({ sunAngularRadius: value }),
  },
];

const CAMERA_ROWS = [
  {
    id: 'projection', label: 'Ortho', control: 'toggle', section: 'lens', appliesTo: ['camera'],
    read: camera => camera.projection === 'orthographic',
    write: value => ({ projection: value ? 'orthographic' : 'perspective' }),
  },
  {
    id: 'focalLength', label: 'Focal length mm', control: 'number', section: 'lens', appliesTo: ['camera'],
    min: 1, max: 10000, step: 1, visibleWhen: isPerspective,
    read: focalLengthOf,
    write: (value, camera) => ({ focalLength: value, sensorWidth: camera.sensorWidth ?? DEFAULT_SENSOR_WIDTH }),
  },
  {
    id: 'sensorWidth', label: 'Sensor width mm', control: 'number', section: 'lens', appliesTo: ['camera'],
    min: 1, max: 1000, step: 1, visibleWhen: isPerspective,
    read: camera => camera.sensorWidth ?? DEFAULT_SENSOR_WIDTH,
    write: (value, camera, context) => ({ focalLength: focalLengthOf(camera, context), sensorWidth: value }),
  },
  {
    id: 'fov', label: 'Field of view', control: 'slider', section: 'lens', appliesTo: ['camera'],
    min: 15, max: 110, step: 1, visibleWhen: isPerspective,
    read: (camera, context) => Math.round(cameraFieldOfView(camera, context.aspect)),
    write: value => ({ fov: value }),
  },
  {
    id: 'orthoScale', label: 'Orthographic size', control: 'slider', section: 'lens', appliesTo: ['camera'],
    min: 1, max: 40, step: 0.5, visibleWhen: camera => !isPerspective(camera),
    read: camera => camera.orthoScale ?? 6,
    write: value => ({ projection: 'orthographic', orthoScale: value }),
  },
  {
    id: 'near', label: 'Clip start', control: 'number', section: 'lens', appliesTo: ['camera'],
    min: 0.0001, max: 1e6, step: 0.01,
    read: camera => camera.near ?? 0.1,
    write: value => ({ near: value }),
  },
  {
    id: 'far', label: 'Clip end', control: 'number', section: 'lens', appliesTo: ['camera'],
    min: 0.001, max: 1e7, step: 1,
    read: camera => camera.far ?? 1000,
    write: value => ({ far: value }),
  },
  {
    id: 'shift', label: 'Shift', control: 'vector', section: 'lens', appliesTo: ['camera'],
    axes: 2, min: -1, max: 1, step: 0.01,
    read: camera => camera.shift ?? [0, 0],
    write: value => ({ shift: value }),
  },
  {
    id: 'fStop', label: 'F-stop', control: 'number', section: 'depthOfField', appliesTo: ['camera'],
    min: 0.7, max: 64, step: 0.1, clearable: true,
    read: camera => camera.fStop ?? null,
    write: value => (value === null ? { fStop: undefined, focusDistance: undefined } : { fStop: value }),
  },
  {
    id: 'focusDistance', label: 'Focus distance', control: 'number', section: 'depthOfField', appliesTo: ['camera'],
    min: 0.001, max: 1e6, step: 0.1, visibleWhen: camera => camera.fStop !== undefined,
    read: camera => camera.focusDistance ?? distanceBetween(camera.eye, camera.target),
    write: value => ({ focusDistance: value }),
  },
  {
    id: 'eye', label: 'Eye', control: 'vector', section: 'transform', appliesTo: ['camera'],
    min: -POSITION_LIMIT, max: POSITION_LIMIT, step: 0.05,
    read: camera => camera.eye,
    write: value => ({ eye: value }),
  },
  {
    id: 'target', label: 'Target', control: 'vector', section: 'transform', appliesTo: ['camera'],
    min: -POSITION_LIMIT, max: POSITION_LIMIT, step: 0.05,
    read: camera => camera.target,
    write: value => ({ target: value }),
  },
];

export const PROPERTY_FIELDS = Object.freeze([...CAMERA_ROWS, ...SUN_ROWS, ...LIGHT_ROWS].map(row => Object.freeze(row)));

/** The rows that apply to one kind of scene object, in the order the panel shows them. */
export function propertyFieldsFor(kind) {
  return PROPERTY_FIELDS.filter(field => field.appliesTo.includes(kind));
}

/** The rows of a kind grouped under their section titles, in panel order. */
export function propertySectionsFor(kind) {
  const sections = [];
  for (const field of propertyFieldsFor(kind)) {
    const title = PROPERTY_SECTIONS[field.section];
    let section = sections.find(candidate => candidate.title === title);
    if (!section) {
      section = { title, fields: [] };
      sections.push(section);
    }
    section.fields.push(field);
  }
  return sections;
}

/** The name a motion track or driver gives this field. */
export function motionPropertyOf(field) {
  return field.motionProperty ?? field.id;
}

export function propertyIsVisible(field, source) {
  return field.visibleWhen ? field.visibleWhen(source) : true;
}
