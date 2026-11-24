// Camera-facing quads (#3237): a name tag or label that turns to the camera at every sampled time. The node is a plane (a flat
// sheet in XY) whose material carries a text panel; the geometry is rebuilt per camera pose so the sheet always faces the eye.
import { mat4, vec3 } from 'gl-matrix';
import { invalidField } from './field-error.js';

export const TEXT_BILLBOARD_LIMITS = Object.freeze({
  size: Object.freeze([0.001, 1000]),
  screenHeight: Object.freeze([0.002, 1]),
  offset: Object.freeze([-10000, 10000]),
});

const BILLBOARD_FIELDS = ['size', 'screenHeight', 'offset'];
const PLANE_TYPES = ['plane', 'grid'];

function checkedNumber(path, value, [minimum, maximum], example) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidField(path, value, `a number from ${minimum} to ${maximum}, such as ${example}`, TypeError);
  }
  return value;
}

/**
 * Validates the `billboard` field of a node: `size` [width, height] in metres, or `screenHeight`, the share of the frame height
 * the tag covers at any distance (the width follows the text panel's shape); `offset` [x, y, z] in world metres from the node,
 * such as [0, 0.4, 0] to hold a name tag above a head.
 */
export function normalizeBillboard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidField('billboard', value, 'an object such as { "size": [1.2, 0.3], "offset": [0, 0.5, 0] } or { "screenHeight": 0.03 }', TypeError);
  }
  for (const key of Object.keys(value)) {
    if (!BILLBOARD_FIELDS.includes(key)) throw invalidField(`billboard.${key}`, value[key], `one of ${BILLBOARD_FIELDS.join(', ')}`, TypeError);
  }
  if ((value.size === undefined) === (value.screenHeight === undefined)) {
    throw invalidField('billboard', Object.keys(value), 'exactly one of size (metres, [width, height]) or screenHeight (share of the frame height, such as 0.03)', TypeError);
  }
  const result = {};
  if (value.size !== undefined) {
    if (!Array.isArray(value.size) || value.size.length !== 2) throw invalidField('billboard.size', value.size, 'two numbers [width, height] in metres, such as [1.2, 0.3]', TypeError);
    result.size = value.size.map((component, index) => checkedNumber(`billboard.size[${index}]`, component, TEXT_BILLBOARD_LIMITS.size, 1));
  } else {
    result.screenHeight = checkedNumber('billboard.screenHeight', value.screenHeight, TEXT_BILLBOARD_LIMITS.screenHeight, 0.03);
  }
  const offset = value.offset ?? [0, 0, 0];
  if (!Array.isArray(offset) || offset.length !== 3) throw invalidField('billboard.offset', offset, 'three numbers [x, y, z] in world metres, such as [0, 0.5, 0]', TypeError);
  result.offset = offset.map((component, index) => checkedNumber(`billboard.offset[${index}]`, component, TEXT_BILLBOARD_LIMITS.offset, 0.5));
  return result;
}

// Metres the frame is tall at `distance` from the eye.
function frameHeightAt(camera, distance) {
  if (camera.projection === 'orthographic') return camera.orthoScale ?? 4;
  if (typeof camera.fov !== 'number') throw new RangeError('billboard.screenHeight needs a camera with a vertical fov; set camera.fov, or give billboard.size in metres instead.');
  return 2 * distance * Math.tan(camera.fov * Math.PI / 360);
}

function worldQuadSize(node, camera, center, panelAspect) {
  const { size, screenHeight } = node.billboard;
  if (size) return size;
  const height = screenHeight * frameHeightAt(camera, vec3.distance(camera.eye, center));
  return [height * panelAspect, height];
}

// A unit sheet in XY becomes a sheet of `size` that faces the eye, then returns to the node's own space.
function facingGeometry(template, worldMatrix, node, camera, panelAspect) {
  const center = vec3.fromValues(worldMatrix[12] + node.billboard.offset[0], worldMatrix[13] + node.billboard.offset[1], worldMatrix[14] + node.billboard.offset[2]);
  const toEye = camera.projection === 'orthographic'
    ? vec3.subtract(vec3.create(), camera.eye, camera.target)
    : vec3.subtract(vec3.create(), camera.eye, center);
  vec3.normalize(toEye, toEye);
  const right = vec3.cross(vec3.create(), camera.up, toEye);
  if (vec3.length(right) < 1e-6) vec3.cross(right, [0, 0, 1], toEye);
  vec3.normalize(right, right);
  const up = vec3.cross(vec3.create(), toEye, right);
  const [width, height] = worldQuadSize(node, camera, center, panelAspect);
  const inverse = mat4.invert(mat4.create(), worldMatrix);
  const positions = new Float32Array(template.positions.length);
  const normals = new Float32Array(template.normals.length);
  const point = vec3.create();
  for (let offset = 0; offset < positions.length; offset += 3) {
    const across = template.positions[offset] * width;
    const down = template.positions[offset + 1] * height;
    for (let axis = 0; axis < 3; axis++) point[axis] = center[axis] + right[axis] * across + up[axis] * down;
    vec3.transformMat4(point, point, inverse);
    positions.set(point, offset);
    for (let axis = 0; axis < 3; axis++) {
      normals[offset + axis] = worldMatrix[axis * 4] * toEye[0] + worldMatrix[axis * 4 + 1] * toEye[1] + worldMatrix[axis * 4 + 2] * toEye[2];
    }
    const length = Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]) || 1;
    for (let axis = 0; axis < 3; axis++) normals[offset + axis] /= length;
  }
  return Object.freeze({ ...template, positions, normals });
}

/** The world-space corners of the sheet a billboard node draws, for tests and the report: `{ center, right, up, size }`. */
export function billboardFrame(node, worldMatrix, camera, panelAspect = 1) {
  const template = { positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), normals: new Float32Array(12) };
  const geometry = facingGeometry(template, worldMatrix, node, camera, panelAspect);
  const world = new Float32Array(12);
  for (let vertex = 0; vertex < 4; vertex++) {
    const point = vec3.fromValues(geometry.positions[vertex * 3], geometry.positions[vertex * 3 + 1], geometry.positions[vertex * 3 + 2]);
    vec3.transformMat4(point, point, worldMatrix);
    world.set(point, vertex * 3);
  }
  return world;
}

function assertPlane(node, recipe) {
  const geometry = recipe.geometries.find(candidate => candidate.id === node.geometry);
  if (!geometry || !PLANE_TYPES.includes(geometry.type)) {
    throw invalidField(`nodes.${node.id}.billboard`, geometry?.type ?? node.geometry, `a node whose geometry is a plane (a flat sheet the billboard turns to the camera); geometry ${node.geometry} is ${geometry?.type ?? 'missing'}`);
  }
}

/**
 * `follow.matrixAt(nodeId, time)` is the world matrix of a node at a scene time. `sample(time, camera)` returns, for every billboard
 * node, the plane geometry in the node's own space that faces `camera` ({ eye, target, up, fov }) at that time.
 */
export function bakeTextBillboards(recipe, geometries, follow) {
  const billboards = recipe.nodes.filter(node => node.billboard);
  const prepared = billboards.map(node => {
    assertPlane(node, recipe);
    const panel = recipe.materials.find(material => material.id === node.material)?.text;
    return { node, template: geometries.get(node.geometry), aspect: panel ? panel.width / panel.height : 1 };
  });
  return Object.freeze({
    sample(time, camera) {
      return new Map(prepared.map(({ node, template, aspect }) => [node.id, facingGeometry(template, follow.matrixAt(node.id, time), node, camera, aspect)]));
    },
    report() {
      return { count: prepared.length, nodes: prepared.map(({ node }) => node.id) };
    },
  });
}
