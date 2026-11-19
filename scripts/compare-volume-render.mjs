#!/usr/bin/env node
// Scores a candidate render of a grid volume against its Cycles reference (scripts/cycles-volume-reference.py): RMSE and relative RMSE in linear light,
// and the mean absolute luminance difference inside the volume's mask and outside it. Prints one JSON object and always exits 0, so a pipeline can
// read the numbers; a problem (different sizes, an unreadable file) is reported as `error` in the JSON.
//
//   node scripts/compare-volume-render.mjs reference.png candidate.png [--mask mask.png] [--threshold 0.05]
//
// The candidate may also be linear float output (#1749): a file ending in .f32 holds raw little-endian float32 RGBA, rows bottom to top, as
// readFloatPixels returns them for a frame drawn with linearOutput. Its values are scene radiance and are compared as they are, above 1 included.
//
// The mask is the volume's pixels: those a mask image marks white (luminance above 0.5), or without one the pixels where the reference's linear
// luminance is above --threshold (default 0.05), which fits a glowing volume over a dark ground; give a mask image for smoke over a bright floor.
// Pixels are 8 bit sRGB PNGs, decoded to linear light first; "relative" divides the RMSE by the reference's own RMS, so 0.1 is 10 percent of its energy.
import { readFileSync } from 'node:fs';
import { decodePng } from '../bench/agent-modeling/png-check.mjs';

const DEFAULT_THRESHOLD = 0.05;

function srgbToLinear(byte) {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminanceOf(red, green, blue) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function readLinearFloatFile(path, width, height) {
  const bytes = readFileSync(path);
  const expectedBytes = width * height * 4 * 4;
  if (bytes.length !== expectedBytes) throw new Error(`${path} holds ${bytes.length} bytes, but a ${width}x${height} float32 RGBA frame is ${expectedBytes}. Write it with the same size as the reference.`);
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, width * height * 4);
  const rgb = new Float64Array(width * height * 3);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const source = ((height - 1 - row) * width + column) * 4;
      const target = (row * width + column) * 3;
      for (let channel = 0; channel < 3; channel++) rgb[target + channel] = floats[source + channel];
    }
  }
  return { width, height, rgb };
}

function readLinear(path) {
  const png = decodePng(readFileSync(path));
  const count = png.width * png.height;
  const rgb = new Float64Array(count * 3);
  for (let pixel = 0; pixel < count; pixel++) {
    for (let channel = 0; channel < 3; channel++) rgb[pixel * 3 + channel] = srgbToLinear(png.pixels[pixel * png.channels + channel]);
  }
  return { width: png.width, height: png.height, rgb };
}

function parseArguments(argv) {
  const positional = [];
  const options = { threshold: DEFAULT_THRESHOLD, mask: null };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--mask') options.mask = argv[++index];
    else if (argv[index] === '--threshold') options.threshold = Number(argv[++index]);
    else positional.push(argv[index]);
  }
  return { positional, options };
}

function compare(referencePath, candidatePath, options) {
  const reference = readLinear(referencePath);
  const candidate = candidatePath.endsWith('.f32') ? readLinearFloatFile(candidatePath, reference.width, reference.height) : readLinear(candidatePath);
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    return { error: `the images differ in size: reference ${reference.width}x${reference.height}, candidate ${candidate.width}x${candidate.height}` };
  }
  const count = reference.width * reference.height;
  let insideMask;
  if (options.mask) {
    const mask = readLinear(options.mask);
    if (mask.width !== reference.width || mask.height !== reference.height) return { error: 'the mask differs in size from the images' };
    insideMask = index => luminanceOf(mask.rgb[index * 3], mask.rgb[index * 3 + 1], mask.rgb[index * 3 + 2]) > srgbToLinear(128);
  } else {
    insideMask = index => luminanceOf(reference.rgb[index * 3], reference.rgb[index * 3 + 1], reference.rgb[index * 3 + 2]) > options.threshold;
  }
  let squaredError = 0;
  let squaredReference = 0;
  const regions = { inside: { count: 0, sum: 0 }, outside: { count: 0, sum: 0 } };
  for (let pixel = 0; pixel < count; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      const difference = candidate.rgb[pixel * 3 + channel] - reference.rgb[pixel * 3 + channel];
      squaredError += difference * difference;
      squaredReference += reference.rgb[pixel * 3 + channel] ** 2;
    }
    const lumaDifference = Math.abs(
      luminanceOf(candidate.rgb[pixel * 3], candidate.rgb[pixel * 3 + 1], candidate.rgb[pixel * 3 + 2])
      - luminanceOf(reference.rgb[pixel * 3], reference.rgb[pixel * 3 + 1], reference.rgb[pixel * 3 + 2]));
    const region = insideMask(pixel) ? regions.inside : regions.outside;
    region.count++;
    region.sum += lumaDifference;
  }
  const rmse = Math.sqrt(squaredError / (count * 3));
  const referenceRms = Math.sqrt(squaredReference / (count * 3));
  const meanOf = region => (region.count > 0 ? region.sum / region.count : null);
  return {
    width: reference.width,
    height: reference.height,
    rmse,
    relativeRmse: referenceRms > 0 ? rmse / referenceRms : null,
    maskSource: options.mask ? 'image' : `reference luminance above ${options.threshold}`,
    maskShare: regions.inside.count / count,
    meanAbsoluteLuminanceDifference: { inside: meanOf(regions.inside), outside: meanOf(regions.outside) },
  };
}

const { positional, options } = parseArguments(process.argv.slice(2));
let result;
if (positional.length !== 2 || !Number.isFinite(options.threshold)) {
  result = { error: 'usage: node scripts/compare-volume-render.mjs reference.png candidate.png [--mask mask.png] [--threshold 0.05]' };
} else {
  try {
    result = compare(positional[0], positional[1], options);
  } catch (error) {
    result = { error: error.message };
  }
}
console.log(JSON.stringify(result, null, 2));
