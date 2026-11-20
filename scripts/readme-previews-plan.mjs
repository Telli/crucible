// The pictures at the top of README.md and how each one is made. Pure data and option parsing, so a test can read it
// without starting Chrome; scripts/render-readme-previews.mjs does the rendering.

/**
 * renderer:
 *   cook-file  a Blender demo scene, converted to a GLB and path traced with Cook (needs Blender and the Cook native addon)
 *   media      scripts/render-media.mjs on a page of the site or a showcase scene.json (Chrome, GPU)
 *   recipe     a scene recipe from scripts/readme-previews/, rendered through the MCP render job tools
 * A still that is not path traced, and every clip, is rendered STILL_SUPERSAMPLE times wider and taller than it is published and then
 * shrunk with a Lanczos filter, which measured sharper than rendering at the published size (docs/readme-previews.md has the numbers).
 * Still sizes and clip frame counts (renderFps x renderSeconds, played at playFps) match the files published in public/previews. A clip keeps its WebP under maxBytes.
 */
export const PREVIEWS = [
  { name: 'hero-classroom', kind: 'still', renderer: 'cook-file', width: 1600, height: 900, quality: 86,
    source: 'classroom', samples: 512, bounces: 8,
    eye: [2.5764, 1.0945, 4.4658], target: [0.962, 1.1662, -1.7321], fov: 39.6 },
  { name: 'feature-clockwork', kind: 'clip', renderer: 'media', width: 480, height: 270, renderFps: 15, renderSeconds: 5, playFps: 15, maxBytes: 497270,
    mediaArguments: ['--scene', 'motion'] },
  { name: 'feature-flicker-fixed', kind: 'clip', renderer: 'recipe', width: 480, height: 270, renderFps: 10, renderSeconds: 5, playFps: 20, maxBytes: 417886,
    recipe: 'flicker-fixed' },
  { name: 'feature-cook-dof', kind: 'clip', renderer: 'recipe', width: 480, height: 270, renderFps: 12, renderSeconds: 4, playFps: 12, maxBytes: 228578, cook: true,
    recipe: 'cook-dof', samples: 24 },
  { name: 'showcase-airport', kind: 'still', renderer: 'media', width: 1280, height: 720, quality: 82,
    mediaArguments: ['--scene', 'file', '--config', 'public/showcase/airport/scene.json'] },
  { name: 'showcase-port', kind: 'still', renderer: 'media', width: 1280, height: 720, quality: 82,
    mediaArguments: ['--scene', 'file', '--config', 'public/showcase/port/scene.json'] },
  { name: 'cook-monk', kind: 'still', renderer: 'cook-file', width: 1600, height: 1200, quality: 86,
    source: 'monk', samples: 512, bounces: 8,
    eye: [20, 0.9, -9.5], target: [20, 0.9, -19.5], fov: 55.7945 },
];

/** The Blender demo files the cook-file previews start from (all CC0 or CC-BY, credited in README.md). */
export const DEMO_SOURCES = {
  classroom: { url: 'https://download.blender.org/demo/test/classroom.zip', zipped: true },
  monk: { url: 'https://download.blender.org/demo/cycles/lone-monk_cycles_and_exposure-node_demo.blend', zipped: false },
};

/** README pictures this script does not rebuild: the object studio tile stays the published file. */
export const KEPT_README_PICTURES = ['cook-pabellon'];

export const PREVIEW_STILL_WIDTH = 640;
export const STILL_SUPERSAMPLE = 2;
export const PREVIEW_COOK_SAMPLES = 16;

export const USAGE = `Rebuild the pictures at the top of README.md.

Usage: node scripts/render-readme-previews.mjs [name ...] [options]

  name ...            only these previews (default: all ${PREVIEWS.length}): ${PREVIEWS.map(preview => preview.name).join(', ')}
  --preview <dir>     small, low-quality renders written to <dir> instead of public/previews
  --pairs <dir>       also write readme-<name>-pair.png (stills) or .mp4 (clips), old left and new right, into <dir>
  --skip-cook         leave out the previews that need the Cook native addon and Blender (hero-classroom, cook-monk, feature-cook-dof)
  --cache <dir>       where the Blender demo files and their GLBs are kept (default ~/.cache/crucible-readme-previews)
  --work <dir>        scratch folder for frames and clips (default artifacts/readme-previews)
  --help              print this text`;

const VALUE_OPTIONS = new Set(['--preview', '--pairs', '--cache', '--work']);
const SWITCH_OPTIONS = new Set(['--skip-cook', '--help']);

/** True for a preview that needs the Cook native addon, and Blender for its demo scene. */
export function needsCook(preview) {
  return preview.renderer === 'cook-file' || preview.cook === true;
}

/** Turns the command line into { names, preview, pairs, skipCook, cache, work, help }; throws an error that says what to pass instead. */
export function parseArguments(argumentList) {
  const options = { names: [], preview: null, pairs: null, skipCook: false, cache: null, work: null, help: false };
  for (let index = 0; index < argumentList.length; index++) {
    const argument = argumentList[index];
    if (SWITCH_OPTIONS.has(argument)) {
      if (argument === '--help') options.help = true;
      else options.skipCook = true;
    } else if (VALUE_OPTIONS.has(argument)) {
      const value = argumentList[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`Option ${argument} needs a folder, for example ${argument} artifacts/readme-previews.`);
      options[argument.slice(2)] = value;
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option ${argument}. Run with --help to see the options.`);
    } else {
      options.names.push(argument);
    }
  }
  const known = PREVIEWS.map(preview => preview.name);
  for (const name of options.names) {
    if (!known.includes(name)) throw new Error(`Unknown preview "${name}". Pass one of: ${known.join(', ')}.`);
  }
  return options;
}

/** The previews to render for parsed options, in table order. */
export function selectPreviews(options) {
  const chosen = options.names.length ? PREVIEWS.filter(preview => options.names.includes(preview.name)) : PREVIEWS;
  return options.skipCook ? chosen.filter(preview => !needsCook(preview)) : chosen;
}

/** The size a preview is rendered at: its published size, or in preview mode a still of PREVIEW_STILL_WIDTH (clips are already small). */
export function renderSize(preview, previewMode) {
  if (!previewMode || preview.kind === 'clip' || preview.width <= PREVIEW_STILL_WIDTH) return { width: preview.width, height: preview.height };
  const width = PREVIEW_STILL_WIDTH;
  return { width, height: 2 * Math.round(preview.height * width / preview.width / 2) };
}

/** The size a picture is drawn at before it is shrunk to its published size: STILL_SUPERSAMPLE times larger for a still that is not path traced and for every clip, in a full-quality run. */
export function drawSize(preview, previewMode) {
  const size = renderSize(preview, previewMode);
  const supersampled = !previewMode && preview.renderer !== 'cook-file';
  return supersampled ? { width: size.width * STILL_SUPERSAMPLE, height: size.height * STILL_SUPERSAMPLE } : size;
}

/** The names of public/previews pictures that README.md shows, in the order they appear. */
export function previewNamesInReadme(readmeText) {
  return [...readmeText.matchAll(/\/previews\/([a-z0-9-]+)\.webp/g)].map(match => match[1]);
}
