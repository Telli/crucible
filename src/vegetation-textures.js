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

function paintStem(pixels, fromX, fromY, toX, toY, color) {
  const steps = Math.ceil(Math.hypot(toX - fromX, toY - fromY) * 2);
  for (let step = 0; step <= steps; step++) {
    const progress = step / steps;
    const x = Math.round(fromX + (toX - fromX) * progress);
    const y = Math.round(fromY + (toY - fromY) * progress);
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
// of 20 to 35 cm is a 43 to 75 px rachis with 7 to 13 leaflets. Leaves sit on stems with gaps between them, so a spray is an open shoot and
// not the solid disc the first twig card was.
export const TWIG_TEXTURE_SIZE = 256;
const SPRAY_CELL = TWIG_TEXTURE_SIZE / 2;

const LEAF_PROFILES = {
  oak: along => Math.sin(Math.PI * along ** 0.8) * (0.45 + 0.55 * Math.abs(Math.sin(along * Math.PI * 3.5))),
  birch: along => (along < 0.3 ? (along / 0.3) ** 0.7 : ((1 - along) / 0.7) ** 0.9),
  aspen: along => Math.sqrt(Math.max(0, 1 - (2 * along - 1) ** 2)) * (1 - 0.3 * along ** 6),
  ash: along => Math.sin(Math.PI * along ** 0.85),
};

function between(random, low, high) {
  return low + random() * (high - low);
}

// One leaf or leaflet in a cell, on a stalk of `stalk` px that is painted first. The leaf cannot leave its cell.
function paintSprayLeaf(pixels, spray, baseX, baseY, angle, length, width, stalk = 0) {
  const { cell, color, random, profile } = spray;
  let startX = baseX;
  let startY = baseY;
  if (stalk > 0) {
    startX = baseX + Math.sin(angle) * stalk;
    startY = baseY - Math.cos(angle) * stalk;
    paintStem(pixels, Math.round(baseX), Math.round(baseY), Math.round(startX), Math.round(startY), spray.stemColor);
  }
  const bounds = { minX: cell.x, maxX: cell.x + SPRAY_CELL - 1, minY: cell.y, maxY: cell.y + SPRAY_CELL - 1 };
  paintLeaf(pixels, { baseX: startX, baseY: startY, angle, length, width, color, shade: between(random, 0.7, 1.15), profile, bounds });
}

// A shoot grows from (x, y) along `angle` and curves by `curve` radians over its length. Each node carries a leaf on alternating sides, or a
// pair of leaves, on a stalk, and the tip a leaf of its own. Shoots of depth 1 or more branch toward both sides.
function paintShoot(pixels, spray, shoot) {
  const { random, recipe } = spray;
  const { x: originX, y: originY, angle: originAngle, length, curve, depth } = shoot;
  const nodeCount = Math.max(2, Math.round(length / recipe.nodeSpacing));
  const step = length / nodeCount;
  let x = originX;
  let y = originY;
  let angle = originAngle;
  const stalkLength = () => (recipe.stalk ? between(random, ...recipe.stalk) : 0);
  for (let node = 1; node <= nodeCount; node++) {
    const nextX = x + Math.sin(angle) * step;
    const nextY = y - Math.cos(angle) * step;
    paintStem(pixels, Math.round(x), Math.round(y), Math.round(nextX), Math.round(nextY), spray.stemColor);
    x = nextX;
    y = nextY;
    angle += curve / nodeCount;
    const taper = 1 - 0.3 * node / nodeCount;
    const leafLength = between(random, ...recipe.leafLength) * taper;
    const side = node % 2 ? 1 : -1;
    paintSprayLeaf(pixels, spray, x, y, angle + side * between(random, ...recipe.leafSpread), leafLength, leafLength * recipe.leafWidth, stalkLength());
    if (depth > 0 && node % recipe.branchEvery === 0 && node < nodeCount) {
      paintShoot(pixels, spray, { x, y, angle: angle - side * between(random, 0.6, 0.9), length: length * 0.5, curve: side * 0.5, depth: depth - 1 });
    }
  }
  const tipLength = between(random, ...recipe.leafLength) * 0.8;
  paintSprayLeaf(pixels, spray, x, y, angle, tipLength, tipLength * recipe.leafWidth, stalkLength());
}

// An ash leaf: a rachis with leaflets in opposite pairs and one at the tip, longest at the middle.
function paintCompoundLeaf(pixels, spray, baseX, baseY, angle) {
  const { random } = spray;
  const rachis = between(random, 53, 72);
  const pairs = 3 + Math.floor(random() * 3);
  const tipX = baseX + Math.sin(angle) * rachis;
  const tipY = baseY - Math.cos(angle) * rachis;
  paintStem(pixels, Math.round(baseX), Math.round(baseY), Math.round(tipX), Math.round(tipY), spray.stemColor);
  for (let pair = 0; pair <= pairs; pair++) {
    const progress = 0.25 + 0.75 * pair / pairs;
    const nodeX = baseX + Math.sin(angle) * rachis * progress;
    const nodeY = baseY - Math.cos(angle) * rachis * progress;
    const leafletLength = between(random, 15, 21) * (1 - 0.35 * Math.abs(progress - 0.6));
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
  oak: { leafLength: [21, 26], leafWidth: 0.66, leafSpread: [0.7, 1.1], nodeSpacing: 12, branchEvery: 2 },
  birch: { leafLength: [8, 15], leafWidth: 0.9, leafSpread: [0.6, 1.2], nodeSpacing: 5, branchEvery: 3, stalk: [1, 3] },
  aspen: { leafLength: [14, 17], leafWidth: 1.0, leafSpread: [0.5, 1.0], nodeSpacing: 9, branchEvery: 2, stalk: [12, 22] },
};

function paintSprayCell(pixels, color, random, kind, cell) {
  const spray = { cell, color, random, profile: LEAF_PROFILES[kind], recipe: SPRAY_RECIPES[kind], stemColor: [color[0] * 0.55, color[1] * 0.5, color[2] * 0.4] };
  const baseX = cell.x + SPRAY_CELL / 2 + between(random, -6, 6);
  const baseY = cell.y + SPRAY_CELL - 3;
  if (kind === 'ash') {
    const leaves = 2 + Math.floor(random() * 2);
    for (let leaf = 0; leaf < leaves; leaf++) {
      const angle = (leaf - (leaves - 1) / 2) * 0.85 + between(random, -0.15, 0.15);
      paintCompoundLeaf(pixels, spray, baseX, baseY - 2 * leaf, angle);
    }
    return;
  }
  paintShoot(pixels, spray, { x: baseX, y: baseY, angle: between(random, -0.2, 0.2), length: 76, curve: between(random, -0.3, 0.3), depth: 1 });
}

function paintSprayAtlas(kind) {
  return (pixels, color, random) => {
    for (let index = 0; index < 4; index++) {
      paintSprayCell(pixels, color, random, kind, { x: (index % 2) * SPRAY_CELL, y: Math.floor(index / 2) * SPRAY_CELL });
    }
  };
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
  const pixels = createPixels(color, SPRAY_KINDS.includes(kind) ? TWIG_TEXTURE_SIZE : TEXTURE_SIZE);
  painter(pixels, color, createRandom(seed));
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
  return createTextureDescriptor(`leaf:${kind}:${color.join(',')}`, () => createLeafPixels(kind, color), { repeat: false });
}

export function barkTextureDescriptor(kind) {
  return createTextureDescriptor(`bark:${kind}`, () => createBarkPixels(kind), { repeat: true });
}
