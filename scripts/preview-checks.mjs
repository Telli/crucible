// Measured checks for a look preview (a still or the frames of a clip) before it goes to review: exposure against
// an optional path-traced reference, texels that shimmer between frames, and the camera passing into a wall.
// Every function here works on luminance planes, { width, height, values } with values from 0 to 255, so the tests
// can build small synthetic frames and the command line can decode any picture or clip into the same shape.

export const DEFAULT_LIMITS = Object.freeze({
  // Exposure on its own.
  maximumBrightClippedPercent: 5,
  maximumShadowFloor: 70,
  minimumHighlightCeiling: 40,
  // Exposure against a reference of the same scene and camera.
  maximumMedianDifference: 25,
  maximumShadowDifference: 35,
  maximumHighlightDifference: 40,
  // Temporal stability.
  shimmerResidual: 10,
  maximumShimmerPercent: 1,
  // Near-plane intrusion.
  flatGradient: 1.2,
  maximumFlatJump: 0.25,
  maximumFlatExcess: 0.12,
  maximumFlatShare: 0.6,
});

const BRIGHT_CLIP = 250;
const SHIMMER_BLOCK = 8;
const SHIMMER_SEARCH = 3;
const GLOBAL_SEARCH = 24;
const FLAT_BLOCK = 16;

/** Luma (Rec. 709 weights on the stored sRGB values) of RGBA or RGB bytes, as a plane of 0..255 values. */
export function luminanceFromPixels({ width, height, data, channels = 4 }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`A frame needs a positive integer width and height; got ${width}x${height}.`);
  }
  if (data.length < width * height * channels) throw new Error(`A ${width}x${height} frame with ${channels} channels needs ${width * height * channels} bytes; got ${data.length}.`);
  const values = new Float32Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * channels;
    values[pixel] = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
  }
  return { width, height, values };
}

/** The plane scaled to the given size by averaging the source pixels each target pixel covers. */
export function resizePlane(plane, targetWidth, targetHeight) {
  if (plane.width === targetWidth && plane.height === targetHeight) return plane;
  const values = new Float32Array(targetWidth * targetHeight);
  const scaleX = plane.width / targetWidth;
  const scaleY = plane.height / targetHeight;
  for (let row = 0; row < targetHeight; row++) {
    const top = Math.floor(row * scaleY);
    const bottom = Math.max(top + 1, Math.floor((row + 1) * scaleY));
    for (let column = 0; column < targetWidth; column++) {
      const left = Math.floor(column * scaleX);
      const right = Math.max(left + 1, Math.floor((column + 1) * scaleX));
      let sum = 0;
      for (let sourceRow = top; sourceRow < bottom; sourceRow++) {
        for (let sourceColumn = left; sourceColumn < right; sourceColumn++) sum += plane.values[sourceRow * plane.width + sourceColumn];
      }
      values[row * targetWidth + column] = sum / ((bottom - top) * (right - left));
    }
  }
  return { width: targetWidth, height: targetHeight, values };
}

function percentile(sorted, fraction) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

/** Median, 5th and 95th percentile luminance and the share of pixels clipped to white. */
export function exposureStatistics(plane) {
  const sorted = Float32Array.from(plane.values).sort();
  let clipped = 0;
  for (const value of plane.values) if (value >= BRIGHT_CLIP) clipped++;
  return {
    median: percentile(sorted, 0.5),
    shadow: percentile(sorted, 0.05),
    highlight: percentile(sorted, 0.95),
    brightClippedPercent: (100 * clipped) / plane.values.length,
  };
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** Exposure of a frame, failing on blown or washed-out values, and on a large difference from the reference when one is given. */
export function checkExposure(plane, reference = null, limits = DEFAULT_LIMITS) {
  const measured = exposureStatistics(plane);
  const problems = [];
  if (measured.brightClippedPercent > limits.maximumBrightClippedPercent) {
    problems.push(`${round(measured.brightClippedPercent)}% of pixels are clipped to white (limit ${limits.maximumBrightClippedPercent}%): lower the exposure or check the tone mapping`);
  }
  if (measured.shadow > limits.maximumShadowFloor) {
    problems.push(`the darkest 5% of pixels are still at ${round(measured.shadow)} (limit ${limits.maximumShadowFloor}): the frame is washed out, with no dark values`);
  }
  if (measured.highlight < limits.minimumHighlightCeiling) {
    problems.push(`the brightest 5% of pixels only reach ${round(measured.highlight)} (limit ${limits.minimumHighlightCeiling}): the frame is too dark`);
  }
  let referenceStatistics = null;
  if (reference) {
    referenceStatistics = exposureStatistics(reference);
    const medianDifference = measured.median - referenceStatistics.median;
    if (Math.abs(medianDifference) > limits.maximumMedianDifference) {
      problems.push(`median ${round(measured.median)} is ${round(Math.abs(medianDifference))} ${medianDifference > 0 ? 'brighter' : 'darker'} than the reference ${round(referenceStatistics.median)} (limit ${limits.maximumMedianDifference})`);
    }
    if (Math.abs(measured.shadow - referenceStatistics.shadow) > limits.maximumShadowDifference) {
      problems.push(`shadows (5th percentile) are at ${round(measured.shadow)} against ${round(referenceStatistics.shadow)} in the reference (limit ${limits.maximumShadowDifference})`);
    }
    if (Math.abs(measured.highlight - referenceStatistics.highlight) > limits.maximumHighlightDifference) {
      problems.push(`highlights (95th percentile) are at ${round(measured.highlight)} against ${round(referenceStatistics.highlight)} in the reference (limit ${limits.maximumHighlightDifference})`);
    }
  }
  return {
    name: 'exposure',
    pass: problems.length === 0,
    measured: roundAll(measured),
    reference: referenceStatistics && roundAll(referenceStatistics),
    problems,
  };
}

function roundAll(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, round(value)]));
}

function meanAbsoluteDifference(current, previous, left, top, size, offsetX, offsetY) {
  let sum = 0;
  for (let row = top; row < top + size; row++) {
    const currentRow = row * current.width;
    const previousRow = (row + offsetY) * previous.width + offsetX;
    for (let column = left; column < left + size; column++) sum += Math.abs(current.values[currentRow + column] - previous.values[previousRow + column]);
  }
  return sum / (size * size);
}

function bilinear(plane, x, y) {
  const left = Math.max(0, Math.min(plane.width - 2, Math.floor(x)));
  const top = Math.max(0, Math.min(plane.height - 2, Math.floor(y)));
  const fractionX = x - left;
  const fractionY = y - top;
  const upper = plane.values[top * plane.width + left] * (1 - fractionX) + plane.values[top * plane.width + left + 1] * fractionX;
  const lower = plane.values[(top + 1) * plane.width + left] * (1 - fractionX) + plane.values[(top + 1) * plane.width + left + 1] * fractionX;
  return upper * (1 - fractionY) + lower * fractionY;
}

// Surfaces rarely move a whole number of pixels per frame, so the best whole-pixel match is refined to the half
// pixels around it; without this, sharp detail moving smoothly would read as shimmer.
function halfPixelResidual(current, previous, left, top, best) {
  let smallest = Infinity;
  for (const stepY of [-0.5, 0, 0.5]) {
    for (const stepX of [-0.5, 0, 0.5]) {
      if (stepX === 0 && stepY === 0) continue;
      let sum = 0;
      for (let row = top; row < top + SHIMMER_BLOCK; row++) {
        for (let column = left; column < left + SHIMMER_BLOCK; column++) {
          sum += Math.abs(current.values[row * current.width + column] - bilinear(previous, column + best.x + stepX, row + best.y + stepY));
        }
      }
      smallest = Math.min(smallest, sum / (SHIMMER_BLOCK * SHIMMER_BLOCK));
    }
  }
  return smallest;
}

/** The whole-frame shift that best lines the previous frame up with the current one, searched on a quarter-size copy. */
export function estimateGlobalShift(current, previous) {
  const scale = 4;
  const smallWidth = Math.max(8, Math.floor(current.width / scale));
  const smallHeight = Math.max(8, Math.floor(current.height / scale));
  const smallCurrent = resizePlane(current, smallWidth, smallHeight);
  const smallPrevious = resizePlane(previous, smallWidth, smallHeight);
  const search = Math.max(1, Math.round(GLOBAL_SEARCH / scale));
  const margin = search;
  let best = { x: 0, y: 0, error: Infinity };
  for (let offsetY = -search; offsetY <= search; offsetY++) {
    for (let offsetX = -search; offsetX <= search; offsetX++) {
      let sum = 0;
      let count = 0;
      for (let row = margin; row < smallHeight - margin; row++) {
        for (let column = margin; column < smallWidth - margin; column++) {
          sum += Math.abs(smallCurrent.values[row * smallWidth + column] - smallPrevious.values[(row + offsetY) * smallWidth + column + offsetX]);
          count++;
        }
      }
      const error = count ? sum / count : Infinity;
      if (error < best.error) best = { x: offsetX, y: offsetY, error };
    }
  }
  return { x: best.x * scale, y: best.y * scale };
}

/**
 * For each block of the current frame, the smallest mean difference to the previous frame over shifts near the
 * global motion. Moving surfaces find a match; texels that change shape from frame to frame do not.
 */
export function blockResiduals(current, previous) {
  const shift = estimateGlobalShift(current, previous);
  const columns = Math.floor(current.width / SHIMMER_BLOCK);
  const rows = Math.floor(current.height / SHIMMER_BLOCK);
  const residuals = new Float32Array(columns * rows).fill(NaN);
  for (let blockRow = 0; blockRow < rows; blockRow++) {
    for (let blockColumn = 0; blockColumn < columns; blockColumn++) {
      const left = blockColumn * SHIMMER_BLOCK;
      const top = blockRow * SHIMMER_BLOCK;
      let best = { error: Infinity, x: 0, y: 0 };
      // Search near the camera motion and near no motion, so a repeating pattern that fools the global estimate
      // still finds its match for slow moves.
      for (const centre of shift.x === 0 && shift.y === 0 ? [shift] : [shift, { x: 0, y: 0 }]) {
        for (let offsetY = centre.y - SHIMMER_SEARCH; offsetY <= centre.y + SHIMMER_SEARCH; offsetY++) {
          if (top + offsetY < 0 || top + offsetY + SHIMMER_BLOCK > previous.height) continue;
          for (let offsetX = centre.x - SHIMMER_SEARCH; offsetX <= centre.x + SHIMMER_SEARCH; offsetX++) {
            if (left + offsetX < 0 || left + offsetX + SHIMMER_BLOCK > previous.width) continue;
            const error = meanAbsoluteDifference(current, previous, left, top, SHIMMER_BLOCK, offsetX, offsetY);
            if (error < best.error) best = { error, x: offsetX, y: offsetY };
          }
        }
      }
      if (best.error !== Infinity) residuals[blockRow * columns + blockColumn] = Math.min(best.error, halfPixelResidual(current, previous, left, top, best));
    }
  }
  return { columns, rows, residuals, shift };
}

function regionName(columnFraction, rowFraction) {
  const vertical = rowFraction < 1 / 3 ? 'upper' : rowFraction < 2 / 3 ? 'middle' : 'lower';
  const horizontal = columnFraction < 1 / 3 ? 'left' : columnFraction < 2 / 3 ? 'centre' : 'right';
  return vertical === 'middle' && horizontal === 'centre' ? 'centre' : `${vertical} ${horizontal}`;
}

/**
 * Texels that shimmer or crawl: a block counts when it matches neither the frame before nor the frame after at any
 * shift near the camera motion, so a surface that is merely revealed by motion on one side is not counted.
 */
export function checkTemporalStability(frames, limits = DEFAULT_LIMITS) {
  if (frames.length < 3) return { name: 'shimmer', pass: true, skipped: 'needs at least three frames', problems: [] };
  let flagged = 0;
  let counted = 0;
  let worstFramePercent = 0;
  let worstFrame = 0;
  let hotspots = null;
  let previousResiduals = blockResiduals(frames[1], frames[0]);
  for (let index = 1; index < frames.length - 1; index++) {
    const nextResiduals = blockResiduals(frames[index], frames[index + 1]);
    hotspots ??= new Float32Array(nextResiduals.columns * nextResiduals.rows);
    let frameFlagged = 0;
    let frameCounted = 0;
    for (let block = 0; block < nextResiduals.residuals.length; block++) {
      const backward = previousResiduals.residuals[block];
      const forward = nextResiduals.residuals[block];
      if (Number.isNaN(backward) || Number.isNaN(forward)) continue;
      frameCounted++;
      if (Math.min(backward, forward) > limits.shimmerResidual) {
        frameFlagged++;
        hotspots[block]++;
      }
    }
    flagged += frameFlagged;
    counted += frameCounted;
    const framePercent = frameCounted ? (100 * frameFlagged) / frameCounted : 0;
    if (framePercent > worstFramePercent) {
      worstFramePercent = framePercent;
      worstFrame = index;
    }
    previousResiduals = blockResiduals(frames[index + 1], frames[index]);
  }
  const shimmerPercent = counted ? (100 * flagged) / counted : 0;
  let hotspot = null;
  if (hotspots && flagged) {
    const columns = Math.floor(frames[0].width / SHIMMER_BLOCK);
    const rows = hotspots.length / columns;
    const regionTotals = new Map();
    for (let block = 0; block < hotspots.length; block++) {
      if (!hotspots[block]) continue;
      const name = regionName((block % columns + 0.5) / columns, (Math.floor(block / columns) + 0.5) / rows);
      regionTotals.set(name, (regionTotals.get(name) ?? 0) + hotspots[block]);
    }
    hotspot = [...regionTotals.entries()].sort((first, second) => second[1] - first[1])[0][0];
  }
  const problems = [];
  if (shimmerPercent > limits.maximumShimmerPercent) {
    problems.push(`${round(shimmerPercent)}% of blocks change shape between frames (limit ${limits.maximumShimmerPercent}%), worst at frame ${worstFrame} (${round(worstFramePercent)}%), mostly ${hotspot}: look for texture aliasing (mip bias, anisotropy, UV scale) or thin geometry`);
  }
  return {
    name: 'shimmer',
    pass: problems.length === 0,
    measured: { shimmerPercent: round(shimmerPercent), worstFrame, worstFramePercent: round(worstFramePercent), hotspot },
    problems,
  };
}

/** Share of the frame covered by blocks with almost no detail, such as a wall right in front of the lens. */
export function flatShare(plane, limits = DEFAULT_LIMITS) {
  const columns = Math.floor(plane.width / FLAT_BLOCK);
  const rows = Math.floor(plane.height / FLAT_BLOCK);
  let flat = 0;
  for (let blockRow = 0; blockRow < rows; blockRow++) {
    for (let blockColumn = 0; blockColumn < columns; blockColumn++) {
      let gradient = 0;
      for (let row = blockRow * FLAT_BLOCK; row < (blockRow + 1) * FLAT_BLOCK; row++) {
        for (let column = blockColumn * FLAT_BLOCK; column < (blockColumn + 1) * FLAT_BLOCK - 1; column++) {
          const index = row * plane.width + column;
          gradient += Math.abs(plane.values[index + 1] - plane.values[index]);
          if (row + 1 < plane.height) gradient += Math.abs(plane.values[index + plane.width] - plane.values[index]);
        }
      }
      if (gradient / (FLAT_BLOCK * (FLAT_BLOCK - 1) * 2) < limits.flatGradient) flat++;
    }
  }
  return columns * rows ? flat / (columns * rows) : 0;
}

/** The camera passing into geometry: a large featureless area that fills a frame, or appears or vanishes from one frame to the next. */
export function checkNearPlane(frames, limits = DEFAULT_LIMITS) {
  const shares = frames.map(frame => flatShare(frame, limits));
  const problems = [];
  let largestJump = 0;
  let jumpFrame = 0;
  for (let index = 1; index < shares.length; index++) {
    const jump = Math.abs(shares[index] - shares[index - 1]);
    if (jump > largestJump) {
      largestJump = jump;
      jumpFrame = index;
    }
  }
  const largestShare = Math.max(...shares);
  const largestShareFrame = shares.indexOf(largestShare);
  const typicalShare = [...shares].sort((first, second) => first - second)[Math.floor(shares.length / 2)];
  if (frames.length > 1 && largestJump > limits.maximumFlatJump) {
    problems.push(`a featureless area ${shares[jumpFrame] > shares[jumpFrame - 1] ? 'appears' : 'vanishes'} at frame ${jumpFrame} (${round(100 * largestJump)}% of the frame, limit ${round(100 * limits.maximumFlatJump)}%): the camera likely passes through a surface; move the path out of the geometry`);
  }
  if (frames.length > 2 && largestShare - typicalShare > limits.maximumFlatExcess) {
    problems.push(`frame ${largestShareFrame} has ${round(100 * largestShare)}% featureless area against ${round(100 * typicalShare)}% in a typical frame (limit ${round(100 * limits.maximumFlatExcess)} points more): the camera likely starts or passes inside a surface; move the path out of the geometry`);
  }
  if (largestShare > limits.maximumFlatShare) {
    problems.push(`${round(100 * largestShare)}% of frame ${largestShareFrame} has no detail (limit ${round(100 * limits.maximumFlatShare)}%): the camera may sit inside or against a surface`);
  }
  return {
    name: 'near-plane',
    pass: problems.length === 0,
    measured: { largestFlatPercent: round(100 * largestShare), largestFlatFrame: largestShareFrame, typicalFlatPercent: round(100 * typicalShare), largestJumpPercent: round(100 * largestJump), jumpFrame },
    problems,
  };
}

/** Mean structural similarity of two planes of the same size, on 8 by 8 windows. */
export function structuralSimilarity(first, second) {
  if (first.width !== second.width || first.height !== second.height) throw new Error('Structural similarity needs two planes of the same size.');
  const window = 8;
  const constantLuminance = (0.01 * 255) ** 2;
  const constantContrast = (0.03 * 255) ** 2;
  let total = 0;
  let windows = 0;
  for (let top = 0; top + window <= first.height; top += window) {
    for (let left = 0; left + window <= first.width; left += window) {
      let sumFirst = 0;
      let sumSecond = 0;
      for (let row = top; row < top + window; row++) {
        for (let column = left; column < left + window; column++) {
          sumFirst += first.values[row * first.width + column];
          sumSecond += second.values[row * first.width + column];
        }
      }
      const count = window * window;
      const meanFirst = sumFirst / count;
      const meanSecond = sumSecond / count;
      let varianceFirst = 0;
      let varianceSecond = 0;
      let covariance = 0;
      for (let row = top; row < top + window; row++) {
        for (let column = left; column < left + window; column++) {
          const differenceFirst = first.values[row * first.width + column] - meanFirst;
          const differenceSecond = second.values[row * first.width + column] - meanSecond;
          varianceFirst += differenceFirst * differenceFirst;
          varianceSecond += differenceSecond * differenceSecond;
          covariance += differenceFirst * differenceSecond;
        }
      }
      varianceFirst /= count - 1;
      varianceSecond /= count - 1;
      covariance /= count - 1;
      total += ((2 * meanFirst * meanSecond + constantLuminance) * (2 * covariance + constantContrast))
        / ((meanFirst * meanFirst + meanSecond * meanSecond + constantLuminance) * (varianceFirst + varianceSecond + constantContrast));
      windows++;
    }
  }
  return windows ? total / windows : 1;
}

/** Structural similarity to the reference, failing only when a minimum is given. */
export function checkSimilarity(plane, reference, minimum = null) {
  const similarity = structuralSimilarity(plane, reference);
  const problems = [];
  if (minimum !== null && similarity < minimum) problems.push(`structural similarity ${round(similarity, 3)} is below ${minimum}: the frame differs from the reference in content, not only in tone`);
  return { name: 'similarity', pass: problems.length === 0, measured: { similarity: round(similarity, 3) }, problems };
}

/**
 * Every check for a candidate: frames is one plane for a still or several consecutive planes for a clip, all the
 * same size. The reference, when given, is compared with the frame at referenceFrame and resized to match it.
 */
export function checkPreview({ frames, reference = null, referenceFrame = 0, minimumSimilarity = null, limits = {} }) {
  if (!frames?.length) throw new Error('checkPreview needs at least one frame.');
  const merged = { ...DEFAULT_LIMITS, ...limits };
  const compared = frames[Math.min(referenceFrame, frames.length - 1)];
  const sizedReference = reference && resizePlane(reference, compared.width, compared.height);
  const results = [checkExposure(compared, sizedReference, merged)];
  if (frames.length > 1) {
    results.push(checkTemporalStability(frames, merged));
    results.push(checkNearPlane(frames, merged));
  } else {
    results.push(checkNearPlane(frames, merged));
  }
  if (sizedReference) results.push(checkSimilarity(compared, sizedReference, minimumSimilarity));
  return { pass: results.every(result => result.pass), results };
}
