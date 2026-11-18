// The small textures of the sample microscope (public/sample-model.glb), drawn in code so the GLB carries no outside image:
// a paint grain, brushed metal, a knurl normal map, the stage scale and the objective labels. Used by texture-sample-model.mjs.
import sharp from 'sharp';

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function encodePng(pixels, width, height, channels) {
  return sharp(pixels, { raw: { width, height, channels } }).png({ compressionLevel: 9 }).toBuffer();
}

/** Occlusion, roughness and metalness of a painted or rubber surface: roughness wobbles around the middle, metalness is left to the material factor. */
export function grainTexture() {
  const size = 64;
  const random = makeRandom(11);
  const pixels = Buffer.alloc(size * size * 3);
  for (let pixel = 0; pixel < size * size; pixel++) {
    pixels[pixel * 3] = 255;
    pixels[pixel * 3 + 1] = Math.round(240 + (random() - 0.5) * 30);
    pixels[pixel * 3 + 2] = 255;
  }
  return encodePng(pixels, size, size, 3);
}

/** Roughness streaks along u, one random level per row, with a little variation along the row. Metalness is full, so a material factor sets it. */
export function brushedTexture() {
  const size = 64;
  const random = makeRandom(23);
  const pixels = Buffer.alloc(size * size * 3);
  for (let row = 0; row < size; row++) {
    const rowLevel = 105 + (random() - 0.5) * 70;
    for (let column = 0; column < size; column++) {
      const offset = (row * size + column) * 3;
      pixels[offset] = 255;
      pixels[offset + 1] = Math.round(rowLevel + (random() - 0.5) * 12);
      pixels[offset + 2] = 255;
    }
  }
  return encodePng(pixels, size, size, 3);
}

export const KNURL_TEETH_PER_TILE = 4;
export const KNURL_FLAT_V = 0.9;

/** A straight knurl as a tangent-space normal map: four teeth across u in the first twelve rows, a flat strip in the last four for the end faces. */
export function knurlNormalTexture() {
  const width = 64;
  const height = 16;
  const knurledRows = 12;
  const pixels = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const phase = ((column + 0.5) / width) * KNURL_TEETH_PER_TILE * Math.PI * 2;
      const slope = row < knurledRows ? -Math.sin(phase) * 0.85 : 0;
      const length = Math.hypot(slope, 1);
      const offset = (row * width + column) * 3;
      pixels[offset] = Math.round((slope / length * 0.5 + 0.5) * 255);
      pixels[offset + 1] = 128;
      pixels[offset + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
    }
  }
  return encodePng(pixels, width, height, 3);
}

/** Where the stage scale sits in the picture, as fractions of its width and height, so the mesh code can keep its UVs on blank black elsewhere. */
export const STAGE_BLANK_UV = Object.freeze([0.5, 0.35]);

/** The black stage top with a millimetre scale along the front edge and the right edge: a tick every 1 mm, longer at 5 and 10, numbers every 10. */
export function stageTexture() {
  const size = 512;
  const ticks = [];
  const numbers = [];
  for (let millimetre = 0; millimetre <= 100; millimetre++) {
    const offset = 24 + millimetre * 4.4;
    const length = millimetre % 10 === 0 ? 26 : millimetre % 5 === 0 ? 18 : 10;
    ticks.push(`M${offset} ${size - 16}v${-length}`);
    ticks.push(`M${size - 16} ${size - offset}h${-length}`);
    if (millimetre % 10 === 0 && millimetre > 0 && millimetre < 100) {
      numbers.push(`<text x="${offset}" y="${size - 50}" text-anchor="middle">${millimetre}</text>`);
      numbers.push(`<text x="${size - 56}" y="${size - offset + 5}" text-anchor="end">${millimetre}</text>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#1b1514"/>`
    + `<g stroke="#d8d8d2" stroke-width="2" fill="none"><path d="${ticks.join('')}"/></g>`
    + `<g fill="#d8d8d2" font-family="Arial, Helvetica, sans-serif" font-size="17">${numbers.join('')}</g></svg>`;
  return sharp(Buffer.from(svg)).png({ palette: true, colors: 16 }).toBuffer();
}

/**
 * The four objectives, with the colour code of the magnification (red, yellow, blue, white) and how far the label must be
 * stretched sideways: a barrel is wrapped around by the same 1024 texels whatever its length, so a short barrel needs less.
 */
export const OBJECTIVES = Object.freeze([
  { magnification: '4x', aperture: 'NA 0.10', ring: '#d12b22', stretch: 1.4 },
  { magnification: '10x', aperture: 'NA 0.25', ring: '#f0c418', stretch: 1.9 },
  { magnification: '40x', aperture: 'NA 0.65', ring: '#2f7fd0', stretch: 1.9 },
  { magnification: '100x', aperture: 'NA 1.25', ring: '#f2f2ec', stretch: 2.6, oil: true },
]);

const OBJECTIVE_STRIP = Object.freeze({ width: 1024, height: 256 });

/** One strip, top to tip: thread, silver collar, the colour band, a graphite body with the label in white print, a silver nose. */
function objectiveStrip(objective, index) {
  const { width, height } = OBJECTIVE_STRIP;
  const centre = width / 2;
  const black = (y, thickness) => `<rect y="${y}" width="${width}" height="${thickness}" fill="#0b0b0c"/>`;
  const oilRing = objective.oil ? `<rect y="222" width="${width}" height="20" fill="#0b0b0c"/>` : '';
  const print = `<g transform="translate(${centre} 0) scale(${objective.stretch} 1)" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" fill="#f4f4ef">`
    + `<text y="132" font-size="64">${objective.magnification}</text>`
    + `<text y="168" font-size="30">${objective.aperture}</text>`
    + `<text y="198" font-size="26" font-weight="normal">160/0.17</text>`
    + (objective.oil ? '<text y="238" font-size="19">OIL</text>' : '') + '</g>';
  return `<g transform="translate(0 ${index * height})"><rect width="${width}" height="${height}" fill="#2a2b2f"/>`
    + `<rect width="${width}" height="12" fill="#18181a"/><rect y="12" width="${width}" height="18" fill="#c3b9ab"/>`
    + black(30, 6) + `<rect y="36" width="${width}" height="32" fill="${objective.ring}"/>` + black(68, 6)
    + black(204, 4) + `<rect y="208" width="${width}" height="48" fill="#c3b9ab"/>` + oilRing + print + '</g>';
}

/** One 1024 by 256 strip per objective, stacked into one picture. */
export function objectiveTexture() {
  const { width, height } = OBJECTIVE_STRIP;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height * OBJECTIVES.length}">${OBJECTIVES.map(objectiveStrip).join('')}</svg>`;
  return sharp(Buffer.from(svg)).png({ palette: true, colors: 32 }).toBuffer();
}
