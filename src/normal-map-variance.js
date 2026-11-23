// Specular anti-aliasing from a normal map (Toksvig with lengths measured at upload, #3142).
// A mip level of a normal map averages texels whose normals disagree. The mean normal is shorter than 1 by the amount they disagree,
// and that shortfall widens the highlight so a pixel that covers many tilted normals does not catch a light once per pixel.
// The shader cannot read the shortfall from the stored mip: 8 bits and a renormalised direction lose it (measured on the Khronos
// NormalTangentTest, the sampled length barely shortens at the glint pixels). So it is measured here from the full-resolution
// texels, level by level, and stored in the alpha channel of every level, which a normal map does not otherwise use.

/** Alpha of a normal map that was not baked (precompressed, updated in place): the shader falls back to the stored normal length. */
export const UNBAKED_ALPHA = 255;
/** Largest alpha a baked level can hold, so a baked texel never reads as unbaked. */
export const MAXIMUM_BAKED_ALPHA = 254;
/** The shader treats an alpha above this (0 to 1) as unbaked. */
export const UNBAKED_ALPHA_THRESHOLD = '0.999';

/** One minus the mean unit-normal length (0 flat to 1) as the stored alpha: the square root keeps resolution where the spread is small. */
export function encodeSpread(spread) {
  const clamped = Math.min(Math.max(spread, 0), 1);
  return Math.min(MAXIMUM_BAKED_ALPHA, Math.round(255 * Math.sqrt(clamped)));
}

/** The spread a stored alpha stands for, the inverse of encodeSpread. */
export function decodeSpread(alpha) {
  const unit = alpha / 255;
  return unit * unit;
}

function levelSize(size) {
  return Math.max(1, size >> 1);
}

// Unit normals of the texels of RGBA bytes, three floats each. A texel that decodes to a zero vector counts as the flat normal.
function unitNormalsOf(rgba, width, height) {
  const normals = new Float32Array(width * height * 3);
  for (let texel = 0; texel < width * height; texel++) {
    const x = rgba[texel * 4] / 127.5 - 1;
    const y = rgba[texel * 4 + 1] / 127.5 - 1;
    const z = rgba[texel * 4 + 2] / 127.5 - 1;
    const length = Math.hypot(x, y, z);
    const target = texel * 3;
    if (length < 1e-6) {
      normals[target + 2] = 1;
    } else {
      normals[target] = x / length;
      normals[target + 1] = y / length;
      normals[target + 2] = z / length;
    }
  }
  return normals;
}

// The mean vectors of the 2x2 blocks (clamped at an odd edge) of `source`.
function halvedMeans(source, width, height) {
  const nextWidth = levelSize(width);
  const nextHeight = levelSize(height);
  const means = new Float32Array(nextWidth * nextHeight * 3);
  for (let row = 0; row < nextHeight; row++) {
    const rows = [Math.min(row * 2, height - 1), Math.min(row * 2 + 1, height - 1)];
    for (let column = 0; column < nextWidth; column++) {
      const columns = [Math.min(column * 2, width - 1), Math.min(column * 2 + 1, width - 1)];
      const target = (row * nextWidth + column) * 3;
      for (const sourceRow of rows) {
        for (const sourceColumn of columns) {
          const from = (sourceRow * width + sourceColumn) * 3;
          means[target] += source[from] * 0.25;
          means[target + 1] += source[from + 1] * 0.25;
          means[target + 2] += source[from + 2] * 0.25;
        }
      }
    }
  }
  return { means, width: nextWidth, height: nextHeight };
}

function encodeLevel(means, width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let texel = 0; texel < width * height; texel++) {
    const x = means[texel * 3];
    const y = means[texel * 3 + 1];
    const z = means[texel * 3 + 2];
    const length = Math.hypot(x, y, z);
    const direction = length < 1e-6 ? [0, 0, 1] : [x / length, y / length, z / length];
    for (let channel = 0; channel < 3; channel++) data[texel * 4 + channel] = Math.round((direction[channel] * 0.5 + 0.5) * 255);
    data[texel * 4 + 3] = encodeSpread(1 - Math.min(length, 1));
  }
  return data;
}

/**
 * Every mip level of an RGBA tangent-space normal map as { width, height, data } of RGBA bytes: level 0 keeps its direction and gets
 * alpha 0, each lower level holds the renormalised mean direction of the texels it covers and, in alpha, the encoded spread
 * 1 - |mean of unit normals| (see encodeSpread). The means are kept in floats, so the spread does not lose what 8 bits would.
 * Deterministic and linear in the texel count. Odd edges clamp, so a non power-of-two map can differ slightly from a driver's chain.
 */
export function buildNormalVarianceLevels(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`buildNormalVarianceLevels needs a whole width and height of 1 or more; got ${width}x${height}.`);
  }
  if (!rgba || rgba.length < width * height * 4) {
    throw new RangeError(`buildNormalVarianceLevels needs width x height x 4 RGBA bytes; got ${rgba?.length ?? 'none'} for ${width}x${height}.`);
  }
  const base = new Uint8Array(width * height * 4);
  base.set(rgba.subarray(0, width * height * 4));
  for (let texel = 0; texel < width * height; texel++) base[texel * 4 + 3] = 0;
  const levels = [{ width, height, data: base }];
  let current = unitNormalsOf(rgba, width, height);
  let currentWidth = width;
  let currentHeight = height;
  while (currentWidth > 1 || currentHeight > 1) {
    const next = halvedMeans(current, currentWidth, currentHeight);
    levels.push({ width: next.width, height: next.height, data: encodeLevel(next.means, next.width, next.height) });
    current = next.means;
    currentWidth = next.width;
    currentHeight = next.height;
  }
  return levels;
}

// The base level of the bound texture as RGBA bytes, or null when the context cannot read it back.
function readBaseLevel(context, texture, width, height) {
  const previousFramebuffer = context.getParameter(context.FRAMEBUFFER_BINDING);
  const framebuffer = context.createFramebuffer();
  try {
    context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
    context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, texture, 0);
    if (context.checkFramebufferStatus(context.FRAMEBUFFER) !== context.FRAMEBUFFER_COMPLETE) return null;
    const pixels = new Uint8Array(width * height * 4);
    context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
    return pixels;
  } finally {
    context.bindFramebuffer(context.FRAMEBUFFER, previousFramebuffer);
    context.deleteFramebuffer(framebuffer);
  }
}

/**
 * Replaces the mip chain of the normal map bound to TEXTURE_2D (RGBA8, level 0 uploaded) with the levels of buildNormalVarianceLevels.
 * Returns false and leaves the texture as it was (the caller generates mipmaps; the shader falls back to the stored length)
 * when the base level cannot be read back.
 */
export function bakeNormalMapVariance(context, texture, width, height) {
  const base = readBaseLevel(context, texture, width, height);
  if (!base) return false;
  const previousFlip = context.getParameter(context.UNPACK_FLIP_Y_WEBGL);
  const previousPremultiply = context.getParameter(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
  try {
    context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
    context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    buildNormalVarianceLevels(base, width, height).forEach((level, index) => {
      context.texImage2D(context.TEXTURE_2D, index, context.RGBA8, level.width, level.height, 0, context.RGBA, context.UNSIGNED_BYTE, level.data);
    });
  } finally {
    context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, previousFlip);
    context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, previousPremultiply);
  }
  return true;
}

/** Gain of the baked spread in the specular fade, against the screen-space change of the normal. The glints sit on texels whose spread is tiny (about 1e-3); 100 takes the rim to the path tracer without dimming the interior highlight (#3142). */
export const NORMAL_SPREAD_GAIN = 100;
