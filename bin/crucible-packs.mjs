// `crucible packs add|list|remove`: installs pinned data-only packs into the default pack folder (docs/packs.md).
// A pack is downloaded from one pinned GitHub Release asset, checked against the sha256 in bin/pack-pins.json and only then
// unpacked. MCP tools never download; this command is the one step a person runs.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultPacksFolder } from './crucible-pack-folder.mjs';
import { readZip } from './crucible-zip-reader.mjs';

export { defaultPacksFolder };

export const PACK_MANIFEST_FILE = 'crucible-pack.json';
export const RELEASE_URL_PREFIX = 'https://github.com/codepawl/crucible/releases/download/';
// The same limits the pack loader applies (src/pack-manifest.js).
export const PACK_LIMITS = Object.freeze({ maximumFiles: 256, maximumBytes: 256 * 1024 * 1024, maximumFileBytes: 64 * 1024 * 1024 });
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const PACK_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const PINS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'pack-pins.json');

export const PACKS_USAGE = `Usage: crucible packs add <name>
       crucible packs list
       crucible packs remove <name>
Packs install into ~/.crucible/packs (or CRUCIBLE_PACKS_HOME), which crucible-mcp reads when --packs is not given.`;

function checkPackName(name) {
  if (typeof name !== 'string' || !PACK_NAME_PATTERN.test(name)) {
    throw new TypeError(`"${name}" is not a pack name; pass lowercase letters, digits and hyphens, such as vegetation-scans.`);
  }
  return name;
}

function checkPin(name, pin) {
  const where = `bin/pack-pins.json pack "${name}"`;
  checkPackName(name);
  if (typeof pin?.version !== 'string' || !VERSION_PATTERN.test(pin.version)) throw new TypeError(`${where}: version must look like 1.2.0.`);
  if (typeof pin.url !== 'string' || !pin.url.startsWith(RELEASE_URL_PREFIX) || pin.url.includes('..')) throw new TypeError(`${where}: url must be a release asset under ${RELEASE_URL_PREFIX}.`);
  if (typeof pin.sha256 !== 'string' || !SHA256_PATTERN.test(pin.sha256)) throw new TypeError(`${where}: sha256 must be 64 lowercase hex digits.`);
  if (!Number.isInteger(pin.bytes) || pin.bytes < 1 || pin.bytes > PACK_LIMITS.maximumBytes) throw new TypeError(`${where}: bytes must be a whole number from 1 to ${PACK_LIMITS.maximumBytes}.`);
  return Object.freeze({ name, version: pin.version, url: pin.url, sha256: pin.sha256, bytes: pin.bytes });
}

/** Reads and checks the pin file: { name: { name, version, url, sha256, bytes } }. */
export function loadPins(pinsJson = JSON.parse(readFileSync(PINS_PATH, 'utf8'))) {
  if (pinsJson?.schemaVersion !== 1 || typeof pinsJson.packs !== 'object' || pinsJson.packs === null) {
    throw new TypeError('bin/pack-pins.json must be { "schemaVersion": 1, "packs": { ... } }.');
  }
  const pins = {};
  for (const [name, pin] of Object.entries(pinsJson.packs)) pins[name] = checkPin(name, pin);
  return Object.freeze(pins);
}

function pinFor(name, pins) {
  checkPackName(name);
  const pin = pins[name];
  if (pin) return pin;
  const known = Object.keys(pins);
  const choices = known.length > 0 ? `use one of ${known.join(', ')}` : 'this version of Crucible pins no packs yet; update Crucible, or unzip a pack into the folder by hand';
  throw new RangeError(`No pinned pack named "${name}"; ${choices}.`);
}

async function readLimited(response, pin) {
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > pin.bytes) throw new Error(`The download of ${pin.name} is larger than the pinned ${pin.bytes} bytes, so it is not the pinned release. Nothing was installed. Update Crucible, or report it.`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Downloads the pinned asset and returns its bytes only when size and sha256 match the pin. */
export async function downloadPinned(pin, { fetchImplementation = fetch, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetchImplementation(pin.url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`Could not download ${pin.name} from ${pin.url} (${error.message}). Nothing was installed. Check the connection and run the command again.`);
  }
  if (!response.ok) throw new Error(`Downloading ${pin.name} returned HTTP ${response.status}. Nothing was installed. Run the command again later, or update Crucible if the release moved.`);
  const bytes = await readLimited(response, pin);
  if (bytes.length !== pin.bytes) throw new Error(`The download of ${pin.name} stopped at ${bytes.length} of ${pin.bytes} bytes. Nothing was installed. Run the command again.`);
  return checkChecksum(bytes, pin);
}

/** Throws unless the bytes hash to the pinned sha256. */
export function checkChecksum(bytes, pin) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== pin.sha256) throw new Error(`The download of ${pin.name} has sha256 ${actual}, not the pinned ${pin.sha256}. Nothing was installed. Run the command again; if it repeats, the release changed and Crucible needs an update.`);
  return bytes;
}

function readManifest(files, pin) {
  const manifestFile = files.find(file => file.name === PACK_MANIFEST_FILE);
  if (!manifestFile) throw new Error(`The ${pin.name} zip has no ${PACK_MANIFEST_FILE} at its root. Nothing was installed.`);
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.data.toString('utf8'));
  } catch (error) {
    throw new Error(`The ${pin.name} ${PACK_MANIFEST_FILE} is not JSON (${error.message}). Nothing was installed.`);
  }
  if (manifest.name !== pin.name || manifest.version !== pin.version) {
    throw new Error(`The zip holds pack ${manifest.name} ${manifest.version}, but the pin is ${pin.name} ${pin.version}. Nothing was installed.`);
  }
  return manifest;
}

async function writeFiles(folder, files) {
  for (const file of files) {
    const target = resolve(folder, file.name);
    if (!target.startsWith(folder + sep)) throw new Error(`Entry ${file.name} would land outside the pack folder. Nothing was installed.`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.data);
  }
}

/** Moves staging into place; a pack already there is kept until the new one is in, and put back if the move fails. */
async function swapIntoPlace(staging, target, backup) {
  const hadPack = existsSync(target);
  if (hadPack) await rename(target, backup);
  try {
    await rename(staging, target);
  } catch (error) {
    if (hadPack) await rename(backup, target);
    throw new Error(`Could not move the new pack into ${target} (${error.message}). The old pack is unchanged. Close programs that use it, such as a running crucible-mcp, and run the command again.`);
  }
  if (hadPack) await rm(backup, { recursive: true, force: true });
}

/** Unpacks checked zip bytes into <root>/<name>. Staging folders start with a dot, so the pack loader skips them. */
export async function installPackBytes(bytes, pin, root) {
  const files = readZip(bytes, PACK_LIMITS);
  readManifest(files, pin);
  await mkdir(root, { recursive: true });
  const staging = join(root, `.staging-${pin.name}-${process.pid}`);
  const target = join(root, pin.name);
  await rm(staging, { recursive: true, force: true });
  try {
    await mkdir(staging);
    await writeFiles(staging, files);
    await swapIntoPlace(staging, target, join(root, `.old-${pin.name}-${process.pid}`));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { name: pin.name, version: pin.version, folder: target, files: files.length };
}

export async function addPack(name, { pins = loadPins(), root = defaultPacksFolder(), fetchImplementation } = {}) {
  const pin = pinFor(name, pins);
  const bytes = await downloadPinned(pin, { fetchImplementation });
  return installPackBytes(bytes, pin, root);
}

/** Installed packs: [{ name, version, folder, pinnedVersion }]. A folder without a readable manifest is listed with its problem. */
export async function listPacks({ pins = loadPins(), root = defaultPacksFolder() } = {}) {
  if (!existsSync(root)) return [];
  const listed = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const row = { folder: entry.name, pinnedVersion: pins[entry.name]?.version ?? null };
    try {
      const manifest = JSON.parse(await readFile(join(root, entry.name, PACK_MANIFEST_FILE), 'utf8'));
      listed.push({ ...row, name: manifest.name, version: manifest.version });
    } catch (error) {
      listed.push({ ...row, name: null, version: null, problem: `no readable ${PACK_MANIFEST_FILE}` });
    }
  }
  return listed.sort((first, second) => first.folder.localeCompare(second.folder));
}

/** Deletes <root>/<name> only when it is a pack folder (it holds a manifest). */
export async function removePack(name, { root = defaultPacksFolder() } = {}) {
  checkPackName(name);
  const target = join(root, name);
  if (!existsSync(join(target, PACK_MANIFEST_FILE))) throw new RangeError(`No installed pack "${name}" in ${root}; crucible packs list shows what is installed.`);
  await rm(target, { recursive: true, force: true });
  return { name, folder: target };
}

function describeRow(row) {
  if (row.problem) return `${row.folder}  (${row.problem})`;
  const update = row.pinnedVersion && row.pinnedVersion !== row.version ? `, pinned ${row.pinnedVersion}: run crucible packs add ${row.name}` : '';
  return `${row.name} ${row.version}${update}`;
}

/** Runs `crucible packs ...` and returns the exit code. */
export async function runPacksCommand(argumentList, { log = console.log, error = console.error, ...options } = {}) {
  const [action, name, ...extra] = argumentList;
  try {
    if (extra.length > 0) throw new TypeError(`${extra.join(' ')}: one pack name at a time.`);
    if (action === 'add' && name) {
      const result = await addPack(name, options);
      log(`Installed ${result.name} ${result.version} (${result.files} files) into ${result.folder}. crucible-mcp reads it on its next start.`);
    } else if (action === 'list' && !name) {
      const root = options.root ?? defaultPacksFolder();
      const rows = await listPacks({ ...options, root });
      log(rows.length > 0 ? rows.map(describeRow).join('\n') : `No packs installed in ${root}.`);
    } else if (action === 'remove' && name) {
      const result = await removePack(name, options);
      log(`Removed ${result.name} from ${result.folder}.`);
    } else {
      error(PACKS_USAGE);
      return 1;
    }
    return 0;
  } catch (failure) {
    error(`crucible packs: ${failure.message}`);
    return 1;
  }
}
