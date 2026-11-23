// A JavaScript port of the wetness shader's noise and depth field (src/wetness-shader.js on the near ground, where nothing fades),
// so a test can count how much ground the shader's puddles cover without a GPU.

function wearCellHash(cellX, cellY, cellZ) {
  const latticeX = (Math.floor(cellX) + 32768) >>> 0;
  const latticeY = (Math.floor(cellY) + 32768) >>> 0;
  const latticeZ = (Math.floor(cellZ) + 32768) >>> 0;
  let bits = (Math.imul(latticeX, 1597334673) ^ Math.imul(latticeY, 3812015801) ^ Math.imul(latticeZ, 2798796415)) >>> 0;
  bits = Math.imul((bits ^ (bits >>> 16)) >>> 0, 2246822519) >>> 0;
  bits = Math.imul((bits ^ (bits >>> 13)) >>> 0, 3266489917) >>> 0;
  bits = (bits ^ (bits >>> 16)) >>> 0;
  return (bits >>> 8) / 16777215;
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}

export function wearNoise(x, y, z) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const cellZ = Math.floor(z);
  const smooth = value => value * value * (3 - 2 * value);
  const blendX = smooth(x - cellX);
  const blendY = smooth(y - cellY);
  const blendZ = smooth(z - cellZ);
  const plane = offsetZ => mix(
    mix(wearCellHash(cellX, cellY, cellZ + offsetZ), wearCellHash(cellX + 1, cellY, cellZ + offsetZ), blendX),
    mix(wearCellHash(cellX, cellY + 1, cellZ + offsetZ), wearCellHash(cellX + 1, cellY + 1, cellZ + offsetZ), blendX),
    blendY,
  );
  return mix(plane(0), plane(1), blendZ);
}

export function wetBasin(x, z) {
  const warpX = wearNoise(x * 1.1, 9.3, z * 1.1) - 0.5;
  const warpZ = wearNoise(x * 1.1 + 31, 2.7, z * 1.1) - 0.5;
  const planeX = (x + 0.9 * warpX) * 0.55;
  const planeZ = (z + 0.9 * warpZ) * 0.55;
  const broad = 0.8 * wearNoise(planeX, 3.7, planeZ) + 0.2 * wearNoise(planeX * 2.3 + 17, 3.7 * 2.3 + 17, planeZ * 2.3 + 17);
  const fine = wearNoise(x * 6, 1.9, z * 6) - 0.5;
  return broad + 0.1 * fine;
}

/** The depth of water at a ground point: positive under water. `groundHeight` is the height of the ground plane (the uniform's fourth value). */
export function puddleDepth(x, y, z, fillLevel, groundHeight) {
  const basinDepth = wetBasin(x, z) - fillLevel - 6 * (y - groundHeight);
  return basinDepth - 0.012 * (wearNoise(x * 90, y * 90, z * 90) - 0.5);
}

/** The share of a flat square of ground, `size` metres wide at `groundHeight`, that is under water at the fill level. */
export function measurePuddleShare(fillLevel, { size = 120, step = 0.3, groundHeight = 0 } = {}) {
  let wet = 0;
  let total = 0;
  for (let x = 0; x < size; x += step) {
    for (let z = 0; z < size; z += step) {
      total++;
      if (puddleDepth(x + 7.13, groundHeight, z + 3.71, fillLevel, groundHeight) > 0) wet++;
    }
  }
  return wet / total;
}
