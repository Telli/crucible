import { cameraFieldOfView } from './camera.js';
import { DEFAULT_SUN_ANGULAR_RADIUS } from './environment-shading.js';
import { BUNDLED_ENVIRONMENT_NAMES } from './look-catalog.js';
import { DEFAULT_SPECULAR_ANTI_ALIASING, MAXIMUM_SPECULAR_ANTI_ALIASING } from './lighting.js';

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
  world: 'World',
  atmosphere: 'Fog',
  film: 'Film',
  effects: 'Effects',
  sceneShadow: 'Shadows',
  quality: 'Quality',
});

/** The groups a panel draws folded until a person opens them; every other group starts open. */
export const PROPERTY_SECTIONS_CLOSED_BY_DEFAULT = Object.freeze(['sceneShadow', 'quality']);

// The scene-level kinds read one record of the recipe: the environment (world, quality), the effects or the shadow.
export const PROPERTY_SCENE_KINDS = Object.freeze(['world', 'quality', 'effects', 'shadow']);
const DEFAULT_SUN_BOUNCE = 1;
const HDRI_CHOICES = Object.freeze([{ value: null, label: 'None' }, ...BUNDLED_ENVIRONMENT_NAMES.map(name => ({ value: name, label: name }))]);

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

// A row of the environment (kind world or quality): `field` is the environment field it reads and writes.
function environmentRow(field, label, control, kind, section, extra = {}) {
  return { id: field, label, control, section, appliesTo: [kind], write: value => ({ [field]: value }), ...extra };
}

function volumeFogRow(field, label, control, extra = {}) {
  return {
    id: `volumeFog.${field}`, label, control, section: 'atmosphere', appliesTo: ['world'],
    write: value => ({ volumeFog: { [field]: value } }),
    ...extra,
  };
}

function volumeFogOf(environment) {
  return environment.volumeFog ?? {};
}

const WORLD_ROWS = [
  environmentRow('hdri', 'HDRI', 'select', 'world', 'world', {
    choices: HDRI_CHOICES, read: environment => environment.hdri ?? null, preparation: value => ({ environment: { hdri: value } }),
  }),
  environmentRow('world', 'Show sky', 'toggle', 'world', 'world', { read: environment => environment.world === true }),
  environmentRow('ground', 'Ground', 'toggle', 'world', 'world', { read: environment => environment.ground !== false }),
  environmentRow('environmentIntensity', 'HDRI strength', 'number', 'world', 'world', {
    min: 0, max: 100, step: 0.05, read: environment => environment.environmentIntensity ?? 1,
  }),
  environmentRow('environmentRotation', 'HDRI rotation', 'number', 'world', 'world', {
    min: -100, max: 100, step: 0.05, read: environment => environment.environmentRotation ?? 0,
  }),
  environmentRow('skyTop', 'Sky top', 'colour', 'world', 'world', { read: environment => environment.skyTop ?? DEFAULT_LIGHT_COLOR }),
  environmentRow('skyBottom', 'Sky bottom', 'colour', 'world', 'world', { read: environment => environment.skyBottom ?? DEFAULT_LIGHT_COLOR }),
  environmentRow('daylight', 'Daylight', 'number', 'world', 'world', { min: 0, max: 100, step: 0.05, read: environment => environment.daylight ?? 1 }),
  environmentRow('fillIntensity', 'Fill strength', 'number', 'world', 'world', { min: 0, max: 100, step: 0.05, read: environment => environment.fillIntensity ?? 0 }),
  environmentRow('ambientIntensity', 'Ambient strength', 'number', 'world', 'world', { min: 0, max: 100, step: 0.05, read: environment => environment.ambientIntensity ?? 0 }),
  environmentRow('fogDensity', 'Fog', 'slider', 'world', 'atmosphere', { min: 0, max: 0.1, step: 0.002, read: environment => environment.fogDensity ?? 0 }),
  environmentRow('fogColor', 'Fog color', 'colour', 'world', 'atmosphere', { read: environment => environment.fogColor ?? DEFAULT_LIGHT_COLOR }),
  volumeFogRow('density', 'Volume density', 'number', {
    min: 0, max: 10, step: 0.01, motionProperty: 'volumeFogDensity', read: environment => volumeFogOf(environment).density ?? 0,
  }),
  volumeFogRow('color', 'Volume color', 'colour', { read: environment => volumeFogOf(environment).color ?? DEFAULT_LIGHT_COLOR }),
  volumeFogRow('anisotropy', 'Anisotropy', 'slider', { min: -0.9, max: 0.9, step: 0.05, read: environment => volumeFogOf(environment).anisotropy ?? 0.3 }),
  volumeFogRow('steps', 'Volume steps', 'number', { min: 8, max: 48, step: 1, read: environment => volumeFogOf(environment).steps ?? 16 }),
  volumeFogRow('noiseAmount', 'Noise amount', 'slider', { min: 0, max: 1, step: 0.05, read: environment => volumeFogOf(environment).noiseAmount ?? 0.5 }),
  volumeFogRow('noiseScale', 'Noise scale', 'number', { min: 0.001, max: 100, step: 0.05, read: environment => volumeFogOf(environment).noiseScale ?? 0.3 }),
  volumeFogRow('maxDistance', 'Volume distance', 'number', { min: 0.01, max: 1e4, step: 1, read: environment => volumeFogOf(environment).maxDistance ?? 100 }),
];

const QUALITY_ROWS = [
  environmentRow('objectReflections', 'Object reflections', 'toggle', 'quality', 'quality', { read: environment => environment.objectReflections !== false }),
  environmentRow('floorSkyTrace', 'Floor sky trace', 'toggle', 'quality', 'quality', { read: environment => environment.floorSkyTrace !== false }),
  environmentRow('resolveCoplanar', 'Resolve coplanar', 'toggle', 'quality', 'quality', {
    read: environment => environment.resolveCoplanar !== false,
    write: value => ({ resolveCoplanar: value ? 'offset' : false }),
  }),
  environmentRow('shadowCascades', 'Shadow cascades', 'number', 'quality', 'quality', { min: 0, max: 4, step: 1, read: environment => environment.shadowCascades ?? 0 }),
  environmentRow('sunBounce', 'Sun bounce', 'number', 'quality', 'quality', { min: 0, max: 100, step: 0.1, read: environment => environment.sunBounce ?? DEFAULT_SUN_BOUNCE }),
  environmentRow('specularAntiAliasing', 'Specular AA', 'number', 'quality', 'quality', {
    min: 0, max: MAXIMUM_SPECULAR_ANTI_ALIASING, step: 0.1, read: environment => environment.specularAntiAliasing ?? DEFAULT_SPECULAR_ANTI_ALIASING,
  }),
];

function effectRow(field, label, control, section, extra = {}) {
  return { id: field, label, control, section, appliesTo: ['effects'], write: value => ({ [field]: value }), ...extra };
}

// A patch replaces the depth of field and motion blur groups whole, so their rows write the group with the one field changed.
function effectGroupRow(group, field, label, control, extra = {}) {
  return {
    id: `${group}.${field}`, label, control, section: 'effects', appliesTo: ['effects'],
    write: (value, effects) => ({ [group]: { ...effects[group], [field]: value } }),
    ...extra,
  };
}

const EFFECT_ROWS = [
  effectRow('exposure', 'Exposure', 'slider', 'film', { min: 0.2, max: 3, step: 0.05, read: effects => effects.exposure ?? 1 }),
  effectRow('contrast', 'Contrast', 'slider', 'film', { min: 0.4, max: 1.8, step: 0.02, read: effects => effects.contrast ?? 1 }),
  effectRow('saturation', 'Saturation', 'slider', 'film', { min: 0, max: 2, step: 0.02, read: effects => effects.saturation ?? 1 }),
  effectRow('temperature', 'Temperature', 'slider', 'film', { min: -1, max: 1, step: 0.01, read: effects => effects.temperature ?? 0 }),
  effectRow('vignette', 'Vignette', 'slider', 'film', { min: 0, max: 1, step: 0.01, read: effects => effects.vignette ?? 0 }),
  effectRow('grain', 'Grain', 'slider', 'film', { min: 0, max: 0.1, step: 0.002, read: effects => effects.grain ?? 0 }),
  effectRow('ambientOcclusion', 'Ambient occlusion', 'slider', 'effects', { min: 0, max: 1, step: 0.02, read: effects => effects.ambientOcclusion ?? 0 }),
  effectRow('ambientOcclusionRadius', 'AO radius', 'number', 'effects', { min: 0.01, max: 100, step: 0.05, read: effects => effects.ambientOcclusionRadius ?? 0.5 }),
  effectGroupRow('bloom', 'strength', 'Bloom', 'slider', { min: 0, max: 2, step: 0.02, read: effects => effects.bloom?.strength ?? 0 }),
  effectGroupRow('bloom', 'threshold', 'Bloom threshold', 'number', { min: 0, max: 10, step: 0.05, read: effects => effects.bloom?.threshold ?? 1 }),
  effectGroupRow('bloom', 'radius', 'Bloom radius', 'number', { min: 0.1, max: 4, step: 0.05, read: effects => effects.bloom?.radius ?? 1 }),
  effectGroupRow('depthOfField', 'blur', 'DoF blur', 'slider', { min: 0, max: 1, step: 0.02, read: effects => effects.depthOfField?.blur ?? 0 }),
  effectGroupRow('depthOfField', 'focusDistance', 'DoF focus', 'number', {
    min: 0.01, max: 1e5, step: 0.1, motionProperty: 'focusDistance', read: effects => effects.depthOfField?.focusDistance ?? 5,
  }),
  effectGroupRow('motionBlur', 'shutter', 'Shutter', 'slider', { min: 0, max: 0.5, step: 0.01, read: effects => effects.motionBlur?.shutter ?? 0 }),
  effectGroupRow('motionBlur', 'objects', 'Object blur', 'slider', { min: 0, max: 1, step: 0.02, read: effects => effects.motionBlur?.objects ?? 0 }),
];

function shadowRow(field, label, control, extra = {}) {
  return { id: field, label, control, section: 'sceneShadow', appliesTo: ['shadow'], write: value => ({ [field]: value }), ...extra };
}

const SHADOW_ROWS = [
  shadowRow('target', 'Shadow target', 'vector', { min: -POSITION_LIMIT, max: POSITION_LIMIT, step: 0.05, read: shadow => shadow.target ?? [0, 1, 0] }),
  shadowRow('extent', 'Shadow extent', 'number', { min: 0.01, max: 1e5, step: 0.1, read: shadow => shadow.extent ?? 3.5 }),
  shadowRow('distance', 'Shadow distance', 'number', { min: 0.01, max: 1e6, step: 0.1, read: shadow => shadow.distance ?? 8 }),
  shadowRow('near', 'Shadow clip start', 'number', { min: 0.001, max: 1e6, step: 0.01, read: shadow => shadow.near ?? 0.1 }),
  shadowRow('far', 'Shadow clip end', 'number', { min: 0.001, max: 1e6, step: 0.5, read: shadow => shadow.far ?? 15 }),
];

export const PROPERTY_FIELDS = Object.freeze([
  ...CAMERA_ROWS, ...SUN_ROWS, ...LIGHT_ROWS, ...WORLD_ROWS, ...EFFECT_ROWS, ...QUALITY_ROWS, ...SHADOW_ROWS,
].map(row => Object.freeze(row)));

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
      section = { id: field.section, title, fields: [] };
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
