// Reads a standard 3D Gaussian splat PLY: the file written by the original 3DGS training code and by most tools that
// export splats. It is binary little endian with one vertex per splat and the properties x, y, z, f_dc_0 to f_dc_2,
// opacity, scale_0 to scale_2 and rot_0 to rot_3. Higher-order spherical harmonics (f_rest_*, degree 1 to 3) are read as
// well, so a splat changes colour with the view as it did in training (#2734); normals are skipped. Other splat formats
// (.spz, .ksplat, .splat) are not read here.

import { runInChunks } from './gaussian-splat-chunks.js';
import { harmonicCoefficientsPerChannel, SPHERICAL_HARMONIC_MAXIMUM_DEGREE, turnHarmonicsZUpToYUp } from './gaussian-splat-harmonics.js';

export const GAUSSIAN_SPLAT_LIMITS = Object.freeze({
  // A file this large cannot be read into memory safely in a browser tab.
  maximumBytes: 512 * 1024 * 1024,
  maximumCount: 2_000_000,
});
/** No option raises the splat count above this: the data texture then needs 192 MB of GPU memory. */
export const GAUSSIAN_SPLAT_HARD_COUNT_LIMIT = 4_000_000;

const REQUIRED_PROPERTIES = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
const SPHERICAL_HARMONIC_DC = 0.28209479177387814;
const HEADER_END_PATTERN = /end_header\r?\n/;
const MAXIMUM_HEADER_BYTES = 64 * 1024;

const PROPERTY_TYPES = {
  char: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
  int8: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
  uchar: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
  uint8: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
  short: { bytes: 2, read: (view, offset) => view.getInt16(offset, true) },
  int16: { bytes: 2, read: (view, offset) => view.getInt16(offset, true) },
  ushort: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
  uint16: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
  int: { bytes: 4, read: (view, offset) => view.getInt32(offset, true) },
  int32: { bytes: 4, read: (view, offset) => view.getInt32(offset, true) },
  uint: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
  uint32: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
  float: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
  float32: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
  double: { bytes: 8, read: (view, offset) => view.getFloat64(offset, true) },
  float64: { bytes: 8, read: (view, offset) => view.getFloat64(offset, true) },
};

function readHeaderText(bytes) {
  const searchLimit = Math.min(bytes.length, MAXIMUM_HEADER_BYTES);
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, searchLimit));
  const endMatch = HEADER_END_PATTERN.exec(text);
  if (text.startsWith('ply') && !endMatch && bytes.length > MAXIMUM_HEADER_BYTES) {
    throw new Error(`Gaussian splat PLY header is longer than ${MAXIMUM_HEADER_BYTES} bytes (64 KiB) or has no "end_header" line. Remove comment lines or re-export the file.`);
  }
  if (!text.startsWith('ply') || !endMatch) {
    throw new Error('Not a PLY file: the header must start with "ply" and end with "end_header"');
  }
  return { text: text.slice(0, endMatch.index), bodyStart: endMatch.index + endMatch[0].length };
}

function parseHeader(headerText) {
  const lines = headerText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const formatLine = lines.find(line => line.startsWith('format '));
  if (formatLine?.split(/\s+/)[1] !== 'binary_little_endian') {
    throw new Error(`Gaussian splat PLY must be binary_little_endian, got "${formatLine ?? 'no format line'}"`);
  }
  let vertexCount = 0;
  let inVertexElement = false;
  let vertexElementSeen = false;
  let skippedElement = null;
  let skippedBytes = 0;
  const properties = [];
  const finishSkippedElement = () => {
    if (skippedElement) skippedBytes += skippedElement.count * skippedElement.rowBytes;
    skippedElement = null;
  };
  for (const line of lines) {
    const words = line.split(/\s+/);
    if (words[0] === 'element') {
      finishSkippedElement();
      inVertexElement = words[1] === 'vertex' && !vertexElementSeen;
      if (inVertexElement) {
        vertexElementSeen = true;
        vertexCount = Number(words[2]);
      } else if (!vertexElementSeen) {
        const count = Number(words[2]);
        if (!Number.isInteger(count) || count < 0) {
          throw new Error(`Gaussian splat PLY element "${words[1]}" before "vertex" has an invalid count "${words[2]}". Re-export the file.`);
        }
        skippedElement = { name: words[1], count, rowBytes: 0 };
      }
    } else if (words[0] === 'property' && skippedElement) {
      if (words[1] === 'list' || !PROPERTY_TYPES[words[1]]) {
        throw new Error(`Gaussian splat PLY element "${skippedElement.name}" before "vertex" has a variable-size or unsupported property, so its bytes cannot be skipped. Re-export the file with the vertex element first.`);
      }
      skippedElement.rowBytes += PROPERTY_TYPES[words[1]].bytes;
    } else if (words[0] === 'property' && inVertexElement) {
      if (words[1] === 'list' || !PROPERTY_TYPES[words[1]]) {
        throw new Error(`Gaussian splat PLY has an unsupported property type "${words[1]}"`);
      }
      properties.push({ name: words[2], type: words[1] });
    }
  }
  if (!Number.isInteger(vertexCount) || vertexCount <= 0) {
    throw new Error('Gaussian splat PLY has no vertex element with a positive count');
  }
  finishSkippedElement();
  return { vertexCount, properties, skippedBytes };
}

function propertyLayout(properties) {
  const layout = new Map();
  let offset = 0;
  for (const { name, type } of properties) {
    layout.set(name, { offset, read: PROPERTY_TYPES[type].read });
    offset += PROPERTY_TYPES[type].bytes;
  }
  const missing = REQUIRED_PROPERTIES.filter(name => !layout.has(name));
  if (missing.length > 0) {
    throw new Error(`Gaussian splat PLY lacks the properties ${missing.join(', ')}`);
  }
  return { layout, stride: offset };
}

// Degree of the f_rest_* bands a file holds: 3, 8, 15 or 24 coefficients per channel are degree 1 to 4.
const DEGREE_BY_PER_CHANNEL = new Map([[0, 0], [3, 1], [8, 2], [15, 3], [24, 4]]);

function fileHarmonicDegree(layout) {
  let restCount = 0;
  while (layout.has(`f_rest_${restCount}`)) restCount++;
  const degree = DEGREE_BY_PER_CHANNEL.get(restCount / 3);
  // Any other count is not a set of bands this reader knows, so the splats keep one colour, as before bands were read.
  if (degree === undefined) return { degree: 0, perChannel: 0 };
  return { degree, perChannel: restCount / 3 };
}

function resolveHarmonicDegree(options, caller) {
  const degree = options.sphericalHarmonicDegree ?? SPHERICAL_HARMONIC_MAXIMUM_DEGREE;
  if (!Number.isInteger(degree) || degree < 0 || degree > SPHERICAL_HARMONIC_MAXIMUM_DEGREE) {
    throw new RangeError(`${caller} sphericalHarmonicDegree must be a whole number from 0 (one colour from every direction) to ${SPHERICAL_HARMONIC_MAXIMUM_DEGREE} (the default, every band the file has), got ${String(degree)}`);
  }
  return degree;
}

// The f_rest fields to read, in [coefficient][channel] order: coefficient k of channel c is f_rest_(c * perChannel + k).
function harmonicFields(layout, options, caller) {
  const file = fileHarmonicDegree(layout);
  const degree = Math.min(file.degree, resolveHarmonicDegree(options, caller));
  const fields = [];
  for (let coefficient = 0; coefficient < harmonicCoefficientsPerChannel(degree); coefficient++) {
    for (let channel = 0; channel < 3; channel++) fields.push(layout.get(`f_rest_${channel * file.perChannel + coefficient}`));
  }
  return { degree, fields };
}

export function resolveLimits(options) {
  const maximumBytes = options.maximumBytes ?? GAUSSIAN_SPLAT_LIMITS.maximumBytes;
  const maximumCount = options.maximumCount ?? GAUSSIAN_SPLAT_LIMITS.maximumCount;
  if (!(maximumBytes > 0) || !(maximumCount > 0)) {
    throw new RangeError('maximumBytes and maximumCount must be positive');
  }
  return { maximumBytes, maximumCount: Math.min(maximumCount, GAUSSIAN_SPLAT_HARD_COUNT_LIMIT) };
}

function toByte(unit) {
  return Math.max(0, Math.min(255, Math.round(unit * 255)));
}

/**
 * Parses a standard 3DGS PLY into flat typed arrays. Throws a RangeError, before reading any splat, when the file is
 * larger than `maximumBytes` (default 512 MiB) or holds more than `maximumCount` splats (default 2,000,000; never more
 * than 4,000,000). Returns `{ count, positions, colors, scales, rotations, bounds, skipped }`, plus `sphericalHarmonics` as
 * `{ degree, coefficients }` when the file has f_rest_* bands, where `skipped` is `{ count, fields }`: a splat with any non-finite field (a scale that overflows counts) is dropped, `count` is how many were dropped (0 for a clean file) and `fields` names the fields that were non-finite. It throws only when no splat is usable. In the arrays: positions are xyz, colors are
 * RGBA bytes (RGB from the DC spherical harmonic, A from the sigmoid of opacity), scales are the exponentiated
 * axis lengths in metres and rotations are unit quaternions in w, x, y, z order. `coefficients` is a Float32Array of
 * (degree + 1)^2 - 1 coefficients per splat, each as red, green, blue, in the 3DGS basis.
 * `sphericalHarmonicDegree` (0 to 3, default 3) keeps at most that many bands; 0 drops them, and degree 1 keeps most of the
 * look at a fifth of the memory of degree 3.
 * `upAxis` is `'y'` (default, no change) or `'z'` for a Z-up file such as one written by Blender: positions and rotations are
 * turned by -90 degrees about x, so the file's +z comes out on +y and each splat's orientation turns with it.
 */
export function parseGaussianSplatPly(buffer, options = {}) {
  const source = openSplatPly(buffer, options, 'parseGaussianSplatPly');
  const reader = createSplatReader(source);
  reader.readRange(0, source.vertexCount);
  return reader.result();
}

/**
 * The same result as `parseGaussianSplatPly`, byte for byte, read in slices of `chunkSize` splats (default 32,768) with a
 * wait of one macrotask between slices, so the page keeps drawing and answering input. `onProgress(fraction)` is called
 * after each slice with a rising fraction that ends at exactly 1. An aborted `signal` stops the read and rejects with an
 * error named `AbortError`. The header checks and size limits run first and reject before any splat is read.
 */
export async function parseGaussianSplatPlyAsync(buffer, options = {}) {
  const source = openSplatPly(buffer, options, 'parseGaussianSplatPlyAsync');
  const reader = createSplatReader(source);
  await runInChunks(source.vertexCount, options, 'parseGaussianSplatPlyAsync', reader.readRange);
  return reader.result();
}

function openSplatPly(buffer, options, caller) {
  const { maximumBytes, maximumCount } = resolveLimits(options);
  resolveUpAxis(options, caller);
  if (!(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) {
    throw new TypeError(`${caller} expects an ArrayBuffer or a typed array`);
  }
  if (buffer.byteLength > maximumBytes) {
    throw new RangeError(`Gaussian splat file is ${buffer.byteLength} bytes, over the limit of ${maximumBytes}`);
  }
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const { text, bodyStart } = readHeaderText(bytes);
  const { vertexCount, properties, skippedBytes } = parseHeader(text);
  if (!Number.isSafeInteger(skippedBytes)) {
    throw new Error('Gaussian splat PLY declares an element before "vertex" with an invalid count. Re-export the file.');
  }
  if (vertexCount > maximumCount) {
    throw new RangeError(`Gaussian splat file holds ${vertexCount} splats, over the limit of ${maximumCount}`);
  }
  const { layout, stride } = propertyLayout(properties);
  const vertexStart = bodyStart + skippedBytes;
  if (bytes.length - vertexStart < vertexCount * stride) {
    throw new Error(`Gaussian splat PLY is truncated: ${vertexCount} splats need ${vertexCount * stride} bytes, ${Math.max(0, bytes.length - vertexStart)} are present`);
  }
  const body = new DataView(bytes.buffer, bytes.byteOffset + vertexStart, vertexCount * stride);
  return { view: body, vertexCount, layout, stride, upAxis: resolveUpAxis(options, caller), harmonics: harmonicFields(layout, options, caller) };
}

const FIELD_NAMES = [...REQUIRED_PROPERTIES];
const UP_AXES = ['y', 'z'];
const HALF_SQUARE_ROOT = Math.SQRT1_2;

function resolveUpAxis(options, caller) {
  const upAxis = options.upAxis ?? 'y';
  if (!UP_AXES.includes(upAxis)) {
    throw new RangeError(`${caller} upAxis must be 'y' (the default, Crucible's up) or 'z' (Blender and CAD files), got ${String(upAxis)}`);
  }
  return upAxis;
}

// A turn of -90 degrees about x sends the file's +z (up) to +y: (x, y, z) becomes (x, z, -y).
// The same turn, as the quaternion (w, x, y, z) = (cos 45, -sin 45, 0, 0), is multiplied in front of each splat's own rotation.
function turnZUpToYUp(row) {
  const [x, y, z] = [row[0], row[1], row[2]];
  row[0] = x;
  row[1] = z;
  row[2] = -y;
  const [w, qx, qy, qz] = [row[10], row[11], row[12], row[13]];
  row[10] = HALF_SQUARE_ROOT * (w + qx);
  row[11] = HALF_SQUARE_ROOT * (qx - w);
  row[12] = HALF_SQUARE_ROOT * (qy + qz);
  row[13] = HALF_SQUARE_ROOT * (qz - qy);
}

function createSplatReader({ view, vertexCount, layout, stride, upAxis, harmonics }) {
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Uint8Array(vertexCount * 4);
  const scales = new Float32Array(vertexCount * 3);
  const rotations = new Float32Array(vertexCount * 4);
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  const fields = FIELD_NAMES.map(name => layout.get(name));
  const values = new Float64Array(fields.length);
  const badFieldNames = new Set();
  const harmonicValueCount = harmonics.fields.length;
  const coefficients = new Float32Array(vertexCount * harmonicValueCount);
  // What the 0 to 1 colour bytes cut from the constant colour; only kept with bands, which can bring it back into range.
  const colorOverflow = new Float32Array(harmonicValueCount > 0 ? vertexCount * 3 : 0);
  const harmonicValues = new Float32Array(harmonicValueCount);
  let kept = 0;
  function readRange(start, end) {
    for (let index = start; index < end; index++) readSplat(index);
  }
  // A splat with any non-finite field is dropped; the next good splat takes its slot.
  function readSplat(index) {
    const row = index * stride;
    let valid = true;
    for (let field = 0; field < fields.length; field++) {
      const value = fields[field].read(view, row + fields[field].offset);
      // Positions are stored as float32, so a value past that range counts as non-finite here, as an overflowing scale does.
      const isPosition = field < 3;
      values[field] = field >= 7 && field <= 9 ? Math.fround(Math.exp(value)) : isPosition ? Math.fround(value) : value;
      if (!Number.isFinite(values[field])) {
        badFieldNames.add(FIELD_NAMES[field]);
        valid = false;
      }
    }
    for (let field = 0; field < harmonicValueCount; field++) {
      const value = harmonics.fields[field].read(view, row + harmonics.fields[field].offset);
      harmonicValues[field] = value;
      if (!Number.isFinite(harmonicValues[field])) {
        badFieldNames.add('f_rest');
        valid = false;
      }
    }
    if (!valid) return;
    if (upAxis === 'z') {
      turnZUpToYUp(values);
      turnHarmonicsZUpToYUp(harmonicValues, 0, harmonics.degree);
    }
    coefficients.set(harmonicValues, kept * harmonicValueCount);
    writeSplat(kept++, values);
  }
  function writeSplat(slot, row) {
    for (let axis = 0; axis < 3; axis++) {
      positions[slot * 3 + axis] = row[axis];
      if (row[axis] < minimum[axis]) minimum[axis] = row[axis];
      if (row[axis] > maximum[axis]) maximum[axis] = row[axis];
      const color = 0.5 + SPHERICAL_HARMONIC_DC * row[3 + axis];
      colors[slot * 4 + axis] = toByte(color);
      if (colorOverflow.length > 0) colorOverflow[slot * 3 + axis] = color - colors[slot * 4 + axis] / 255;
      scales[slot * 3 + axis] = row[7 + axis];
    }
    colors[slot * 4 + 3] = toByte(1 / (1 + Math.exp(-row[6])));
    rotations.set(unitQuaternion(row[10], row[11], row[12], row[13]), slot * 4);
  }
  function withHarmonics(parsed, keptCoefficients, keptOverflow) {
    if (harmonics.degree === 0) return parsed;
    return { ...parsed, sphericalHarmonics: { degree: harmonics.degree, coefficients: keptCoefficients, colorOverflow: keptOverflow } };
  }
  function result() {
    const skipped = { count: vertexCount - kept, fields: [...FIELD_NAMES, 'f_rest'].filter(name => badFieldNames.has(name)) };
    if (kept === 0) {
      throw new Error(`Gaussian splat PLY has no usable splat: every one of the ${vertexCount} has a non-finite ${skipped.fields.join(', ')}. Re-export the file.`);
    }
    if (skipped.count === 0) return withHarmonics({ count: kept, positions, colors, scales, rotations, bounds: { minimum, maximum }, skipped }, coefficients, colorOverflow);
    return withHarmonics({
      count: kept,
      positions: positions.slice(0, kept * 3),
      colors: colors.slice(0, kept * 4),
      scales: scales.slice(0, kept * 3),
      rotations: rotations.slice(0, kept * 4),
      bounds: { minimum, maximum },
      skipped,
    }, coefficients.slice(0, kept * harmonicValueCount), colorOverflow.slice(0, kept * 3));
  }
  return { readRange, result };
}

function unitQuaternion(w, x, y, z) {
  const length = Math.hypot(w, x, y, z);
  if (length > 1e-12) return [w / length, x / length, y / length, z / length];
  return [1, 0, 0, 0];
}
