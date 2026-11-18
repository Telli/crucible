// The WGSL the WebGPU megakernel adds for an instanced scene (path-tracer-gpu-instance-pack.js lays the tables out, the WebGL2
// tracer reads the same records in path-tracer-gpu-instancing.js). Copies of one mesh share its triangles and bottom-level BVH; a
// top-level BVH holds one record per copy: the world to mesh matrix, the mesh to world matrix, the root of its bottom-level BVH and
// its material. The ray of a copy is moved into mesh space without being normalised, so a distance there is the same distance in
// the world. The records live in the node buffer, after the node table, so the storage bindings stay the ten the flat scene uses.

/** Vectors per instance record: three rows of the world to mesh matrix, three columns of the mesh to world matrix, then (bottom-level root node, material, 0, 0). */
export const WEBGPU_INSTANCE_VECTORS = 7;

// The parameter word `shadowSlots.w` holds the vector index of the table header in the node buffer: its first vector names the top-level
// root node, and the instance records follow it.
export const INSTANCE_STATE = `
const INSTANCE_VECTORS: i32 = ${WEBGPU_INSTANCE_VECTORS};
var<private> nearestInstance: i32 = -1;
var<private> nearestMaterial: i32 = 0;
var<private> instanceNodeStack: array<i32, 128>;
var<private> instanceEntryStack: array<f32, 128>;

fn instanceRecord(instance: i32) -> i32 {
  return i32(params.shadowSlots.w) + 1 + instance * INSTANCE_VECTORS;
}

// An edge of the nearest triangle, moved from mesh space to the world by the columns of the instance's matrix.
fn surfaceVectorToWorld(local: vec3<f32>) -> vec3<f32> {
  let base = instanceRecord(nearestInstance);
  return nodes[base + 3].xyz * local.x + nodes[base + 4].xyz * local.y + nodes[base + 5].xyz * local.z;
}

// A vertex normal moves by the transpose of the inverse (the transpose of the three rows stored for the ray) and is unit length again
// before the corners are blended, as the flattened scene stores it.
fn normalToWorld(local: vec3<f32>) -> vec3<f32> {
  let base = instanceRecord(nearestInstance);
  let world = nodes[base].xyz * local.x + nodes[base + 1].xyz * local.y + nodes[base + 2].xyz * local.z;
  let worldLength = length(world);
  return world / select(worldLength, 1.0, worldLength == 0.0);
}`;

export const INSTANCED_TRACE_RAY = `// Walks the bottom-level BVH of one instance with the ray moved into mesh space; true when an any-hit query found a hit.
fn traceInstance(instance: i32, origin: vec3<f32>, direction: vec3<f32>, anyHit: bool) -> bool {
  let base = instanceRecord(instance);
  let rowX = nodes[base];
  let rowY = nodes[base + 1];
  let rowZ = nodes[base + 2];
  let link = nodes[base + 6];
  let localOrigin = vec3<f32>(dot(rowX.xyz, origin) + rowX.w, dot(rowY.xyz, origin) + rowY.w, dot(rowZ.xyz, origin) + rowZ.w);
  let localDirection = vec3<f32>(dot(rowX.xyz, direction), dot(rowY.xyz, direction), dot(rowZ.xyz, direction));
  let inverse = safeInverse(localDirection);
  let distanceBefore = nearestDistance;
  var stackSize = 1;
  instanceNodeStack[0] = i32(link.x);
  instanceEntryStack[0] = 0.0;
  var found = false;
  while (stackSize > 0 && !found) {
    stackSize--;
    let node = instanceNodeStack[stackSize];
    if (!(instanceEntryStack[stackSize] < nearestDistance)) { continue; }
    let header = nodes[node * 2];
    if (header.w < 0.0) {
      found = visitLeaf(node, localOrigin, localDirection, anyHit);
      continue;
    }
    let left = node + 1;
    let right = i32(header.w);
    let leftEntry = boxEntry(left, localOrigin, inverse);
    let rightEntry = boxEntry(right, localOrigin, inverse);
    let nearFirst = leftEntry <= rightEntry;
    instanceNodeStack[stackSize] = select(left, right, nearFirst);
    instanceEntryStack[stackSize] = select(leftEntry, rightEntry, nearFirst);
    instanceNodeStack[stackSize + 1] = select(right, left, nearFirst);
    instanceEntryStack[stackSize + 1] = select(rightEntry, leftEntry, nearFirst);
    stackSize += 2;
  }
  if (nearestDistance < distanceBefore) {
    nearestInstance = instance;
    nearestMaterial = i32(link.y);
  }
  return found;
}

fn traceRay(origin: vec3<f32>, direction: vec3<f32>, limit: f32, anyHit: bool) {
  nearestDistance = limit;
  nearestSlot = -1;
  nearestInstance = -1;
  let inverse = safeInverse(direction);
  var stackSize = 1;
  nodeStack[0] = i32(nodes[i32(params.shadowSlots.w)].x);
  entryStack[0] = 0.0;
  while (stackSize > 0) {
    stackSize--;
    let node = nodeStack[stackSize];
    if (!(entryStack[stackSize] < nearestDistance)) { continue; }
    let header = nodes[node * 2];
    if (header.w < 0.0) {
      let first = i32(nodes[node * 2 + 1].w);
      let last = first + i32(-header.w);
      for (var instance = first; instance < last; instance++) {
        if (traceInstance(instance, origin, direction, anyHit)) { return; }
      }
      continue;
    }
    let left = node + 1;
    let right = i32(header.w);
    let leftEntry = boxEntry(left, origin, inverse);
    let rightEntry = boxEntry(right, origin, inverse);
    let nearFirst = leftEntry <= rightEntry;
    nodeStack[stackSize] = select(left, right, nearFirst);
    entryStack[stackSize] = select(leftEntry, rightEntry, nearFirst);
    nodeStack[stackSize + 1] = select(right, left, nearFirst);
    entryStack[stackSize + 1] = select(rightEntry, leftEntry, nearFirst);
    stackSize += 2;
  }
}`;
