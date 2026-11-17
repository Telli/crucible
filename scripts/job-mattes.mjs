import { encodePng } from '../src/export-png.js';
import { cryptomatteByte, cryptomatteMatte, floatPassToBytes, matteToGrayRgba, objectIdMatte } from '../src/pass-compositing.js';

// The ID mattes of a render job (settings.mattes): one gray PNG per matte, white where the named part or material is drawn.
// Parts come from the exact 24-bit object ID pass, materials from the Cryptomatte pass (an 8-bit hash that two names can share).

const NAMES_IN_ERROR = 20;

function nameList(names) {
  const shown = names.slice(0, NAMES_IN_ERROR).join(', ');
  return names.length > NAMES_IN_ERROR ? `${shown}, and ${names.length - NAMES_IN_ERROR} more` : shown;
}

function coverageOf(mask) {
  let covered = 0;
  for (const value of mask) if (value) covered++;
  return covered;
}

function objectMatte({ target, index, objectPass }) {
  const ids = [];
  objectPass.info.objectNames.forEach((name, position) => { if (name === target) ids.push(position + 1); });
  if (ids.length === 0) {
    throw new Error(`mattes[${index}]: no part named "${target}" in this scene. Pass one of: ${nameList(objectPass.info.objectNames)}.`);
  }
  const mask = objectIdMatte({ pixels: objectPass.bytes, width: objectPass.width, height: objectPass.height, ids });
  return { mask, metric: { object: target, partIds: ids } };
}

function materialMatte({ target, index, cryptomattePass }) {
  const { materials } = cryptomattePass.info.cryptomatte;
  const entry = materials[target];
  if (!entry) {
    throw new Error(`mattes[${index}]: no material named "${target}" in this scene. Pass one of: ${nameList(Object.keys(materials))}.`);
  }
  const mask = cryptomatteMatte({ pixels: cryptomattePass.bytes, width: cryptomattePass.width, height: cryptomattePass.height, channel: 'material', value: entry.value });
  const sharedWith = Object.entries(materials)
    .filter(([name, other]) => name !== target && cryptomatteByte(other.value) === cryptomatteByte(entry.value))
    .map(([name]) => name);
  return { mask, metric: { material: target, ...(sharedWith.length ? { sharedWith } : {}) } };
}

/**
 * Renders the passes the mattes need through `renderPass(name)` (which returns `{ info, pixels, width, height }`, the pass info and the
 * float readback of the frame) and returns `[{ bytes, metric }]` in the order of `mattes`: the PNG file and what to report in the job metrics.
 */
export async function renderJobMattes({ mattes, renderPass }) {
  const passes = new Map();
  async function passBytes(name) {
    if (!passes.has(name)) {
      const pass = await renderPass(name);
      passes.set(name, { info: pass.info, width: pass.width, height: pass.height, bytes: floatPassToBytes(pass) });
    }
    return passes.get(name);
  }
  const results = [];
  for (const [index, matte] of mattes.entries()) {
    const built = matte.object !== undefined
      ? objectMatte({ target: matte.object, index, objectPass: await passBytes('objectId') })
      : materialMatte({ target: matte.material, index, cryptomattePass: await passBytes('cryptomatte') });
    const { width, height } = passes.get(matte.object !== undefined ? 'objectId' : 'cryptomatte');
    results.push({
      bytes: encodePng(matteToGrayRgba(built.mask), width, height),
      metric: { ...built.metric, coveragePixels: coverageOf(built.mask) },
    });
  }
  return results;
}
