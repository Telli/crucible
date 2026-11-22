import { seededRandom } from './seeded-random.js';

// Ocean modifier: a deterministic spectrum displacement like Blender's Ocean modifier, without the FFT. The sea is a sum of
// travelling waves on a lattice of wave vectors, so the surface repeats exactly every `size` metres. Each wave has an
// amplitude from the Phillips spectrum for the wind (damped for the smallest waves), a seeded random gaussian and a seeded
// phase, and travels at the deep water speed, so the same seed and time give the same vertices on every run.
// The waves lift the up axis; `choppiness` also pulls vertices toward the crests along the horizontal axes. The squeeze of
// the surface (the Jacobian J of that horizontal move) becomes the vertex group `foam`.
//
// Foam is where J falls below a threshold (Tessendorf, "Simulating Ocean Water": J < 1 is a squeezed surface, J near 0 a crest
// about to break). The threshold is not a hand number: it is the J below which a fraction of the sea equals the whitecap
// coverage the wind gives, W = 3.84e-6 * U^3.41 (Monahan and O'Muircheartaigh 1980, U the wind at 10 m in m/s).
// `coverage` multiplies that fraction by FOAM_COVERAGE_BASE^coverage, so 0 is the physical sea.

const SIGNIFICANT_HEIGHT_PER_WIND_SQUARED = 0.21;
const FOAM_COVERAGE_BASE = 6;
const FOAM_RAMP = 0.2;
// A sea never foams at a J of 0.95 or more, so a flat sea (choppiness 0) has no foam whatever its wind.
const FOAM_MAX_THRESHOLD = 0.95;
const THRESHOLD_LATTICE = 32;
// Foam persists: it fades with an e-folding time `foamMemory` and is read from at most this many earlier moments,
// FOAM_MEMORY_STEP_FRACTION of that time apart (the last one is 4 e-folding times back, where 2 percent is left).
export const MAX_FOAM_MEMORY_SAMPLES = 8;
const FOAM_MEMORY_STEP_FRACTION = 0.5;
const CHANNEL_GAUSSIAN_RADIUS = 40;
const CHANNEL_GAUSSIAN_ANGLE = 41;
const CHANNEL_PHASE = 42;
const GRAVITY = 9.81;

function windSpectrum(waveNumber, alignment, windSpeed) {
  const largestWave = windSpeed * windSpeed / GRAVITY;
  const smallestWave = largestWave / 1000;
  const spectrum = Math.exp(-1 / (waveNumber * largestWave) ** 2) / waveNumber ** 4 * alignment * alignment;
  return spectrum * Math.exp(-((waveNumber * smallestWave) ** 2));
}

function gaussian(key, seed) {
  const radius = Math.sqrt(-2 * Math.log(Math.max(seededRandom(key, CHANNEL_GAUSSIAN_RADIUS, seed), 1e-12)));
  return radius * Math.cos(2 * Math.PI * seededRandom(key, CHANNEL_GAUSSIAN_ANGLE, seed));
}

/**
 * The waves of a sea: wave vector (waveX, waveZ along the two horizontal axes), amplitude, phase and angular frequency.
 * The amplitudes are scaled so the significant wave height (4 standard deviations of the height) is
 * 0.21 * windSpeed^2 / g, the height of a fully developed sea.
 */
export function oceanWaves({ windSpeed, direction, size, seed, resolution }) {
  const windX = Math.cos(direction * Math.PI / 180);
  const windZ = Math.sin(direction * Math.PI / 180);
  const waves = [];
  let variance = 0;
  const step = 2 * Math.PI / size;
  for (let row = -resolution; row <= resolution; row++) {
    for (let column = -resolution; column <= resolution; column++) {
      if (row === 0 && column === 0) continue;
      const waveX = column * step;
      const waveZ = row * step;
      const waveNumber = Math.hypot(waveX, waveZ);
      const alignment = (waveX * windX + waveZ * windZ) / waveNumber;
      const amplitude = Math.sqrt(windSpectrum(waveNumber, alignment, windSpeed)) * gaussian(waves.length, seed);
      variance += amplitude * amplitude / 2;
      waves.push({
        waveX, waveZ, waveNumber, amplitude, column, row,
        phase: seededRandom(waves.length, CHANNEL_PHASE, seed) * 2 * Math.PI,
        frequency: Math.sqrt(GRAVITY * waveNumber),
      });
    }
  }
  const targetHeight = SIGNIFICANT_HEIGHT_PER_WIND_SQUARED * windSpeed * windSpeed / GRAVITY / 4;
  const scale = variance > 0 ? targetHeight / Math.sqrt(variance) : 0;
  for (const wave of waves) wave.amplitude *= scale;
  return waves;
}

/** Fraction of the sea covered by whitecaps at a wind of `windSpeed` m/s at 10 m: Monahan and O'Muircheartaigh (1980), W = 3.84e-6 * U^3.41, at most 1. */
export function whitecapFraction(windSpeed) {
  return Math.min(1, 3.84e-6 * windSpeed ** 3.41);
}

function jacobianAt(waves, restX, restZ, time, choppiness) {
  let squeezeXX = 0;
  let squeezeZZ = 0;
  let squeezeXZ = 0;
  for (const wave of waves) {
    const angle = wave.waveX * restX + wave.waveZ * restZ - wave.frequency * time + wave.phase;
    const directionX = wave.waveX / wave.waveNumber;
    const directionZ = wave.waveZ / wave.waveNumber;
    const slope = choppiness * wave.amplitude * wave.waveNumber * Math.cos(angle);
    squeezeXX -= directionX * directionX * slope;
    squeezeZZ -= directionZ * directionZ * slope;
    squeezeXZ -= directionX * directionZ * slope;
  }
  return (1 + squeezeXX) * (1 + squeezeZZ) - squeezeXZ * squeezeXZ;
}

/** The Jacobian below which `whitecapFraction(windSpeed) * 6^coverage` of the sea lies, measured on a lattice of rest points over one `size` at time 0 so it does not change from frame to frame. */
export function oceanFoamThreshold(waves, { windSpeed, size, choppiness, coverage = 0 }) {
  const wanted = Math.min(1, whitecapFraction(windSpeed) * FOAM_COVERAGE_BASE ** coverage);
  const samples = [];
  for (let row = 0; row < THRESHOLD_LATTICE; row++) {
    for (let column = 0; column < THRESHOLD_LATTICE; column++) {
      samples.push(jacobianAt(waves, column * size / THRESHOLD_LATTICE, row * size / THRESHOLD_LATTICE, 0, choppiness));
    }
  }
  samples.sort((low, high) => low - high);
  const index = Math.min(samples.length - 1, Math.floor(wanted * samples.length));
  return Math.min(FOAM_MAX_THRESHOLD, samples[index]);
}

/** Foam 0 to 1 for a Jacobian: half at the threshold, full half a ramp below it. */
export function foamFromJacobian(jacobian, threshold) {
  return Math.min(1, Math.max(0, (threshold + FOAM_RAMP / 2 - jacobian) / FOAM_RAMP));
}

/** Foam that remembers the sea: the strongest of the foam now and the foam of up to 8 earlier moments, each faded by exp(-age / foamMemory). Never below `foamNow`, never above 1. */
export function oceanFoamWithMemory(waves, restX, restZ, time, choppiness, threshold, foamMemory, foamNow) {
  if (!(foamMemory > 0)) return foamNow;
  const step = foamMemory * FOAM_MEMORY_STEP_FRACTION;
  let foam = foamNow;
  for (let age = 1; age <= MAX_FOAM_MEMORY_SAMPLES; age++) {
    const fade = Math.exp(-age * FOAM_MEMORY_STEP_FRACTION);
    if (fade <= foam) break;
    const earlier = foamFromJacobian(jacobianAt(waves, restX, restZ, time - age * step, choppiness), threshold) * fade;
    if (earlier > foam) foam = earlier;
  }
  return foam;
}

/** Height, horizontal move and foam of the sea at one rest point and time, and the velocity of the surface there (`riseSpeed` up, `driftX` and `driftZ` along the horizontal axes); `foamThreshold` (from oceanFoamThreshold) is the Jacobian that counts as foam, and without it nothing foams. */
export function oceanSurfaceAt(waves, restX, restZ, time, choppiness, foamThreshold = -Infinity) {
  let height = 0;
  let moveX = 0;
  let moveZ = 0;
  let squeezeXX = 0;
  let squeezeZZ = 0;
  let squeezeXZ = 0;
  let riseSpeed = 0;
  let driftX = 0;
  let driftZ = 0;
  for (const wave of waves) {
    const angle = wave.waveX * restX + wave.waveZ * restZ - wave.frequency * time + wave.phase;
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    const directionX = wave.waveX / wave.waveNumber;
    const directionZ = wave.waveZ / wave.waveNumber;
    height += wave.amplitude * cosine;
    // Time derivatives of the height and of the choppy move: how fast the surface itself travels at this point.
    riseSpeed += wave.amplitude * wave.frequency * sine;
    driftX += choppiness * directionX * wave.amplitude * wave.frequency * cosine;
    driftZ += choppiness * directionZ * wave.amplitude * wave.frequency * cosine;
    moveX -= choppiness * directionX * wave.amplitude * sine;
    moveZ -= choppiness * directionZ * wave.amplitude * sine;
    const slope = choppiness * wave.amplitude * wave.waveNumber * cosine;
    squeezeXX -= directionX * directionX * slope;
    squeezeZZ -= directionZ * directionZ * slope;
    squeezeXZ -= directionX * directionZ * slope;
  }
  const jacobian = (1 + squeezeXX) * (1 + squeezeZZ) - squeezeXZ * squeezeXZ;
  return { height, moveX, moveZ, jacobian, foam: foamFromJacobian(jacobian, foamThreshold), riseSpeed, driftX, driftZ };
}

// Batch path for a whole mesh. Wave vectors sit on a lattice (waveX = column * step, waveZ = row * step), so sin and cos
// of the spatial angle of a wave come from one table per distinct column and one per distinct row (angle addition), and
// sin and cos of the time and phase term come once per wave and moment. A point then costs a few multiplications per
// wave instead of a sin and a cos. The sums are those of oceanSurfaceAt, equal up to rounding.

function phaseTable(batch, time) {
  const { waveCount, frequency, phase } = batch;
  const sine = new Float64Array(waveCount);
  const cosine = new Float64Array(waveCount);
  for (let index = 0; index < waveCount; index++) {
    const angle = phase[index] - frequency[index] * time;
    sine[index] = Math.sin(angle);
    cosine[index] = Math.cos(angle);
  }
  return { sine, cosine };
}

function latticeReach(waves, indexOf) {
  let reach = 0;
  for (const wave of waves) reach = Math.max(reach, Math.abs(indexOf(wave)));
  return reach;
}

// The lattice step as the farthest wave of an axis gives it, where the division is the most exact.
function latticeStep(waves, indexOf, valueOf, reach) {
  const farthest = waves.find((wave) => Math.abs(indexOf(wave)) === reach);
  return farthest && reach > 0 ? valueOf(farthest) / indexOf(farthest) : 0;
}

/** Per-call tables for evaluating `waves` at many rest points at one time: wave constants, lattice tables and the time terms. With `foamMemory > 0` it also holds the time terms of the earlier moments that oceanBatchFoamWithMemory reads. With `withVelocity` false, oceanBatchSurface leaves `riseSpeed`, `driftX` and `driftZ` at 0 and skips their sums; every other field is the same. */
export function prepareOceanBatch(waves, time, choppiness, foamMemory = 0, withVelocity = true) {
  const waveCount = waves.length;
  const columnReach = latticeReach(waves, (wave) => wave.column);
  const rowReach = latticeReach(waves, (wave) => wave.row);
  const batch = {
    waveCount,
    columnReach,
    rowReach,
    columnStep: latticeStep(waves, (wave) => wave.column, (wave) => wave.waveX, columnReach),
    rowStep: latticeStep(waves, (wave) => wave.row, (wave) => wave.waveZ, rowReach),
    columnAt: new Int32Array(waveCount),
    rowAt: new Int32Array(waveCount),
    columnSine: new Float64Array(2 * columnReach + 1),
    columnCosine: new Float64Array(2 * columnReach + 1),
    rowSine: new Float64Array(2 * rowReach + 1),
    rowCosine: new Float64Array(2 * rowReach + 1),
    frequency: new Float64Array(waveCount),
    phase: new Float64Array(waveCount),
    amplitude: new Float64Array(waveCount),
    amplitudeFrequency: new Float64Array(waveCount),
    moveX: new Float64Array(waveCount),
    moveZ: new Float64Array(waveCount),
    driftX: new Float64Array(waveCount),
    driftZ: new Float64Array(waveCount),
    slopeXX: new Float64Array(waveCount),
    slopeZZ: new Float64Array(waveCount),
    slopeXZ: new Float64Array(waveCount),
    moments: [],
    now: null,
    foamMemory,
    withVelocity,
  };
  for (let index = 0; index < waveCount; index++) {
    const wave = waves[index];
    const directionX = wave.waveX / wave.waveNumber;
    const directionZ = wave.waveZ / wave.waveNumber;
    const chopSlope = choppiness * wave.amplitude * wave.waveNumber;
    batch.frequency[index] = wave.frequency;
    batch.phase[index] = wave.phase;
    batch.amplitude[index] = wave.amplitude;
    batch.amplitudeFrequency[index] = wave.amplitude * wave.frequency;
    batch.columnAt[index] = wave.column + columnReach;
    batch.rowAt[index] = wave.row + rowReach;
    batch.moveX[index] = choppiness * directionX * wave.amplitude;
    batch.moveZ[index] = choppiness * directionZ * wave.amplitude;
    batch.driftX[index] = choppiness * directionX * wave.amplitude * wave.frequency;
    batch.driftZ[index] = choppiness * directionZ * wave.amplitude * wave.frequency;
    batch.slopeXX[index] = directionX * directionX * chopSlope;
    batch.slopeZZ[index] = directionZ * directionZ * chopSlope;
    batch.slopeXZ[index] = directionX * directionZ * chopSlope;
  }
  batch.now = phaseTable(batch, time);
  if (foamMemory > 0) {
    const step = foamMemory * FOAM_MEMORY_STEP_FRACTION;
    for (let age = 1; age <= MAX_FOAM_MEMORY_SAMPLES; age++) batch.moments.push(phaseTable(batch, time - age * step));
  }
  return batch;
}

// sin and cos of index * stepAngle for index -reach..reach, by rotating one unit step: two trig pairs per axis and point.
function fillRotationTable(sineTable, cosineTable, reach, stepAngle) {
  const unitSine = Math.sin(stepAngle);
  const unitCosine = Math.cos(stepAngle);
  let sine = 0;
  let cosine = 1;
  sineTable[reach] = 0;
  cosineTable[reach] = 1;
  for (let index = 1; index <= reach; index++) {
    const nextSine = sine * unitCosine + cosine * unitSine;
    cosine = cosine * unitCosine - sine * unitSine;
    sine = nextSine;
    sineTable[reach + index] = sine;
    cosineTable[reach + index] = cosine;
    sineTable[reach - index] = -sine;
    cosineTable[reach - index] = cosine;
  }
}

/** Load the spatial sin and cos tables for one rest point; call before oceanBatchSurface or oceanBatchFoamWithMemory at that point. */
export function setOceanBatchPoint(batch, restX, restZ) {
  fillRotationTable(batch.columnSine, batch.columnCosine, batch.columnReach, batch.columnStep * restX);
  fillRotationTable(batch.rowSine, batch.rowCosine, batch.rowReach, batch.rowStep * restZ);
}

/** The same fields as oceanSurfaceAt at the point set by setOceanBatchPoint, written into `result` (reused, no allocation). */
export function oceanBatchSurface(batch, result, foamThreshold = -Infinity) {
  const { waveCount, columnAt, rowAt, columnSine, columnCosine, rowSine, rowCosine } = batch;
  const { amplitude, amplitudeFrequency, moveX: moveXCoefficient, moveZ: moveZCoefficient, driftX: driftXCoefficient, driftZ: driftZCoefficient } = batch;
  const { slopeXX, slopeZZ, slopeXZ } = batch;
  const { sine: phaseSine, cosine: phaseCosine } = batch.now;
  const { withVelocity } = batch;
  let height = 0;
  let moveX = 0;
  let moveZ = 0;
  let squeezeXX = 0;
  let squeezeZZ = 0;
  let squeezeXZ = 0;
  let riseSpeed = 0;
  let driftX = 0;
  let driftZ = 0;
  for (let index = 0; index < waveCount; index++) {
    const columnSlot = columnAt[index];
    const rowSlot = rowAt[index];
    const spatialSine = columnSine[columnSlot] * rowCosine[rowSlot] + columnCosine[columnSlot] * rowSine[rowSlot];
    const spatialCosine = columnCosine[columnSlot] * rowCosine[rowSlot] - columnSine[columnSlot] * rowSine[rowSlot];
    const sine = spatialSine * phaseCosine[index] + spatialCosine * phaseSine[index];
    const cosine = spatialCosine * phaseCosine[index] - spatialSine * phaseSine[index];
    height += amplitude[index] * cosine;
    if (withVelocity) {
      riseSpeed += amplitudeFrequency[index] * sine;
      driftX += driftXCoefficient[index] * cosine;
      driftZ += driftZCoefficient[index] * cosine;
    }
    moveX -= moveXCoefficient[index] * sine;
    moveZ -= moveZCoefficient[index] * sine;
    squeezeXX -= slopeXX[index] * cosine;
    squeezeZZ -= slopeZZ[index] * cosine;
    squeezeXZ -= slopeXZ[index] * cosine;
  }
  const jacobian = (1 + squeezeXX) * (1 + squeezeZZ) - squeezeXZ * squeezeXZ;
  result.height = height;
  result.moveX = moveX;
  result.moveZ = moveZ;
  result.jacobian = jacobian;
  result.foam = foamFromJacobian(jacobian, foamThreshold);
  result.riseSpeed = riseSpeed;
  result.driftX = driftX;
  result.driftZ = driftZ;
  return result;
}

function batchJacobian(batch, phaseTerms) {
  const { waveCount, columnAt, rowAt, columnSine, columnCosine, rowSine, rowCosine, slopeXX, slopeZZ, slopeXZ } = batch;
  const { sine: phaseSine, cosine: phaseCosine } = phaseTerms;
  let squeezeXX = 0;
  let squeezeZZ = 0;
  let squeezeXZ = 0;
  for (let index = 0; index < waveCount; index++) {
    const columnSlot = columnAt[index];
    const rowSlot = rowAt[index];
    const spatialSine = columnSine[columnSlot] * rowCosine[rowSlot] + columnCosine[columnSlot] * rowSine[rowSlot];
    const spatialCosine = columnCosine[columnSlot] * rowCosine[rowSlot] - columnSine[columnSlot] * rowSine[rowSlot];
    const cosine = spatialCosine * phaseCosine[index] - spatialSine * phaseSine[index];
    squeezeXX -= slopeXX[index] * cosine;
    squeezeZZ -= slopeZZ[index] * cosine;
    squeezeXZ -= slopeXZ[index] * cosine;
  }
  return (1 + squeezeXX) * (1 + squeezeZZ) - squeezeXZ * squeezeXZ;
}

/** oceanFoamWithMemory at the point set by setOceanBatchPoint, with the batch prepared for the same `foamMemory`. */
export function oceanBatchFoamWithMemory(batch, threshold, foamNow) {
  if (!(batch.foamMemory > 0)) return foamNow;
  let foam = foamNow;
  for (let age = 1; age <= MAX_FOAM_MEMORY_SAMPLES; age++) {
    const fade = Math.exp(-age * FOAM_MEMORY_STEP_FRACTION);
    if (fade <= foam) break;
    const earlier = foamFromJacobian(batchJacobian(batch, batch.moments[age - 1]), threshold) * fade;
    if (earlier > foam) foam = earlier;
  }
  return foam;
}
