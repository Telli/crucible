import { meshFromGeometry } from '../../src/mesh.js';

/** A unit box with sharp edges, each face cut into spans by spans quads, welded into one closed mesh (6 * spans^2 + 2 vertices). */
export function sharpSubdividedBox(spans) {
  const positions = [];
  const indices = [];
  for (let face = 0; face < 6; face++) {
    const axis = Math.floor(face / 2);
    const sign = face % 2 === 0 ? -1 : 1;
    const base = positions.length / 3;
    for (let row = 0; row <= spans; row++) {
      for (let column = 0; column <= spans; column++) {
        const point = [0, 0, 0];
        point[axis] = sign * 0.5;
        point[(axis + 1) % 3] = column / spans - 0.5;
        point[(axis + 2) % 3] = row / spans - 0.5;
        positions.push(...point);
      }
    }
    const stride = spans + 1;
    for (let row = 0; row < spans; row++) {
      for (let column = 0; column < spans; column++) {
        const corner = base + row * stride + column;
        const quad = sign > 0 ? [corner, corner + 1, corner + stride + 1, corner + stride] : [corner, corner + stride, corner + stride + 1, corner + 1];
        indices.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
      }
    }
  }
  return meshFromGeometry({ positions: new Float32Array(positions), indices: new Uint32Array(indices) });
}
