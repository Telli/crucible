// View-dependent colour of a gaussian splat: the spherical harmonic bands above the constant one (#2734). A 3DGS PLY stores
// them as f_rest_*; degree 1, 2 and 3 carry 3, 8 and 15 coefficients per colour channel. The basis, its constants and
// signs are the ones the original 3DGS code renders with, so a trained file shows the colours it was trained to show.
// Coefficients are kept per splat as [coefficient][red, green, blue] and travel to the GPU as half floats.

export const SPHERICAL_HARMONIC_MAXIMUM_DEGREE = 3;

/** Coefficients per colour channel above the constant band, by degree: 0, 3, 8, 15. */
export function harmonicCoefficientsPerChannel(degree) {
  return (degree + 1) * (degree + 1) - 1;
}

const BAND_ONE = 0.4886025119029199;
const BAND_TWO = [1.0925484305920792, -1.0925484305920792, 0.31539156525252005, -1.0925484305920792, 0.5462742152960396];
const BAND_THREE = [-0.5900435899266435, 2.890611442640554, -0.4570457994644658, 0.3731763325901154, -0.4570457994644658, 1.445305721320277, -0.5900435899266435];

/** The basis values above the constant band for the unit direction (x, y, z), `harmonicCoefficientsPerChannel(degree)` of them. */
export function harmonicBasis(degree, x, y, z) {
  const values = [-BAND_ONE * y, BAND_ONE * z, -BAND_ONE * x];
  if (degree < 2) return values;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  values.push(BAND_TWO[0] * x * y, BAND_TWO[1] * y * z, BAND_TWO[2] * (2 * zz - xx - yy), BAND_TWO[3] * x * z, BAND_TWO[4] * (xx - yy));
  if (degree < 3) return values;
  values.push(
    BAND_THREE[0] * y * (3 * xx - yy),
    BAND_THREE[1] * x * y * z,
    BAND_THREE[2] * y * (4 * zz - xx - yy),
    BAND_THREE[3] * z * (2 * zz - 3 * xx - 3 * yy),
    BAND_THREE[4] * x * (4 * zz - xx - yy),
    BAND_THREE[5] * z * (xx - yy),
    BAND_THREE[6] * x * (xx - 3 * yy));
  return values;
}

/**
 * The colour the bands add for splat `index` seen along the unit direction from the eye to the splat centre, as
 * [red, green, blue]. The splat shader adds the same sum to the constant colour and clamps it at zero.
 */
export function evaluateSplatHarmonics(harmonics, index, direction) {
  const perChannel = harmonicCoefficientsPerChannel(harmonics.degree);
  const basis = harmonicBasis(harmonics.degree, direction[0], direction[1], direction[2]);
  const sum = [0, 0, 0];
  const base = index * perChannel * 3;
  for (let coefficient = 0; coefficient < perChannel; coefficient++) {
    for (let channel = 0; channel < 3; channel++) sum[channel] += basis[coefficient] * harmonics.coefficients[base + coefficient * 3 + channel];
  }
  return sum;
}

// Bands of each degree, as [first coefficient, coefficient count] within the per-channel list.
const BANDS = [[0, 3], [3, 5], [8, 7]];

// Directions to fit each band's rotation on: any set whose basis matrix is invertible works; these are fixed and spread out.
function sampleDirections(count) {
  const directions = [];
  for (let sample = 0; sample < count; sample++) {
    const height = 1 - (2 * (sample + 0.5)) / count;
    const ring = Math.sqrt(1 - height * height);
    const angle = sample * 2.399963229728653;
    directions.push([ring * Math.cos(angle), height, ring * Math.sin(angle)]);
  }
  return directions;
}

// Solves A M = B for M by Gauss-Jordan elimination with partial pivoting; A is square and invertible.
function solveSquare(matrixA, matrixB) {
  const size = matrixA.length;
  const left = matrixA.map(row => [...row]);
  const right = matrixB.map(row => [...row]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) if (Math.abs(left[row][column]) > Math.abs(left[pivot][column])) pivot = row;
    [left[column], left[pivot]] = [left[pivot], left[column]];
    [right[column], right[pivot]] = [right[pivot], right[column]];
    const scale = left[column][column];
    for (let entry = 0; entry < size; entry++) {
      left[column][entry] /= scale;
      right[column][entry] /= scale;
    }
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = left[row][column];
      for (let entry = 0; entry < size; entry++) {
        left[row][entry] -= factor * left[column][entry];
        right[row][entry] -= factor * right[column][entry];
      }
    }
  }
  return right;
}

// For each band, the matrix that turns coefficients in the file's frame into the frame after `turn`: the new function at
// direction d equals the old one at the direction `turn` sent to d. `inverseTurn` maps a direction back to the file frame.
// Fitted by least squares over many directions (the normal equations), since a few directions can leave A singular.
function bandRotations(inverseTurn) {
  const directions = sampleDirections(64);
  return BANDS.map(([first, count]) => {
    const turnedBasis = directions.map(direction => harmonicBasis(3, ...direction).slice(first, first + count));
    const fileBasis = directions.map(direction => harmonicBasis(3, ...inverseTurn(direction)).slice(first, first + count));
    const product = (left, right) => Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, column) => left.reduce((sum, sample, index) => sum + sample[row] * right[index][column], 0)));
    return solveSquare(product(turnedBasis, turnedBasis), product(turnedBasis, fileBasis));
  });
}

let zUpRotations = null;

/**
 * Turns the coefficients of one splat, `perChannel` per channel starting at `offset`, by -90 degrees about x in place, the
 * turn `upAxis: 'z'` gives positions: the file's +z comes out on +y.
 */
export function turnHarmonicsZUpToYUp(coefficients, offset, degree) {
  // The turn sends (x, y, z) to (x, z, -y), so a turned direction (x, y, z) came from (x, -z, y).
  zUpRotations ??= bandRotations(([x, y, z]) => [x, -z, y]);
  for (let band = 0; band < degree; band++) {
    const [first, count] = BANDS[band];
    const rotation = zUpRotations[band];
    for (let channel = 0; channel < 3; channel++) {
      const original = [];
      for (let entry = 0; entry < count; entry++) original.push(coefficients[offset + (first + entry) * 3 + channel]);
      for (let row = 0; row < count; row++) {
        let value = 0;
        for (let entry = 0; entry < count; entry++) value += rotation[row][entry] * original[entry];
        coefficients[offset + (first + row) * 3 + channel] = value;
      }
    }
  }
}

const halfConversionFloat = new Float32Array(1);
const halfConversionBits = new Uint32Array(halfConversionFloat.buffer);

/** The IEEE half float bits nearest to `value`, rounding to even; values past the half range become infinity. */
export function toHalfFloatBits(value) {
  halfConversionFloat[0] = value;
  const bits = halfConversionBits[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  const mantissa = bits & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
  const halfExponent = exponent - 127 + 15;
  if (halfExponent >= 0x1f) return sign | 0x7c00;
  if (halfExponent <= 0) {
    if (halfExponent < -10) return sign;
    const fullMantissa = mantissa | 0x800000;
    const shift = 14 - halfExponent;
    const rounded = (fullMantissa >>> shift) + roundsUp(fullMantissa, shift);
    return sign | rounded;
  }
  const rounded = (halfExponent << 10) + (mantissa >>> 13) + roundsUp(mantissa, 13);
  return sign | rounded;
}

// Round half to even on the bits shifted out.
function roundsUp(value, shift) {
  const remainder = value & ((1 << shift) - 1);
  const half = 1 << (shift - 1);
  if (remainder > half) return 1;
  if (remainder < half) return 0;
  return (value >>> shift) & 1;
}

/** The float a half float's bits stand for. */
export function fromHalfFloatBits(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa ? Number.NaN : sign * Infinity;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

/**
 * Texels of four 32-bit words each that one splat takes as half floats, two per word: its coefficients, then the red, green
 * and blue its constant colour lost to the 0 to 1 bytes (the colour overflow), so a highlight brighter than white that a band
 * darkens from some views keeps its trained colour.
 */
export function harmonicTexelsPerSplat(degree) {
  return Math.ceil(Math.ceil((harmonicCoefficientsPerChannel(degree) * 3 + 3) / 2) / 4);
}

// The vertex shader part: reads up to 48 half floats (six texels) for the splat and returns the colour overflow plus the
// bands for the view direction. `harmonicDegree` 0 skips it, so splats without bands cost one uniform test.
export const HARMONIC_SHADER_SOURCE = `uniform usampler2D harmonicData;
uniform int harmonicDegree;
uniform int harmonicTexels;
uniform vec3 eyeModel;
vec3 harmonicCoefficient(float values[48], int index) {
  return vec3(values[index * 3], values[index * 3 + 1], values[index * 3 + 2]);
}
vec3 harmonicColor(uint splat, vec3 direction) {
  float values[48];
  for (int texel = 0; texel < 6; texel++) {
    if (texel >= harmonicTexels) break;
    uint linear = splat * uint(harmonicTexels) + uint(texel);
    uvec4 words = texelFetch(harmonicData, ivec2(int(linear & 2047u), int(linear >> 11)), 0);
    for (int word = 0; word < 4; word++) {
      vec2 pair = unpackHalf2x16(words[word]);
      values[texel * 8 + word * 2] = pair.x;
      values[texel * 8 + word * 2 + 1] = pair.y;
    }
  }
  float x = direction.x;
  float y = direction.y;
  float z = direction.z;
  int perChannel = (harmonicDegree + 1) * (harmonicDegree + 1) - 1;
  vec3 color = harmonicCoefficient(values, perChannel);
  color += ${BAND_ONE} * (-y * harmonicCoefficient(values, 0) + z * harmonicCoefficient(values, 1) - x * harmonicCoefficient(values, 2));
  if (harmonicDegree < 2) return color;
  float xx = x * x;
  float yy = y * y;
  float zz = z * z;
  color += ${BAND_TWO[0]} * x * y * harmonicCoefficient(values, 3)
    + ${BAND_TWO[1]} * y * z * harmonicCoefficient(values, 4)
    + ${BAND_TWO[2]} * (2.0 * zz - xx - yy) * harmonicCoefficient(values, 5)
    + ${BAND_TWO[3]} * x * z * harmonicCoefficient(values, 6)
    + ${BAND_TWO[4]} * (xx - yy) * harmonicCoefficient(values, 7);
  if (harmonicDegree < 3) return color;
  color += ${BAND_THREE[0]} * y * (3.0 * xx - yy) * harmonicCoefficient(values, 8)
    + ${BAND_THREE[1]} * x * y * z * harmonicCoefficient(values, 9)
    + ${BAND_THREE[2]} * y * (4.0 * zz - xx - yy) * harmonicCoefficient(values, 10)
    + ${BAND_THREE[3]} * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * harmonicCoefficient(values, 11)
    + ${BAND_THREE[4]} * x * (4.0 * zz - xx - yy) * harmonicCoefficient(values, 12)
    + ${BAND_THREE[5]} * z * (xx - yy) * harmonicCoefficient(values, 13)
    + ${BAND_THREE[6]} * x * (xx - 3.0 * yy) * harmonicCoefficient(values, 14);
  return color;
}`;
