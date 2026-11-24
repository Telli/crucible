// Colour measurement for scene_fit_look: sRGB pixels to OKLab and the trimmed mean of one labelled region.
// Pure arithmetic over RGBA bytes, no engine imports, so the MCP server, the runtime and the tests share it.

/** sRGB transfer (0..1) to linear light. */
export function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Linear sRGB to OKLab (Bjorn Ottosson, 2020). Returns [lightness, a, b]. */
export function linearToOklab(red, green, blue) {
  const long = Math.cbrt(0.4122214708 * red + 0.5363313414 * green + 0.0514459929 * blue);
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ];
}

const SRGB_TABLE = new Float32Array(256).map((_, index) => srgbToLinear(index / 255));
const TRIM_FRACTION = 0.2;

function pixelsInRegion(image, region) {
  const [left, top, right, bottom] = region.rect;
  const first = { x: Math.max(0, Math.floor(left * image.width)), y: Math.max(0, Math.floor(top * image.height)) };
  const last = { x: Math.min(image.width, Math.ceil(right * image.width)), y: Math.min(image.height, Math.ceil(bottom * image.height)) };
  const excluded = (region.exclude ?? []).map(([x0, y0, x1, y1]) => [x0 * image.width, y0 * image.height, x1 * image.width, y1 * image.height]);
  const samples = [];
  for (let y = first.y; y < last.y; y++) {
    for (let x = first.x; x < last.x; x++) {
      if (excluded.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) continue;
      const offset = (y * image.width + x) * 4;
      samples.push(linearToOklab(SRGB_TABLE[image.data[offset]], SRGB_TABLE[image.data[offset + 1]], SRGB_TABLE[image.data[offset + 2]]));
    }
  }
  return samples;
}

/**
 * The OKLab mean of one region, trimmed to the middle 60 percent by lightness so a stray speck does not move it.
 * image: { width, height, data } with RGBA bytes. region: { rect: [x0, y0, x1, y1] in 0..1, y down, exclude?: [rect] }.
 */
export function measureRegion(image, region) {
  const samples = pixelsInRegion(image, region);
  if (!samples.length) {
    throw new RangeError(`Region ${region.label ?? ''} covers no pixels of the ${image.width}x${image.height} render; widen its rect or shrink its exclude boxes.`);
  }
  samples.sort((first, second) => first[0] - second[0]);
  const start = Math.floor(samples.length * TRIM_FRACTION);
  const end = Math.max(start + 1, Math.ceil(samples.length * (1 - TRIM_FRACTION)));
  const kept = samples.slice(start, end);
  const mean = [0, 0, 0];
  for (const sample of kept) {
    for (let channel = 0; channel < 3; channel++) mean[channel] += sample[channel] / kept.length;
  }
  return { lab: mean, pixels: samples.length };
}
