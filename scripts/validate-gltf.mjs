#!/usr/bin/env node
// Runs the Khronos glTF-Validator over GLB files through loadGltf({ strict: true, validator }) (issue 2981).
// The validator is never part of the core: it is a devDependency (`npm ci` installs it), or a package folder you name with
// --validator <folder> or GLTF_VALIDATOR=<folder>.
//
//   node scripts/validate-gltf.mjs [--validator <folder>] [file-or-folder ...]
//
// With no path it checks the GLBs the repository ships (public/*.glb and public/showcase). Exit 0 when every file passes,
// 1 when a file fails, 2 when the validator cannot be found or no file was given.
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseGltf } from '../src/gltf.js';

const repositoryRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
// Node cannot decode images. This script judges the file structure and the mesh, not the pixels, so a texture decodes to a 1 x 1 stand-in.
globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });

const SHIPPED_PATHS = ['public/sample-model.glb', 'public/desk-flat-lay.glb', 'public/showcase'];

/** The validator module from a package folder, or from the installed `gltf-validator` package; null when neither resolves. */
export async function resolveValidator(packageFolder = process.env.GLTF_VALIDATOR) {
  try {
    if (packageFolder) {
      const loaded = await import(pathToFileURL(join(resolve(packageFolder), 'index.js')).href);
      return loaded.validateBytes ? loaded : loaded.default;
    }
    return await import('gltf-validator');
  } catch {
    return null;
  }
}

/** Every .glb under a file or folder, sorted. */
export async function findGlbFiles(path) {
  const information = await stat(path);
  if (!information.isDirectory()) return path.endsWith('.glb') ? [path] : [];
  const found = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    found.push(...await findGlbFiles(join(path, entry.name)));
  }
  return found.sort();
}

/** Loads one file with strict and checkMesh on; resolves to { passed, message, meshWarnings } where meshWarnings are the mesh-check warnings of a file that loaded. */
export async function validateGlbFile(path, validator) {
  const bytes = await readFile(path);
  try {
    const asset = await parseGltf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { strict: true, validator, checkMesh: true });
    const meshWarnings = asset.warnings.filter(warning => warning.startsWith('Checked primitive') || warning.startsWith('mesh checks'));
    return { passed: true, message: '', meshWarnings };
  } catch (error) {
    return { passed: false, message: error.message, meshWarnings: [] };
  }
}

function parseArguments(argumentList) {
  const paths = [];
  let validatorFolder;
  for (let index = 0; index < argumentList.length; index++) {
    if (argumentList[index] === '--validator') validatorFolder = argumentList[++index];
    else paths.push(argumentList[index]);
  }
  return { paths, validatorFolder };
}

async function main() {
  const { paths, validatorFolder } = parseArguments(process.argv.slice(2));
  const validator = await resolveValidator(validatorFolder);
  if (!validator) {
    console.error('The glTF-Validator was not found. Run npm ci (it is a devDependency), or pass --validator <folder of the gltf-validator package> or set GLTF_VALIDATOR.');
    return 2;
  }
  const targets = (paths.length ? paths.map(path => resolve(path)) : SHIPPED_PATHS.map(path => join(repositoryRoot, path)));
  const files = [];
  for (const target of targets) files.push(...await findGlbFiles(target));
  if (!files.length) {
    console.error('No .glb file found in the given paths.');
    return 2;
  }
  let failures = 0;
  for (const file of files) {
    const { passed, message, meshWarnings } = await validateGlbFile(file, validator);
    if (!passed) failures++;
    const meshNote = meshWarnings.length ? ` (${meshWarnings.length} mesh-check warning(s))` : '';
    console.log(`${passed ? 'pass' : 'FAIL'} ${relative(repositoryRoot, file) || basename(file)}${meshNote}${message ? `: ${message}` : ''}`);
  }
  console.log(`${files.length - failures} passed, ${failures} failed of ${files.length} (validator ${validator.version?.() ?? 'unknown'})`);
  return failures ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main();
}
