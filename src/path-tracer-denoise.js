// An edge-avoiding wavelet filter (a-trous, after the SVGF paper without its temporal part) for path traced stills.
// It filters the light and leaves the texture alone: colour is divided by the first-hit albedo first, and the albedo
// is multiplied back at the end. Normals, depth and the per-pixel noise estimate stop it at edges and shadows.

const SAME_SURFACE_NORMAL = 0.99;
const SAME_SURFACE_DEPTH = 0.02;
const PASS_STEPS = [1, 2, 4, 8, 16];
const KERNEL = [1 / 16, 1 / 4, 3 / 8, 1 / 4, 1 / 16];
export const DEFAULT_DENOISE_SETTINGS = Object.freeze({ normalPower: 64, luminanceSigma: 2, guideRadius: 1 });
const ALBEDO_FLOOR = 0.02;

function luminanceOf(buffer, index) {
  return 0.2126 * buffer[index * 3] + 0.7152 * buffer[index * 3 + 1] + 0.0722 * buffer[index * 3 + 2];
}

/**
 * How noisy a path traced frame is: the root mean square of the per pixel noise (the standard error of each pixel's mean, from the
 * tracer's variance buffer) divided by the mean luminance of the frame. 0.1 means the typical pixel is off by about 10% of the
 * frame's average brightness. Returns null when the figure cannot be told: under 2 samples a pixel has no variance, and a black
 * frame has no light to compare against. Never 0 for those, because 0 would read as a clean frame.
 */
export function estimateRelativeNoise({ color, variance, averageSamples }) {
  if (!(averageSamples >= 2)) return null;
  const pixelCount = variance.length;
  let varianceSum = 0;
  let luminanceSum = 0;
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    varianceSum += variance[pixel];
    luminanceSum += luminanceOf(color, pixel);
  }
  const meanLuminance = luminanceSum / pixelCount;
  if (!(meanLuminance > 0)) return null;
  return Math.sqrt(varianceSum / pixelCount) / meanLuminance;
}

function demodulate(color, albedo, pixelCount) {
  const light = new Float32Array(color.length);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      light[pixel * 3 + channel] = color[pixel * 3 + channel] / Math.max(albedo[pixel * 3 + channel], ALBEDO_FLOOR);
    }
  }
  return light;
}

/** The noise of each pixel's mean, as luminance variance in the light (albedo divided out), smoothed over 3 by 3. */
function smoothedVariance(variance, albedo, width, height) {
  const scaled = new Float32Array(width * height);
  for (let pixel = 0; pixel < scaled.length; pixel++) {
    const brightness = Math.max(luminanceOf(albedo, pixel), ALBEDO_FLOOR);
    scaled[pixel] = variance[pixel] / (brightness * brightness);
  }
  const smoothed = new Float32Array(scaled.length);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      let sum = 0;
      let count = 0;
      for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
          const neighborRow = row + rowOffset;
          const neighborColumn = column + columnOffset;
          if (neighborRow < 0 || neighborRow >= height || neighborColumn < 0 || neighborColumn >= width) continue;
          sum += scaled[neighborRow * width + neighborColumn];
          count++;
        }
      }
      smoothed[row * width + column] = sum / count;
    }
  }
  return smoothed;
}

function depthGradient(depth, width, height, row, column) {
  const left = depth[row * width + Math.max(column - 1, 0)];
  const right = depth[row * width + Math.min(column + 1, width - 1)];
  const above = depth[Math.max(row - 1, 0) * width + column];
  const below = depth[Math.min(row + 1, height - 1) * width + column];
  return [(right - left) / 2, (below - above) / 2];
}

function onSameSurface(normal, depth, first, second) {
  const agreement = normal[first * 3] * normal[second * 3] + normal[first * 3 + 1] * normal[second * 3 + 1] + normal[first * 3 + 2] * normal[second * 3 + 2];
  return agreement > SAME_SURFACE_NORMAL && Math.abs(depth[first] - depth[second]) <= SAME_SURFACE_DEPTH * Math.abs(depth[first]);
}

/**
 * The luminance of each pixel's light, averaged over the square of `radius` pixels each way that lies on the same surface
 * (normal within about 8 degrees, depth within 2 percent), so the average never mixes across an edge. 0 keeps it as it is.
 */
function guideLuminance({ light, normal, depth, width, height }, radius) {
  const guide = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const center = row * width + column;
      let sum = 0;
      let count = 0;
      for (let rowOffset = -radius; rowOffset <= radius; rowOffset++) {
        const neighborRow = row + rowOffset;
        if (neighborRow < 0 || neighborRow >= height) continue;
        for (let columnOffset = -radius; columnOffset <= radius; columnOffset++) {
          const neighborColumn = column + columnOffset;
          if (neighborColumn < 0 || neighborColumn >= width) continue;
          const neighbor = neighborRow * width + neighborColumn;
          if (!onSameSurface(normal, depth, center, neighbor)) continue;
          sum += luminanceOf(light, neighbor);
          count++;
        }
      }
      guide[center] = count > 0 ? sum / count : luminanceOf(light, center);
    }
  }
  return guide;
}

function filterPass({ width, height, light, variance, normal, depth }, settings, step, outputLight, outputVariance) {
  const guide = guideLuminance({ light, normal, depth, width, height }, settings.guideRadius);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const center = row * width + column;
      const centerLuminance = guide[center];
      const [gradientX, gradientY] = depthGradient(depth, width, height, row, column);
      const luminanceScale = settings.luminanceSigma * Math.sqrt(Math.max(variance[center], 0)) + 1e-4;
      let weightSum = 0;
      let squaredWeightSum = 0;
      let varianceSum = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let kernelRow = -2; kernelRow <= 2; kernelRow++) {
        const neighborRow = row + kernelRow * step;
        if (neighborRow < 0 || neighborRow >= height) continue;
        for (let kernelColumn = -2; kernelColumn <= 2; kernelColumn++) {
          const neighborColumn = column + kernelColumn * step;
          if (neighborColumn < 0 || neighborColumn >= width) continue;
          const neighbor = neighborRow * width + neighborColumn;
          const normalAgreement = Math.max(0, normal[center * 3] * normal[neighbor * 3] + normal[center * 3 + 1] * normal[neighbor * 3 + 1] + normal[center * 3 + 2] * normal[neighbor * 3 + 2]);
          const depthTolerance = Math.abs(gradientX * kernelColumn * step) + Math.abs(gradientY * kernelRow * step) + 1e-3 * Math.abs(depth[center]) + 1e-5;
          const depthWeight = Math.exp(-Math.abs(depth[center] - depth[neighbor]) / depthTolerance);
          const luminanceWeight = Math.exp(-Math.abs(centerLuminance - guide[neighbor]) / luminanceScale);
          const weight = KERNEL[kernelRow + 2] * KERNEL[kernelColumn + 2] * normalAgreement ** settings.normalPower * depthWeight * luminanceWeight;
          weightSum += weight;
          squaredWeightSum += weight * weight;
          varianceSum += weight * weight * variance[neighbor];
          red += weight * light[neighbor * 3];
          green += weight * light[neighbor * 3 + 1];
          blue += weight * light[neighbor * 3 + 2];
        }
      }
      // Background pixels carry a zero normal, so every weight is zero: keep the pixel as it is instead of dividing 0 by 0.
      if (!(weightSum > 0)) {
        outputLight[center * 3] = light[center * 3];
        outputLight[center * 3 + 1] = light[center * 3 + 1];
        outputLight[center * 3 + 2] = light[center * 3 + 2];
        outputVariance[center] = variance[center];
        continue;
      }
      outputLight[center * 3] = red / weightSum;
      outputLight[center * 3 + 1] = green / weightSum;
      outputLight[center * 3 + 2] = blue / weightSum;
      outputVariance[center] = varianceSum / (weightSum * weightSum);
    }
  }
}

const FLOATS_PER_PIXEL = { color: 3, albedo: 3, normal: 3, depth: 1, variance: 1 };

function requireBufferSizes(pixelCount, buffers) {
  for (const [name, buffer] of Object.entries(buffers)) {
    const needed = pixelCount * FLOATS_PER_PIXEL[name];
    if (!(buffer?.length >= needed)) throw new RangeError(`denoiseRadiance: ${name} has ${buffer?.length} values; pass ${needed} (${FLOATS_PER_PIXEL[name]} per pixel).`);
  }
}

/**
 * Filters a radiance image with the features gathered at each pixel's first hit. All buffers are row-major; colour,
 * albedo and normal hold three floats per pixel, depth and variance one. Returns a new colour buffer.
 */
export function denoiseRadiance({ width, height, color, albedo, normal, depth, variance }, overrides = {}) {
  const settings = { ...DEFAULT_DENOISE_SETTINGS, ...overrides };
  const pixelCount = width * height;
  requireBufferSizes(pixelCount, { color, albedo, normal, depth, variance });
  let light = demodulate(color, albedo, pixelCount);
  let noise = smoothedVariance(variance, albedo, width, height);
  let nextLight = new Float32Array(light.length);
  let nextNoise = new Float32Array(noise.length);
  for (const step of PASS_STEPS) {
    filterPass({ width, height, light, variance: noise, normal, depth }, settings, step, nextLight, nextNoise);
    [light, nextLight] = [nextLight, light];
    [noise, nextNoise] = [nextNoise, noise];
  }
  const result = new Float32Array(color.length);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      result[pixel * 3 + channel] = light[pixel * 3 + channel] * Math.max(albedo[pixel * 3 + channel], ALBEDO_FLOOR);
    }
  }
  return result;
}
