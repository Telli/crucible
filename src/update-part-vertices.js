// updatePartVertices(renderer, part, positions, normals): new vertex positions (and normals) for a part that already
// drew, written into its existing GPU buffers with bufferSubData. A deforming mesh such as cloth skips replaceParts,
// which would build a new geometry object and upload every buffer again. The renderer is a parameter, so this module
// imports nothing from the renderer and a scene that never deforms a mesh does not carry it.
import { markLiveGeometry } from './live-geometry.js';

function checkVertices(name, values, expectedLength, label) {
  if (!(values instanceof Float32Array) || values.length !== expectedLength) {
    throw new TypeError(`updatePartVertices ${name} must be a Float32Array of ${expectedLength} numbers (3 per vertex, the vertex count of ${label}).`);
  }
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) throw new RangeError(`updatePartVertices ${name}[${index}] is ${values[index]}; pass finite numbers.`);
  }
}

// The sphere around the box of the new positions: culling and shadow fitting read it, so a sheet that swings out of its
// first bounds is not culled while still on screen.
function boundingSphereOf(positions) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], positions[index + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[index + axis]);
    }
  }
  const center = minimum.map((value, axis) => (value + maximum[axis]) / 2);
  let radiusSquared = 0;
  for (let index = 0; index < positions.length; index += 3) {
    radiusSquared = Math.max(radiusSquared, (positions[index] - center[0]) ** 2 + (positions[index + 1] - center[1]) ** 2 + (positions[index + 2] - center[2]) ** 2);
  }
  return { center, radius: Math.sqrt(radiusSquared) };
}

// Sky visibility rides in the fourth channel of the colour attribute (renderer.js interleaves it with the colours), so a
// change of it rewrites the whole interleaved buffer.
function interleavedColors(geometry) {
  const interleaved = new Float32Array(geometry.skyVisibility.length * 4);
  for (let vertex = 0; vertex < geometry.skyVisibility.length; vertex++) {
    for (let channel = 0; channel < 3; channel++) {
      interleaved[vertex * 4 + channel] = geometry.colors ? geometry.colors[vertex * 3 + channel] : 1;
    }
    interleaved[vertex * 4 + 3] = geometry.skyVisibility[vertex];
  }
  return interleaved;
}

/**
 * Replace the vertex positions, and the normals, sky visibility and triangle indices when given, of a rigid part the
 * renderer already holds. The vertex and index counts cannot change, and sky visibility needs a geometry that has it and
 * no surface masks. The values are copied into the part's geometry, so the geometry stays the truth, and the geometry is
 * shared by every part that uses it. Skinned, morphed, crowd and level-of-detail parts are refused. Returns the part.
 */
export function updatePartVertices(renderer, part, positions, normals, { skyVisibility, indices } = {}) {
  const location = renderer.partLocations.get(part);
  if (!location) throw new Error(`Unknown part identity: ${part?.name}`);
  const geometry = location.geometry;
  if (part.geometry !== geometry) throw new Error(`Geometry changes require replaceParts: ${part.name}`);
  if (location.skin || location.morph || location.morphTargets || location.batch.crowd || part.lods) {
    throw new Error(`updatePartVertices takes rigid parts without level-of-detail sets: ${part.name}`);
  }
  checkVertices('positions', positions, geometry.positions.length, part.name);
  if (normals !== undefined) checkVertices('normals', normals, geometry.normals.length, part.name);
  const buffers = renderer.geometryBuffers.get(geometry);
  const context = renderer.context;
  if (skyVisibility) {
    if (!geometry.skyVisibility || geometry.surfaceMasks || !buffers.has('colors')) throw new Error(`updatePartVertices skyVisibility needs a geometry with sky visibility and no surface masks: ${part.name}`);
    if (!(skyVisibility instanceof Float32Array) || skyVisibility.length !== geometry.skyVisibility.length) throw new TypeError(`updatePartVertices skyVisibility must be a Float32Array of ${geometry.skyVisibility.length} numbers (1 per vertex of ${part.name}).`);
  }
  if (indices && (indices.constructor !== geometry.indices.constructor || indices.length !== geometry.indices.length)) {
    throw new TypeError(`updatePartVertices indices must be a ${geometry.indices.constructor.name} of ${geometry.indices.length} numbers (the triangle count of ${part.name}).`);
  }
  for (const [field, values] of [['positions', positions], ['normals', normals]]) {
    if (!values) continue;
    if (values !== geometry[field]) geometry[field].set(values);
    context.bindBuffer(context.ARRAY_BUFFER, buffers.get(field));
    context.bufferSubData(context.ARRAY_BUFFER, 0, geometry[field]);
  }
  if (skyVisibility) {
    if (skyVisibility !== geometry.skyVisibility) geometry.skyVisibility.set(skyVisibility);
    context.bindBuffer(context.ARRAY_BUFFER, buffers.get('colors'));
    context.bufferSubData(context.ARRAY_BUFFER, 0, interleavedColors(geometry));
  }
  if (indices) {
    if (indices !== geometry.indices) geometry.indices.set(indices);
    // The element binding belongs to the bound vertex array, so none may be bound while the buffer is written.
    context.bindVertexArray(null);
    context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, buffers.get('indices'));
    context.bufferSubData(context.ELEMENT_ARRAY_BUFFER, 0, geometry.indices);
  }
  // The values changed in place under the same array, so no cache may keep a measurement of this geometry.
  markLiveGeometry(geometry);
  location.batch.bounds = boundingSphereOf(geometry.positions);
  renderer.shadowsDirty = true;
  return part;
}
