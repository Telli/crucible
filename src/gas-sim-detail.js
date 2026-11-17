// Fine detail for a baked gas frame (#1735): a noise upres of the smoke density, applied to each snapshot only. Blender gets the same effect from a
// noise pass on a coarse sim (wavelet turbulence, Kim et al. 2008): the solver keeps its motion and the frame gains puffs and gaps smaller than the
// grid resolves. The solver never reads the modulated frame back. Deterministic for a seed and a frame index.

const LARGE_PUFF_CELLS = 5;
const SMALL_PUFF_CELLS = 2.5;
const SMALL_PUFF_WEIGHT = 0.5;
const RISE_CELLS_PER_FRAME = 0.15;

// A hash of a lattice point to -0.5..0.5.
function latticeSigned(seed, x, y, z) {
  let hash = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1)) | 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296 - 0.5;
}

function smoothFraction(value) {
  return value * value * (3 - 2 * value);
}

function signedNoise(seed, x, y, z) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = smoothFraction(x - x0);
  const fy = smoothFraction(y - y0);
  const fz = smoothFraction(z - z0);
  const corner = (dx, dy, dz) => latticeSigned(seed, x0 + dx, y0 + dy, z0 + dz);
  const lowY = (1 - fx) * ((1 - fz) * corner(0, 0, 0) + fz * corner(0, 0, 1)) + fx * ((1 - fz) * corner(1, 0, 0) + fz * corner(1, 0, 1));
  const highY = (1 - fx) * ((1 - fz) * corner(0, 1, 0) + fz * corner(0, 1, 1)) + fx * ((1 - fz) * corner(1, 1, 0) + fz * corner(1, 1, 1));
  return (1 - fy) * lowY + fy * highY;
}

// Two octaves, about -0.5..0.5, rising with the frame so the puffs drift up with the smoke instead of standing still.
function puffNoise(seed, x, y, z, rise) {
  const large = signedNoise(seed, x / LARGE_PUFF_CELLS, (y - rise) / LARGE_PUFF_CELLS, z / LARGE_PUFF_CELLS);
  const small = signedNoise(seed + 7919, x / SMALL_PUFF_CELLS, (y - rise) / SMALL_PUFF_CELLS, z / SMALL_PUFF_CELLS);
  return (large + SMALL_PUFF_WEIGHT * small) / (1 + SMALL_PUFF_WEIGHT);
}

/**
 * Returns a copy of `channels` ({ density, temperature, flame, ... }) whose density is multiplied by 1 + 4 * detail * noise, so a thin edge breaks
 * into puffs and gaps and a dense core only mottles. The noise has zero mean: the smoke mass stays close to the sim's. Empty cells stay empty.
 * `detail` is 0 to 1; 0 returns the channels untouched.
 */
export function addGasDetail(channels, resolution, detail, seed, frameIndex) {
  if (detail === 0) return channels;
  const [nx, ny, nz] = resolution;
  const density = new Float32Array(channels.density.length);
  const rise = frameIndex * RISE_CELLS_PER_FRAME;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const index = x + nx * (y + ny * z);
        const source = channels.density[index];
        if (source === 0) continue;
        density[index] = source * Math.max(1 + 4 * detail * puffNoise(seed, x, y, z, rise), 0);
      }
    }
  }
  return { ...channels, density };
}
