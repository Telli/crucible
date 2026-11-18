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

/** How far a rim vertex may stand out from a neighbour on one of its sides, per unit of edge length, before it counts as overhanging. */
const OVERHANG_SLOPE = 0.5;

/**
 * Vertices on an edge of a sharp box that stand out from a neighbour on one of their sides by more than OVERHANG_SLOPE
 * per unit of edge length: the rim juts past the side face next to it and the strip between them tilts toward its underside.
 */
export function overhangingEdgeVertices(box, displaced) {
  const onEdge = vertex => [0, 1, 2].filter(axis => Math.abs(box.positions[vertex * 3 + axis]) > 0.5 - 1e-6).length >= 2;
  const overhanging = new Set();
  for (let edge = 0; edge < box.edgeCount; edge++) {
    const pair = [box.edgeVertices[edge * 2], box.edgeVertices[edge * 2 + 1]];
    for (const [rim, neighbour] of [pair, [pair[1], pair[0]]]) {
      if (!onEdge(rim) || onEdge(neighbour)) continue;
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(box.positions[rim * 3 + axis]) < 0.5 - 1e-6 || box.positions[rim * 3 + axis] !== box.positions[neighbour * 3 + axis]) continue;
        const outward = Math.sign(box.positions[rim * 3 + axis]);
        const standOut = ((displaced.positions[rim * 3 + axis] - box.positions[rim * 3 + axis]) - (displaced.positions[neighbour * 3 + axis] - box.positions[neighbour * 3 + axis])) * outward;
        const length = Math.hypot(...[0, 1, 2].map(other => box.positions[rim * 3 + other] - box.positions[neighbour * 3 + other]));
        if (standOut > OVERHANG_SLOPE * length) overhanging.add(rim);
      }
    }
  }
  return overhanging.size;
}
