// Scores the stills of scripts/capture-water-aliasing.mjs. For the far third of the water rows it prints:
//   errorEnergy  mean square of the high-pass of (frame - supersampled reference): the aliasing the frame adds
//   frameEnergy  mean square of the high-pass of the frame; referenceEnergy the same for the reference
//   flicker      mean square change of (frame - reference) between pan steps: shimmer that is not real motion
//   node scripts/score-water-aliasing.mjs [--reference <directory with the *-ref.png stills>] <directory with the stills> [more directories]
// Always pass one fixed --reference when you compare two checkouts. Without it each directory is scored against the *-ref.png stills
// beside its own frames, and a change to the water shader also changes that reference, so the scores are not comparable (#2167: main read
// 97.9 against its own reference and 22.7 against the pre-#910 one).
import sharp from 'sharp';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VIEWS = ['beauty', 'low'];
const PAN_COUNT = 3;
const SUPERSAMPLE = 3;

async function luminanceOf(path, downsample) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width / downsample;
  const height = info.height / downsample;
  const luminance = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < downsample; dy += 1) {
        for (let dx = 0; dx < downsample; dx += 1) {
          const offset = ((y * downsample + dy) * info.width + x * downsample + dx) * 3;
          sum += 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
        }
      }
      luminance[y * width + x] = sum / (downsample * downsample);
    }
  }
  return { luminance, width, height };
}

function highPass(luminance, width, height) {
  const result = new Float64Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) sum += luminance[(y + dy) * width + x + dx];
      }
      result[y * width + x] = luminance[y * width + x] - sum / 9;
    }
  }
  return result;
}

// The horizon is the first row from the top whose centre is clearly darker than the row above it (the sea against the sky).
function horizonRow(reference, width, height) {
  const column = width >> 1;
  for (let y = 20; y < height - 8; y += 1) {
    if (reference[(y - 8) * width + column] - reference[(y + 8) * width + column] > 12) return y;
  }
  return height >> 1;
}

function meanSquare(values, width, firstRow, lastRow) {
  let sum = 0;
  let count = 0;
  for (let y = firstRow; y < lastRow; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      sum += values[y * width + x] ** 2;
      count += 1;
    }
  }
  return sum / count;
}

function difference(first, second) {
  return first.map((value, index) => value - second[index]);
}

export function parseArguments(argumentList) {
  const frameDirectories = [];
  let referenceDirectory;
  for (let index = 0; index < argumentList.length; index += 1) {
    const argument = argumentList[index];
    if (argument === '--reference') {
      referenceDirectory = argumentList[index + 1];
      if (!referenceDirectory || referenceDirectory.startsWith('--')) {
        throw new Error('--reference needs a directory that holds the *-ref.png stills: --reference <directory>');
      }
      index += 1;
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option ${argument}. Use --reference <directory> and list the directories with the frames.`);
    } else {
      frameDirectories.push(argument);
    }
  }
  if (frameDirectories.length === 0) {
    throw new Error('Pass at least one directory with the *-n.png stills: node scripts/score-water-aliasing.mjs [--reference <directory>] <directory>...');
  }
  return {
    frameDirectories: frameDirectories.map((directory) => resolve(directory)),
    referenceDirectory: referenceDirectory === undefined ? undefined : resolve(referenceDirectory),
  };
}

export function framePaths(frameDirectory, referenceDirectory, view, pan) {
  return {
    frame: join(frameDirectory, `${view}-${pan}-n.png`),
    reference: join(referenceDirectory ?? frameDirectory, `${view}-${pan}-ref.png`),
  };
}

async function scoreDirectory(directory, referenceDirectory) {
  const report = {};
  for (const view of VIEWS) {
    const errors = [];
    const frames = [];
    let frameEnergy = 0;
    let referenceEnergy = 0;
    let errorEnergy = 0;
    let region;
    let frameWidth;
    for (let pan = 0; pan < PAN_COUNT; pan += 1) {
      const paths = framePaths(directory, referenceDirectory, view, pan);
      const frame = await luminanceOf(paths.frame, 1);
      const reference = await luminanceOf(paths.reference, SUPERSAMPLE);
      const { width, height } = frame;
      frameWidth = width;
      const horizon = horizonRow(reference.luminance, width, height);
      region ??= [horizon + 4, horizon + 4 + Math.floor((height - horizon - 4) / 3)];
      const error = difference(frame.luminance, reference.luminance);
      errors.push(error);
      frames.push(frame.luminance);
      frameEnergy += meanSquare(highPass(frame.luminance, width, height), width, ...region);
      referenceEnergy += meanSquare(highPass(reference.luminance, width, height), width, ...region);
      errorEnergy += meanSquare(highPass(error, width, height), width, ...region);
    }
    let flicker = 0;
    for (let pan = 1; pan < PAN_COUNT; pan += 1) {
      flicker += meanSquare(difference(errors[pan], errors[pan - 1]), frameWidth, ...region) / (PAN_COUNT - 1);
    }
    report[view] = {
      farRows: region,
      frameEnergy: Number((frameEnergy / PAN_COUNT).toFixed(3)),
      referenceEnergy: Number((referenceEnergy / PAN_COUNT).toFixed(3)),
      errorEnergy: Number((errorEnergy / PAN_COUNT).toFixed(3)),
      flicker: Number(flicker.toFixed(3)),
    };
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { frameDirectories, referenceDirectory } = parseArguments(process.argv.slice(2));
  for (const directory of frameDirectories) {
    console.log(directory, JSON.stringify(await scoreDirectory(directory, referenceDirectory), null, 1));
  }
}
