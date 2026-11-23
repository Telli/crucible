// Procedural RGBA textures for vegetation: leaf sprigs with alpha, bark and grass cards.
// Pixel arrays are built in plain JavaScript so tests and Node tools can use them without a canvas.

import { FULL_TURN, clamp, createRandom, valueNoise } from './vegetation-geometry.js';

const TEXTURE_SIZE = 128;
const descriptorCache = new Map();

function createPixels(fillColor, size = TEXTURE_SIZE) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = fillColor[0];
    data[offset + 1] = fillColor[1];
    data[offset + 2] = fillColor[2];
    data[offset + 3] = 0;
  }
  return { width: size, height: size, data };
}

function compositePixel(pixels, x, y, color, coverage) {
  const offset = (y * pixels.width + x) * 4;
  const existingAlpha = pixels.data[offset + 3] / 255;
  const outputAlpha = coverage + existingAlpha * (1 - coverage);
  if (outputAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel++) {
    const mixed = (color[channel] * coverage + pixels.data[offset + channel] * existingAlpha * (1 - coverage)) / outputAlpha;
    pixels.data[offset + channel] = mixed;
  }
  pixels.data[offset + 3] = outputAlpha * 255;
}

// Angle zero points up the image; the leaf grows from (baseX, baseY) along that axis.
const PLAIN_PROFILE = along => Math.sin(Math.PI * along ** 0.7);

function paintLeaf(pixels, { baseX, baseY, angle, length, width, color, shade, profile = PLAIN_PROFILE, bounds = null }) {
  const axisX = Math.sin(angle);
  const axisY = -Math.cos(angle);
  const sideX = -axisY;
  const sideY = axisX;
  const reach = Math.ceil(length + width);
  const minimumY = Math.max(bounds?.minY ?? 0, Math.floor(baseY - reach));
  const maximumY = Math.min(bounds?.maxY ?? pixels.height - 1, Math.ceil(baseY + reach));
  const minimumX = Math.max(bounds?.minX ?? 0, Math.floor(baseX - reach));
  const maximumX = Math.min(bounds?.maxX ?? pixels.width - 1, Math.ceil(baseX + reach));
  for (let y = minimumY; y <= maximumY; y++) {
    for (let x = minimumX; x <= maximumX; x++) {
      const offsetX = x + 0.5 - baseX;
      const offsetY = y + 0.5 - baseY;
      const along = (offsetX * axisX + offsetY * axisY) / length;
      if (along < 0 || along > 1) continue;
      const across = offsetX * sideX + offsetY * sideY;
      const halfWidth = width / 2 * profile(along);
      const coverage = clamp(halfWidth - Math.abs(across) + 0.5, 0, 1);
      if (coverage <= 0) continue;
      const sideDistance = Math.abs(across) / (halfWidth + 1e-3);
      const midrib = Math.abs(across) < 0.7 ? 0.2 : 0;
      const vein = (along * 7 + sideDistance * 0.9) % 1 < 0.1 ? -0.1 : 0;
      const brightness = shade * (0.82 + 0.3 * (1 - sideDistance) + midrib + vein);
      compositePixel(pixels, x, y, color.map(channel => channel * brightness), coverage);
    }
  }
}

function paintStem(pixels, fromX, fromY, toX, toY, color, bounds = null) {
  const steps = Math.ceil(Math.hypot(toX - fromX, toY - fromY) * 2);
  for (let step = 0; step <= steps; step++) {
    const progress = step / steps;
    const x = Math.round(fromX + (toX - fromX) * progress);
    const y = Math.round(fromY + (toY - fromY) * progress);
    if (bounds && (x < bounds.minX || x + 1 > bounds.maxX || y < bounds.minY || y > bounds.maxY)) continue;
    for (let spread = 0; spread < 2; spread++) {
      if (x + spread < pixels.width) compositePixel(pixels, x + spread, y, color, 1);
    }
  }
}

function paintSprig(pixels, color, random) {
  const stemColor = [color[0] * 0.55, color[1] * 0.5, color[2] * 0.4];
  paintStem(pixels, 64, 126, 64, 30, stemColor);
  for (let pair = 0; pair < 6; pair++) {
    const baseY = 106 - pair * 13;
    const length = 22 + 10 * Math.sin((pair + 1) / 6 * Math.PI);
    for (const side of [-1, 1]) {
      const angle = side * (1.0 + random() * 0.3);
      paintLeaf(pixels, { baseX: 64, baseY: baseY - (side > 0 ? 6 : 0), angle, length, width: length * 0.55, color, shade: 0.85 + random() * 0.3 });
    }
  }
  paintLeaf(pixels, { baseX: 64, baseY: 44, angle: 0, length: 40, width: 25, color, shade: 1.05 });
}

// Spray cards (#3041, #3057): the twig texture is a 256 px atlas of 2 x 2 spray variants, one shoot of a real species per cell. A cell is a card
// of about 0.6 m, so a pixel is about 4.7 mm: birch leaves of 3 to 7 cm are 6 to 15 px, oak leaves of 10 to 12 cm 21 to 26 px, and an ash leaf
// of 20 to 35 cm is a 43 to 75 px rachis with 7 to 13 leaflets. Sprays are painted at twice the size and boxed down, which smooths every edge.
// Sizes below are in final pixels.
export const TWIG_TEXTURE_SIZE = 256;
const SPRAY_CELL = TWIG_TEXTURE_SIZE / 2;
const SPRAY_SCALE = 2;
const SPRAY_MARGIN = 4;

const LEAF_PROFILES = {
  oak: (along, phase) => Math.sin(Math.PI * along ** 0.8) * (0.4 + 0.6 * (0.5 - 0.5 * Math.cos(2 * Math.PI * (3 * along + phase * 0.4))) ** 0.7),
  // Triangular with a sawtooth edge: six teeth along the blade.
  birch: along => (along < 0.3 ? (along / 0.3) ** 0.7 : ((1 - along) / 0.7) ** 0.9) * (0.7 + 0.3 * ((along * 6) % 1)),
  // Rounded with a flat base and a small pointed tip.
  aspen: along => Math.max(0, 1 - ((along - 0.45) / 0.55) ** 2) ** (along < 0.45 ? 0.5 : 0.9),
  // Lanceolate: widest a third of the way up, tapering to a point.
  ash: along => Math.sin(Math.PI * along ** 0.65) ** 1.3,
};

// Multipliers of the leaf colour: a normal leaf, now and then an old yellowing one, and a pale underside turned to the light.
const LEAF_TONES = [[1, 1, 1], [1.5, 1.05, 0.55], [1.2, 1.25, 1.3]];

function between(random, low, high) {
  return low + random() * (high - low);
}

function leafColor(random, color) {
  const roll = random();
  const tone = LEAF_TONES[roll > 0.9 ? 1 : roll < 0.2 ? 2 : 0];
  const hue = between(random, -0.08, 0.08);
  const hueTone = [1 + hue * 1.5, 1 - hue * 0.5, 1 - hue];
  return color.map((channel, index) => clamp(channel * tone[index] * hueTone[index], 0, 255));
}

function sprayBounds(cell, margin) {
  return {
    minX: (cell.x + margin) * SPRAY_SCALE, maxX: (cell.x + SPRAY_CELL - margin) * SPRAY_SCALE - 1,
    minY: (cell.y + margin) * SPRAY_SCALE, maxY: (cell.y + SPRAY_CELL - margin) * SPRAY_SCALE - 1,
  };
}

function paintSprayStem(pixels, spray, fromX, fromY, toX, toY) {
  const [from, to] = [[fromX, fromY], [toX, toY]].map(point => point.map(value => Math.round(value * SPRAY_SCALE)));
  paintStem(pixels, ...from, ...to, spray.stemColor, spray.bounds);
  paintStem(pixels, from[0], from[1] + 1, to[0], to[1] + 1, spray.stemColor, spray.bounds);
}

// One leaf or leaflet on a stalk of `stalk` px, painted first. A leaf whose tip would pass the cell margin is left out, stalk and all.
function paintSprayLeaf(pixels, spray, baseX, baseY, angle, leafLength, leafWidth, stalk = 0) {
  const { random, bounds } = spray;
  const length = leafLength * spray.scale;
  const startX = baseX + Math.sin(angle) * stalk * spray.scale;
  const startY = baseY - Math.cos(angle) * stalk * spray.scale;
  const tipX = (startX + Math.sin(angle) * length) * SPRAY_SCALE;
  const tipY = (startY - Math.cos(angle) * length) * SPRAY_SCALE;
  const reach = leafWidth * spray.scale * SPRAY_SCALE / 2;
  if (tipX - reach < bounds.minX || tipX + reach > bounds.maxX || tipY - reach < bounds.minY || tipY + reach > bounds.maxY) return;
  if (stalk > 0) paintSprayStem(pixels, spray, baseX, baseY, startX, startY);
  const phase = random();
  const profile = along => spray.profile(along, phase);
  const shade = between(random, 0.7, 1.15);
  paintLeaf(pixels, {
    baseX: startX * SPRAY_SCALE, baseY: startY * SPRAY_SCALE, angle, length: length * SPRAY_SCALE, width: leafWidth * spray.scale * SPRAY_SCALE,
    color: leafColor(random, spray.color), shade, profile, bounds,
  });
}

// A shoot grows from (x, y) along `angle`, bending by `curve` radians over its length. Each node carries a leaf on alternating sides (or a
// pair), on a stalk; the tip carries a cluster or a leaf of its own, and every few nodes a side shoot leaves.
function paintShoot(pixels, spray, shoot) {
  const { random, recipe } = spray;
  const { x: originX, y: originY, angle: originAngle, length, curve, depth } = shoot;
  const nodeCount = Math.max(2, Math.round(length / (recipe.nodeSpacing * spray.spacing)));
  const step = length / nodeCount;
  const paintLeavesAt = (x, y, angle, side, progress) => {
    if (progress < recipe.leavesFrom) return;
    const cluster = progress === 1 && recipe.tipCluster;
    const count = cluster ? recipe.tipCluster[0] + Math.floor(random() * (recipe.tipCluster[1] - recipe.tipCluster[0] + 1)) : recipe.pair ? 2 : 1;
    for (let leaf = 0; leaf < count; leaf++) {
      const fan = cluster ? (leaf - (count - 1) / 2) * 0.65 + between(random, -0.15, 0.15) : (count === 1 ? side : leaf ? 1 : -1) * between(random, ...recipe.leafSpread);
      const leafLength = between(random, ...recipe.leafLength) * (1 - 0.3 * progress);
      paintSprayLeaf(pixels, spray, x, y, angle + fan, leafLength, leafLength * recipe.leafWidth, between(random, ...recipe.stalk));
    }
  };
  let [x, y, angle] = [originX, originY, originAngle];
  for (let node = 1; node <= nodeCount; node++) {
    const nextX = x + Math.sin(angle) * step;
    const nextY = y - Math.cos(angle) * step;
    paintSprayStem(pixels, spray, x, y, nextX, nextY);
    [x, y] = [nextX, nextY];
    angle += curve / nodeCount;
    if (node === nodeCount) break;
    const side = node % 2 ? 1 : -1;
    paintLeavesAt(x, y, angle, side, node / nodeCount);
    if (depth > 0 && node % spray.branchEvery === 0) {
      paintShoot(pixels, spray, { x, y, angle: angle - side * between(random, 0.6, 0.9), length: length * 0.55, curve: side * 0.5, depth: depth - 1 });
    }
  }
  paintLeavesAt(x, y, angle, 1, 1);
}

// An ash leaf: a straight rachis with leaflets in opposite pairs along it and one at the tip, 7 to 13 in all.
function paintCompoundLeaf(pixels, spray, baseX, baseY, angle) {
  const { random } = spray;
  const rachis = between(random, 58, 76);
  const pairs = 3 + Math.floor(random() * 4);
  paintSprayStem(pixels, spray, baseX, baseY, baseX + Math.sin(angle) * rachis, baseY - Math.cos(angle) * rachis);
  for (let pair = 0; pair <= pairs; pair++) {
    const progress = 0.2 + 0.8 * pair / pairs;
    const nodeX = baseX + Math.sin(angle) * rachis * progress;
    const nodeY = baseY - Math.cos(angle) * rachis * progress;
    const leafletLength = between(random, 14, 21) * (1 - 0.35 * Math.abs(progress - 0.6));
    if (pair === pairs) {
      paintSprayLeaf(pixels, spray, nodeX, nodeY, angle, leafletLength, leafletLength * 0.5);
      continue;
    }
    for (const side of [-1, 1]) {
      paintSprayLeaf(pixels, spray, nodeX, nodeY, angle + side * between(random, 0.9, 1.2), leafletLength, leafletLength * 0.5, 2);
    }
  }
}

const SPRAY_RECIPES = {
  oak: { leafLength: [22, 28], leafWidth: 0.72, leafSpread: [0.7, 1.1], nodeSpacing: 12, stalk: [2, 4], leavesFrom: 0.45, tipCluster: [4, 6] },
  birch: { leafLength: [8, 13], leafWidth: 0.8, leafSpread: [0.7, 1.3], nodeSpacing: 6, stalk: [1, 3], leavesFrom: 0 },
  aspen: { leafLength: [13, 17], leafWidth: 1.0, leafSpread: [0.9, 1.5], nodeSpacing: 10, stalk: [14, 20], leavesFrom: 0, pair: true },
};

function paintSprayCell(pixels, color, random, kind, cell) {
  const spray = {
    cell, color, random, profile: LEAF_PROFILES[kind], recipe: SPRAY_RECIPES[kind], bounds: sprayBounds(cell, SPRAY_MARGIN),
    stemColor: [color[0] * 0.55, color[1] * 0.5, color[2] * 0.4], scale: between(random, 0.88, 1.12), spacing: between(random, 0.85, 1.2),
    branchEvery: random() < 0.5 ? 2 : 3,
  };
  const side = random() < 0.5 ? -1 : 1;
  const baseX = cell.x + SPRAY_CELL / 2 + between(random, -6, 6);
  const baseY = cell.y + SPRAY_CELL - SPRAY_MARGIN - 1;
  if (kind === 'ash') {
    const leaves = random() < 0.25 ? 1 : 2;
    for (let leaf = 0; leaf < leaves; leaf++) {
      const angle = leaves === 1 ? between(random, -0.1, 0.1) : (leaf - 0.5) * 0.6 + between(random, -0.1, 0.1);
      paintCompoundLeaf(pixels, spray, baseX + (leaves - 1) * (leaf - 0.5) * 12, baseY, angle);
    }
    return;
  }
  if (kind === 'birch') {
    // Pendulous twigs hang from a short bough near the top of the cell.
    const topY = cell.y + SPRAY_MARGIN + 6;
    const reach = between(random, 22, 30);
    const centerX = cell.x + SPRAY_CELL / 2;
    paintSprayStem(pixels, spray, centerX - reach, topY, centerX + reach, topY + between(random, -4, 4));
    for (const offset of [-1, 0, 1]) {
      const hanging = { x: centerX + offset * reach * 0.9, y: topY, angle: Math.PI + between(random, -0.3, 0.3), length: between(random, 60, 80), curve: between(random, -0.5, 0.5), depth: 1 };
      paintShoot(pixels, spray, hanging);
    }
    return;
  }
  const length = between(random, 62, 78);
  paintShoot(pixels, spray, { x: baseX, y: baseY, angle: between(random, -0.2, 0.2), length, curve: between(random, -0.3, 0.3), depth: 1 });
}

function paintSprayAtlas(kind) {
  return (pixels, color, random) => {
    for (let index = 0; index < 4; index++) {
      const cell = { x: (index % 2) * SPRAY_CELL, y: Math.floor(index / 2) * SPRAY_CELL };
      paintSprayCell(pixels, color, random, kind, cell);
    }
  };
}

// Boxes the painted atlas down to its final size, weighting colour by alpha so transparent pixels do not darken the edge.
function boxDownsample(source, fillColor) {
  const size = source.width / SPRAY_SCALE;
  const target = createPixels(fillColor, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sums = [0, 0, 0, 0];
      for (let dy = 0; dy < SPRAY_SCALE; dy++) {
        for (let dx = 0; dx < SPRAY_SCALE; dx++) {
          const offset = ((y * SPRAY_SCALE + dy) * source.width + x * SPRAY_SCALE + dx) * 4;
          const alpha = source.data[offset + 3];
          for (let channel = 0; channel < 3; channel++) sums[channel] += source.data[offset + channel] * alpha;
          sums[3] += alpha;
        }
      }
      const offset = (y * size + x) * 4;
      if (sums[3] > 0) for (let channel = 0; channel < 3; channel++) target.data[offset + channel] = sums[channel] / sums[3];
      target.data[offset + 3] = sums[3] / (SPRAY_SCALE * SPRAY_SCALE);
    }
  }
  return target;
}

const ALPHA_CUTOFF = 128;

function alphaTestedShare(level) {
  let passing = 0;
  for (let offset = 3; offset < level.data.length; offset += 4) if (level.data[offset] >= ALPHA_CUTOFF) passing++;
  return passing / (level.width * level.height);
}

/**
 * The mip chain of an alpha-tested card, from level 0 down to 1 px, with each level's alpha scaled so the share of texels at or above the
 * cutoff matches level 0 (Castano, "Computing alpha mipmaps"). A plain box filter loses thin stalks and small leaves at the small levels.
 */
export function createCoverageMips(base) {
  const target = alphaTestedShare(base);
  const levels = [base];
  for (let level = base; level.width > 1;) {
    level = boxDownsample(level, base.data.slice(0, 3));
    const keep = Math.round(target * level.width * level.height);
    const alphas = Array.from({ length: level.width * level.height }, (_, index) => level.data[index * 4 + 3]).sort((first, second) => second - first);
    const threshold = keep > 0 ? alphas[keep - 1] : 0;
    if (threshold > 0) for (let offset = 3; offset < level.data.length; offset += 4) level.data[offset] = Math.min(255, level.data[offset] * ALPHA_CUTOFF / threshold);
    levels.push(level);
  }
  return levels;
}

/** Leaf texture kinds painted as a 2 x 2 atlas of spray variants. `twig` stays as the name of the oak spray. */
export const SPRAY_KINDS = ['twig', 'twig-birch', 'twig-aspen', 'twig-ash'];

function paintNeedleSpray(pixels, color, random) {
  const stemColor = [color[0] * 0.7, color[1] * 0.6, color[2] * 0.5];
  paintStem(pixels, 64, 126, 64, 6, stemColor);
  for (let step = 0; step < 24; step++) {
    const baseY = 118 - step * 4.6;
    const length = 30 - step * 0.45 + random() * 4;
    for (const side of [-1, 1]) {
      paintLeaf(pixels, { baseX: 64, baseY, angle: side * (1.0 + random() * 0.2), length, width: 3.4, color, shade: 0.85 + random() * 0.3 });
    }
  }
}

function paintBlades(pixels, color, random, count, width) {
  for (let blade = 0; blade < count; blade++) {
    const spread = count > 1 ? (blade / (count - 1) - 0.5) * 0.9 : 0;
    const length = 96 + random() * 28;
    paintLeaf(pixels, { baseX: 64 + spread * 40, baseY: 127, angle: spread + (random() - 0.5) * 0.12, length, width, color, shade: 0.8 + random() * 0.4 });
  }
}

function paintClump(pixels, color, random) {
  for (let leaf = 0; leaf < 150; leaf++) {
    const angle = random() * FULL_TURN;
    const radius = Math.sqrt(random()) * 46;
    paintLeaf(pixels, {
      baseX: 64 + Math.cos(angle) * radius,
      baseY: 64 + Math.sin(angle) * radius * 0.8,
      angle: random() * FULL_TURN,
      length: 24 + random() * 12,
      width: 16 + random() * 8,
      color,
      shade: 0.6 + random() * 0.6,
    });
  }
}

function bleedColorIntoTransparentPixels(pixels, color) {
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    if (pixels.data[offset + 3] > 0) continue;
    pixels.data[offset] = color[0] * 0.8;
    pixels.data[offset + 1] = color[1] * 0.8;
    pixels.data[offset + 2] = color[2] * 0.8;
  }
}

const LEAF_PAINTERS = {
  sprig: paintSprig,
  twig: paintSprayAtlas('oak'),
  'twig-birch': paintSprayAtlas('birch'),
  'twig-aspen': paintSprayAtlas('aspen'),
  'twig-ash': paintSprayAtlas('ash'),
  needles: paintNeedleSpray,
  single: (pixels, color, random) => paintBlades(pixels, color, random, 1, 38),
  grass: (pixels, color, random) => paintBlades(pixels, color, random, 9, 7),
  clump: paintClump,
};

/** RGBA leaf texture: the stem base sits at the bottom edge, transparent elsewhere. */
export function createLeafPixels(kind, color, seed = 1) {
  const painter = Object.hasOwn(LEAF_PAINTERS, kind) ? LEAF_PAINTERS[kind] : null;
  if (!painter) throw new RangeError(`Unknown leaf texture kind: ${kind}`);
  const isSpray = SPRAY_KINDS.includes(kind);
  const painted = createPixels(color, isSpray ? TWIG_TEXTURE_SIZE * SPRAY_SCALE : TEXTURE_SIZE);
  painter(painted, color, createRandom(seed));
  const pixels = isSpray ? boxDownsample(painted, color) : painted;
  bleedColorIntoTransparentPixels(pixels, color);
  return pixels;
}

const BARK_STYLES = {
  rough: { base: [168, 142, 118], crevice: 0.28, stretch: 2 },
  birch: { base: [238, 235, 224], crevice: 0.12, stretch: 2 },
};

/** Opaque, tileable bark luminance texture with vertical furrows (rough) or dark lenticels (birch). */
export function createBarkPixels(kind, seed = 1) {
  const style = Object.hasOwn(BARK_STYLES, kind) ? BARK_STYLES[kind] : null;
  if (!style) throw new RangeError(`Unknown bark texture kind: ${kind}`);
  const pixels = createPixels(style.base);
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const unitX = x / TEXTURE_SIZE;
      const unitY = y / TEXTURE_SIZE;
      const furrow = valueNoise(unitX * 8, unitY * style.stretch, seed, 8, style.stretch);
      const fine = valueNoise(unitX * 24, unitY * 12, seed + 5, 24, 12);
      let brightness = 1 - style.crevice + style.crevice * (0.65 * furrow + 0.35 * fine) * 1.6;
      if (kind === 'birch') {
        const mark = valueNoise(unitX * 6, unitY * 40, seed + 9, 6, 40);
        if (mark > 0.7) brightness *= 0.28 + (1 - mark) * 1.6;
      } else {
        brightness *= 0.55 + 0.9 * furrow ** 1.4;
      }
      const offset = (y * TEXTURE_SIZE + x) * 4;
      for (let channel = 0; channel < 3; channel++) pixels.data[offset + channel] = clamp(style.base[channel] * brightness, 0, 255);
      pixels.data[offset + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Texture descriptor for `material.map`. Descriptors are cached per key so every tree of
 * a species shares one GPU texture. In the browser the pixels become an ImageData.
 */
export function createTextureDescriptor(cacheKey, createPixelsForKey, { repeat }) {
  if (descriptorCache.has(cacheKey)) return descriptorCache.get(cacheKey);
  const pixels = createPixelsForKey();
  const image = typeof ImageData === 'undefined' ? pixels : new ImageData(pixels.data, pixels.width, pixels.height);
  const wrap = repeat ? 10497 : 33071;
  const descriptor = { image, colorSpace: 'srgb', wrapS: wrap, wrapT: wrap, minFilter: 9987, magFilter: 9729 };
  descriptorCache.set(cacheKey, descriptor);
  return descriptor;
}

export function leafTextureDescriptor(kind, color) {
  let pixels = null;
  const descriptor = createTextureDescriptor(`leaf:${kind}:${color.join(',')}`, () => (pixels = createLeafPixels(kind, color)), { repeat: false });
  if (pixels && SPRAY_KINDS.includes(kind)) descriptor.mipLevels = createCoverageMips(pixels).slice(1);
  return descriptor;
}

export function barkTextureDescriptor(kind) {
  return createTextureDescriptor(`bark:${kind}`, () => createBarkPixels(kind), { repeat: true });
}
