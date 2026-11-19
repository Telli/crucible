// Averages a Radiance .hdr down to a smaller flat RGBE file so a world's sky costs kilobytes, not megabytes.
//   node scripts/downsample-hdr.mjs <source.hdr> <target.hdr> <width> <height>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseRadianceHdr } from '../src/hdri.js';
import { requireFiniteInRange } from '../src/modeling-limits.js';

/** A flat RGBE file whose pixels are block averages of `sourceBuffer`; the target is no larger than the source. */
export function downsampleHdr(sourceBuffer, targetWidth, targetHeight) {
  const { width, height, data } = parseRadianceHdr(sourceBuffer);
  requireFiniteInRange('downsampleHdr', 'width', targetWidth, 1, width, true);
  requireFiniteInRange('downsampleHdr', 'height', targetHeight, 1, height, true);
  const blockWidth = Math.floor(width / targetWidth);
  const blockHeight = Math.floor(height / targetHeight);
  const pixels = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let row = 0; row < targetHeight; row++) {
    for (let column = 0; column < targetWidth; column++) {
      const sum = [0, 0, 0];
      for (let blockRow = 0; blockRow < blockHeight; blockRow++) {
        for (let blockColumn = 0; blockColumn < blockWidth; blockColumn++) {
          const texel = ((row * blockHeight + blockRow) * width + column * blockWidth + blockColumn) * 3;
          for (let channel = 0; channel < 3; channel++) sum[channel] += data[texel + channel];
        }
      }
      const average = sum.map(value => value / (blockWidth * blockHeight));
      const brightest = Math.max(...average);
      if (brightest < 1e-32) continue;
      const exponent = Math.floor(Math.log2(brightest)) + 1;
      const scale = 256 / 2 ** exponent;
      const target = (row * targetWidth + column) * 4;
      for (let channel = 0; channel < 3; channel++) pixels[target + channel] = Math.min(255, Math.round(average[channel] * scale));
      pixels[target + 3] = exponent + 128;
    }
  }
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${targetHeight} +X ${targetWidth}\n`, 'latin1');
  const file = Buffer.concat([header, pixels]);
  const check = parseRadianceHdr(file);
  if (check.width !== targetWidth || check.height !== targetHeight) throw new Error('The sky does not parse back.');
  return file;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const [sourcePath, targetPath, widthText, heightText] = process.argv.slice(2);
  if (!sourcePath || !targetPath || !widthText || !heightText) throw new Error('Pass <source.hdr> <target.hdr> <width> <height>.');
  const file = downsampleHdr(readFileSync(sourcePath), Number(widthText), Number(heightText));
  writeFileSync(targetPath, file);
  console.log(`${targetPath}: ${file.length} bytes`);
}
