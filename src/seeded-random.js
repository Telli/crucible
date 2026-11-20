// Integer hashing keeps seeded results identical on every platform.

export function hashCell(cellX, cellY, cellZ, seed) {
  let hash = Math.imul(cellX, 0x27d4eb2d) ^ Math.imul(cellY, 0x165667b1) ^ Math.imul(cellZ, 0x85ebca77) ^ Math.imul(seed, 0x9e3779b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

/** Per-element random number in 0 to 1 from a whole-number key and a seed. */
export function seededRandom(key, channel, seed) {
  return hashCell(key, channel, 0, seed);
}

/** Returns `value` when it is a finite number, else throws an error that names the field. NaN and Infinity would silently hash like seed 0. */
export function requireSeed(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number such as 1.`);
  return value;
}

/** Returns `value` when it is a whole number from -2147483648 to 4294967295, else throws. A fraction or a number outside 32 bits would repeat another seed's sequence. */
export function requireWholeSeed(value, label) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0xffffffff) throw new RangeError(`${label} must be a whole number from -2147483648 to 4294967295; pass e.g. 1.`);
  return value;
}
