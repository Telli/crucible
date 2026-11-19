// A lamp mesh drawn around its own point light (a glowing bulb sphere around the lamp) is the lamp, not an obstacle to it (#2299).
// Without this rule the bulb blocks every shadow ray of its light and a lit room traces as dark as a closed box.

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** True when `point` lies inside the axis-aligned box of the part's vertices moved by its matrix. */
export function boundsHoldPoint({ geometry, matrix = IDENTITY }, point) {
  const source = geometry.positions;
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < source.length; vertex += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const moved = matrix[axis] * source[vertex] + matrix[4 + axis] * source[vertex + 1] + matrix[8 + axis] * source[vertex + 2] + matrix[12 + axis];
      minimum[axis] = Math.min(minimum[axis], moved);
      maximum[axis] = Math.max(maximum[axis], moved);
    }
  }
  return [0, 1, 2].every(axis => point[axis] >= minimum[axis] && point[axis] <= maximum[axis]);
}

/**
 * One mask per part: bit `light.bit` is set when the part glows (`emits`) and its bounds hold that point light, so shadow rays of
 * the light pass through it. A part that does not glow, a shade or a wall, still blocks. Null when no part is such a lamp.
 * `lights` are the resolved point lights ({ bit, position }); `emits(part)` says whether a part glows.
 */
export function lampLightMasks(parts, lights, emits) {
  if (lights.length === 0) return null;
  const masks = new Uint32Array(parts.length);
  parts.forEach((part, index) => {
    if (!part.geometry?.positions || !emits(part)) return;
    for (const light of lights) {
      if (boundsHoldPoint(part, light.position)) masks[index] |= 1 << light.bit;
    }
  });
  return masks.some(mask => mask !== 0) ? masks : null;
}
