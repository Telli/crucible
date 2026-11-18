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
    pixels[pixel * 3 + 1] = Math.round(150 + (random() - 0.5) * 44);
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#101010"/>`
    + `<g stroke="#d8d8d2" stroke-width="2" fill="none"><path d="${ticks.join('')}"/></g>`
    + `<g fill="#d8d8d2" font-family="Arial, Helvetica, sans-serif" font-size="17">${numbers.join('')}</g></svg>`;
  return sharp(Buffer.from(svg)).png({ palette: true, colors: 16 }).toBuffer();
}

export const OBJECTIVES = Object.freeze([
  { label: '4x 0.10', ring: '#c8261f' },
  { label: '10x 0.25', ring: '#e8c21a' },
  { label: '40x 0.65', ring: '#2f7fd0' },
  { label: '100x 1.25 oil', ring: '#f0f0ea' },
]);

/** One 512 by 128 strip per objective, stacked: a silver barrel, the magnification colour ring and the engraved label centred on u = 0.5. */
export function objectiveTexture() {
  const width = 512;
  const rowHeight = 128;
  const rows = OBJECTIVES.map((objective, index) => {
    const top = index * rowHeight;
    return `<g transform="translate(0 ${top})"><rect width="${width}" height="${rowHeight}" fill="#c4c7cb"/>`
      + `<rect y="8" width="${width}" height="${rowHeight - 16}" fill="#a9adb2"/>`
      + `<rect y="34" width="${width}" height="9" fill="#0c0c0c"/><rect y="43" width="${width}" height="16" fill="${objective.ring}"/><rect y="59" width="${width}" height="5" fill="#0c0c0c"/>`
      + `<rect x="${width / 2 - 120}" y="72" width="240" height="34" rx="4" fill="#111"/>`
      + `<text x="${width / 2}" y="96" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="23" fill="#f2f2ee">${objective.label}</text></g>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${rowHeight * OBJECTIVES.length}">${rows}</svg>`;
  return sharp(Buffer.from(svg)).png({ palette: true, colors: 32 }).toBuffer();
}
