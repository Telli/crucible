// Geometries whose position arrays are rewritten in place (cloth samples). Anything that caches a measurement of a
// geometry's positions must skip these, because the array identity stays the same while its values change.
const liveGeometries = new WeakSet();

export function markLiveGeometry(geometry) {
  liveGeometries.add(geometry);
  return geometry;
}

export function isLiveGeometry(geometry) {
  return liveGeometries.has(geometry);
}
