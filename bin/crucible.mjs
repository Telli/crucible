#!/usr/bin/env node
// The crucible command line. `crucible pack <scene.json> --out <dir>` compiles a recipe into a runtime-only web bundle (docs/pack.md).
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: crucible pack <scene.json> --out <dir> [--poster <picture.webp>] [--runtime <crucible-scene.js>]';
const PACK_FLAGS = Object.freeze(['--out', '--poster', '--runtime']);

export function parsePackArguments(argumentList) {
  const options = { recipePath: null };
  for (let index = 0; index < argumentList.length; index += 1) {
    const argument = argumentList[index];
    if (PACK_FLAGS.includes(argument)) {
      const value = argumentList[index + 1];
      if (value === undefined || value.startsWith('--')) throw new TypeError(`${argument}: pass a value, such as ${argument} <path>.`);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument.startsWith('--')) {
      throw new TypeError(`${argument}: unknown option; crucible pack takes ${PACK_FLAGS.join(', ')}.`);
    } else if (options.recipePath === null) {
      options.recipePath = argument;
    } else {
      throw new TypeError(`${argument}: only one scene.json can be packed at a time; pass the others in separate runs.`);
    }
  }
  return options;
}

// A published package carries build/scene-pack.js; a source checkout runs src/scene-pack.js directly.
async function loadPackModule() {
  const built = join(packageRoot, 'build', 'scene-pack.js');
  return import(pathToFileURL(existsSync(built) ? built : join(packageRoot, 'src', 'scene-pack.js')).href);
}

async function main(argumentList) {
  const [command, ...rest] = argumentList;
  if (command !== 'pack') {
    console.error(command === undefined ? USAGE : `${command}: unknown command; the only command is pack.\n${USAGE}`);
    return 1;
  }
  try {
    const options = parsePackArguments(rest);
    const { packRecipeFile } = await loadPackModule();
    const result = await packRecipeFile({
      recipePath: options.recipePath,
      outDir: options.out,
      posterPath: options.poster,
      runtimePath: options.runtime,
      packageRoot,
    });
    console.log(`Packed ${result.packBytes} bytes into ${result.outDir}: ${result.files.join(', ')}`);
    return 0;
  } catch (error) {
    console.error(`crucible pack: ${error.message}\n${USAGE}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
