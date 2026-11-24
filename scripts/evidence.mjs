// One command for the evidence of a look or feature pull request (#3269): renders a scene recipe at named cameras on the branch and
// optionally on a base checkout, writes stills, a clip, a JSON sidecar per file, labelled side-by-side stills and a side-by-side
// clip under artifacts/<issue>/, measures every frame, and prints a PASS or FAIL checklist (also written to checks.json).
//
//   node scripts/evidence.mjs --issue 3269 --recipe scene.json --cameras cameras.json --subject -1,-1,-0.1,1,1,0.1 \
//        [--clip 0-29] [--clip-camera front] [--fps 30] [--width 480] [--height 270] [--backend gpu|cpu] [--base <worktree|ref>]
//   node scripts/evidence.mjs --issue 3269 --builtin bar            (the small built-in recipe: a turning bar)
//   node scripts/evidence.mjs --issue 3269 --analyze <frames-folder> [--region left,top,right,bottom]   (checks frames already on disk)
//
// Render goes through scripts/render-media.mjs (--scene file --kind stills --frames), so it is the same path as every other render.
// Run it under your GPU queue on a shared machine. Exit code 1 when a branch check FAILS.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { parseFrameRange } from './render-media.mjs';
import { checkClipping, checkContinuity, checkFraming, clipBoxToFrame, DEFAULT_CLIPPING_SHARE, DEFAULT_MINIMUM_MARGIN_PIXELS, frameMetrics, projectBounds } from './evidence-checks.mjs';
import { spinningBarGlb } from '../tests/fixtures/spinning-bar-glb.js';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LABEL_BAND_PIXELS = 28;
const PANEL_GAP_PIXELS = 6;
const OPTIONS_WITH_VALUES = new Set(['issue', 'recipe', 'builtin', 'cameras', 'camera-names', 'subject', 'clip', 'clip-camera', 'still-frame', 'fps', 'width', 'height', 'backend', 'base', 'margin', 'clipping-share', 'out', 'analyze', 'region']);

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/, '');
    if (!argv[index]?.startsWith('--') || !OPTIONS_WITH_VALUES.has(name) || argv[index + 1] === undefined) {
      throw new Error(`Unknown or incomplete option "${argv[index]}". Options: ${[...OPTIONS_WITH_VALUES].map(option => `--${option}`).join(' ')}; each takes a value.`);
    }
    options[name] = argv[index + 1];
  }
  if (!options.issue) throw new Error('Pass --issue <number>: the files go to artifacts/<issue>/.');
  if (!options.analyze && !options.recipe && !options.builtin) throw new Error('Pass --recipe <scene.json> with --cameras <cameras.json>, or --builtin bar, or --analyze <frames-folder>.');
  if (options.builtin && options.builtin !== 'bar') throw new Error(`Unknown built-in recipe "${options.builtin}". The only one is "bar".`);
  return options;
}

function numbers(text, count, name) {
  const values = text.split(',').map(Number);
  if (values.length !== count || values.some(value => !Number.isFinite(value))) throw new Error(`--${name} needs ${count} comma-separated numbers, got "${text}".`);
  return values;
}

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** The built-in recipe: a red bar turning once a second over a floor, one scene file with its GLB and sky next to it. */
function writeBuiltinBar(folder) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'bar.glb'), spinningBarGlb());
  copyFileSync(join(REPOSITORY_ROOT, 'assets/looks/sky-clouds.hdr'), join(folder, 'sky.hdr'));
  const recipe = join(folder, 'scene.json');
  writeJson(recipe, { glb: 'bar.glb', hdri: 'sky.hdr', eye: [0, 0.4, 6], target: [0, 0, 0], seed: 1, renderer: { ground: false, hdr: true, samples: 1, pixelRatio: 1, memoryBudgetMiB: 512 }, frame: { exposure: 1, fov: 45 } });
  return {
    recipe,
    cameras: { front: { eye: [0, 0.4, 6], target: [0, 0, 0] }, wide: { eye: [0, 1.5, 9], target: [0, 0, 0] } },
    subject: { min: [-1.05, -1.05, -0.1], max: [1.05, 1.05, 0.1] },
  };
}

/** A checkout to render a side with: the branch itself, a worktree path, or a ref turned into a temporary worktree sharing node_modules. */
function resolveBase(base) {
  if (existsSync(join(resolve(base), 'scripts/render-media.mjs'))) return { root: resolve(base), cleanup: () => {} };
  const sha = git(REPOSITORY_ROOT, 'rev-parse', '--verify', `${base}^{commit}`);
  if (!sha) throw new Error(`--base "${base}" is neither a checkout containing scripts/render-media.mjs nor a git ref. Pass a worktree path or a ref such as origin/main.`);
  const root = join(REPOSITORY_ROOT, '.claude/worktrees', `evidence-base-${sha.slice(0, 9)}`);
  if (!existsSync(root)) {
    const added = spawnSync('git', ['-C', REPOSITORY_ROOT, 'worktree', 'add', '--detach', root, sha], { encoding: 'utf8' });
    if (added.status !== 0) throw new Error(`Could not check out ${base}: ${added.stderr}`);
  }
  const modules = join(root, 'node_modules');
  if (!existsSync(modules)) symlinkSync(join(REPOSITORY_ROOT, 'node_modules'), modules, 'junction');
  return {
    root,
    cleanup: () => {
      // Unlink the junction first so removing the worktree can never reach the shared node_modules.
      try { unlinkSync(modules); } catch { /* already gone */ }
      spawnSync('git', ['-C', REPOSITORY_ROOT, 'worktree', 'remove', '--force', root], { encoding: 'utf8' });
    },
  };
}

function framePathOf(folder, frame, last) {
  return join(folder, `frame-${String(frame).padStart(Math.max(4, String(last).length), '0')}.png`);
}

/** Renders frames first..last of one camera with render-media from `root` into `folder`; returns the render report. */
function renderFrames({ root, recipe, camera, first, last, plan, folder }) {
  mkdirSync(folder, { recursive: true });
  const pose = [camera.eye, camera.target];
  const cameraFile = join(folder, 'camera.json');
  writeJson(cameraFile, { fps: plan.fps, frames: Array.from({ length: last + 1 }, () => pose) });
  const output = join(folder, 'frame.png');
  const rendered = spawnSync(process.execPath, ['scripts/render-media.mjs', '--scene', 'file', '--kind', 'stills', '--backend', plan.backend, '--width', String(plan.width), '--height', String(plan.height), '--fps', String(plan.fps), '--frames', first === last ? String(first) : `${first}-${last}`, '--config', recipe, '--camera', cameraFile, '--output', output], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (rendered.status !== 0) throw new Error(`scripts/render-media.mjs failed in ${basename(root)} for frames ${first}-${last}:\n${rendered.stdout.slice(-1500)}\n${rendered.stderr.slice(-1500)}`);
  return JSON.parse(readFileSync(`${output}.json`, 'utf8'));
}

async function decode(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function labelSvg(text, width) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL_BAND_PIXELS}"><rect width="100%" height="100%" fill="#1d1d1f"/><text x="10" y="19" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#ffffff">${escaped}</text></svg>`);
}

/** One image with the panels left to right, each under a label band. */
async function sideBySide(panels) {
  const first = await sharp(panels[0].file).metadata();
  const width = panels.length * first.width + (panels.length - 1) * PANEL_GAP_PIXELS;
  const composites = [];
  for (const [index, panel] of panels.entries()) {
    const left = index * (first.width + PANEL_GAP_PIXELS);
    composites.push({ input: labelSvg(panel.label, first.width), left, top: 0 });
    composites.push({ input: panel.file, left, top: LABEL_BAND_PIXELS });
  }
  return sharp({ create: { width, height: first.height + LABEL_BAND_PIXELS, channels: 3, background: '#000000' } }).composite(composites).png();
}

function encodeClip(framesFolder, first, last, fps, output) {
  const digits = Math.max(4, String(last).length);
  const encoded = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-start_number', String(first), '-i', join(framesFolder, `frame-%0${digits}d.png`), '-frames:v', String(last - first + 1), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', output], { encoding: 'utf8' });
  if (encoded.status !== 0) throw new Error(`ffmpeg could not encode ${basename(output)}: ${encoded.stderr}. Install ffmpeg and put it on PATH.`);
}

function item(name, scope, result) {
  return { name, scope, status: result.status ?? (result.pass ? 'PASS' : 'FAIL'), detail: result.detail };
}

/** Measures every frame of one camera on one side and returns its checklist items and the per-frame numbers. */
async function measureCamera({ frames, first, subject, camera, width, height, margin, clippingShare, scope }) {
  const box = subject ? projectBounds(subject, camera, width, height) : null;
  const region = box && !box.behindCamera ? clipBoxToFrame(box, width, height) : null;
  const metrics = [];
  for (const file of frames) metrics.push(frameMetrics(await decode(file), region));
  const items = [];
  if (box) items.push(item('subject in frame', scope, checkFraming(box, width, height, { minimumMargin: margin })));
  else items.push(item('subject in frame', scope, { status: 'SKIP', detail: 'no --subject bounds given, so the frame is not checked' }));
  const clipping = checkClipping(metrics, { maximumShare: clippingShare, firstFrame: first });
  items.push(item('no blown highlights', scope, clipping.highlights));
  items.push(item('no crushed shadows', scope, clipping.shadows));
  if (frames.length > 1) items.push(item(`every frame steady (${frames.length} frames)`, scope, checkContinuity(metrics, { firstFrame: first })));
  return { items, metrics, box, region };
}

function printChecklist(items, gatedScopePrefix) {
  for (const entry of items) {
    const gated = entry.scope.startsWith(gatedScopePrefix);
    console.log(`${entry.status.padEnd(4)}  ${entry.scope}: ${entry.name} - ${entry.detail}${gated ? '' : ' (reference, not gated)'}`);
  }
}

async function analyzeFolder(options) {
  const folder = resolve(options.analyze);
  const files = readdirSync(folder).filter(name => /\.png$/i.test(name)).sort().map(name => join(folder, name));
  if (files.length < 2) throw new Error(`--analyze needs a folder with at least 2 PNG frames, found ${files.length} in ${folder}.`);
  const size = await sharp(files[0]).metadata();
  const region = options.region ? (([left, top, right, bottom]) => ({ left, top, right, bottom }))(numbers(options.region, 4, 'region')) : null;
  const metrics = [];
  for (const file of files) metrics.push(frameMetrics(await decode(file), region ? clipBoxToFrame(region, size.width, size.height) : null));
  const items = [
    item('no blown highlights', 'frames', checkClipping(metrics, { maximumShare: Number(options['clipping-share'] ?? DEFAULT_CLIPPING_SHARE) }).highlights),
    item('no crushed shadows', 'frames', checkClipping(metrics, { maximumShare: Number(options['clipping-share'] ?? DEFAULT_CLIPPING_SHARE) }).shadows),
    item(`every frame steady (${files.length} frames)`, 'frames', checkContinuity(metrics)),
  ];
  printChecklist(items, 'frames');
  return items.some(entry => entry.status === 'FAIL') ? 1 : 0;
}

export async function main(argv) {
  const options = parseArguments(argv);
  if (options.analyze) return analyzeFolder(options);
  const outRoot = resolve(options.out ?? join('artifacts', options.issue));
  mkdirSync(outRoot, { recursive: true });
  const builtin = options.builtin ? writeBuiltinBar(join(outRoot, 'recipe')) : null;
  const recipe = resolve(builtin?.recipe ?? options.recipe);
  const description = JSON.parse(readFileSync(recipe, 'utf8'));
  const cameras = builtin?.cameras ?? JSON.parse(readFileSync(resolve(options.cameras ?? ''), 'utf8'));
  const cameraNames = options['camera-names'] ? options['camera-names'].split(',') : Object.keys(cameras);
  for (const name of cameraNames) {
    if (!cameras[name]?.eye || !cameras[name]?.target) throw new Error(`Camera "${name}" needs eye and target, each [x, y, z]. Cameras in the file: ${Object.keys(cameras).join(', ')}.`);
  }
  const subjectNumbers = options.subject ? numbers(options.subject, 6, 'subject') : null;
  const subject = builtin?.subject ?? (subjectNumbers ? { min: subjectNumbers.slice(0, 3), max: subjectNumbers.slice(3) } : null);
  const plan = { fps: Number(options.fps ?? 30), width: Number(options.width ?? 480), height: Number(options.height ?? 270), backend: options.backend ?? 'gpu' };
  const margin = Number(options.margin ?? DEFAULT_MINIMUM_MARGIN_PIXELS);
  const clippingShare = Number(options['clipping-share'] ?? DEFAULT_CLIPPING_SHARE);
  const clip = options.clip ?? (builtin ? '0-29' : null);
  const clipRange = clip ? parseFrameRange(clip) : null;
  const clipCamera = options['clip-camera'] ?? cameraNames[0];
  const stillFrame = Number(options['still-frame'] ?? 0);
  const fov = description.frame?.fov ?? 45;

  const branchName = git(REPOSITORY_ROOT, 'rev-parse', '--abbrev-ref', 'HEAD');
  const sides = [{ name: 'branch', label: `branch ${branchName === 'HEAD' ? '' : `${branchName} `}${git(REPOSITORY_ROOT, 'rev-parse', '--short', 'HEAD')}`.replace('  ', ' '), root: REPOSITORY_ROOT, cleanup: () => {} }];
  if (options.base) {
    const base = resolveBase(options.base);
    sides.unshift({ name: 'base', label: `base ${options.base.includes('/') && !existsSync(options.base) ? options.base : git(base.root, 'rev-parse', '--short', 'HEAD')}`, ...base });
  }
  const checklist = [];
  const perCamera = {};
  try {
    for (const side of sides) {
      for (const name of cameraNames) {
        const camera = { ...cameras[name], fov };
        const folder = join(outRoot, side.name, name);
        const wantsClip = clipRange && name === clipCamera;
        const first = wantsClip ? Math.min(clipRange.first, stillFrame) : stillFrame;
        const last = wantsClip ? Math.max(clipRange.last, stillFrame) : stillFrame;
        const report = renderFrames({ root: side.root, recipe, camera, first, last, plan, folder });
        const still = join(outRoot, side.name, `${name}.png`);
        copyFileSync(framePathOf(folder, stillFrame, last), still);
        const sidecar = file => ({
          file: basename(file), side: side.name, label: side.label, camera: { name, eye: camera.eye, target: camera.target, fov }, size: { width: plan.width, height: plan.height }, fps: plan.fps,
          backend: plan.backend, gpu: report.graphics?.gpu ?? null, seed: description.seed ?? null, recipe: { file: basename(recipe), sha256: sha256Of(recipe) },
          lights: { environment: description.renderer?.environment ?? null, lights: description.lights ?? null },
        });
        writeJson(`${still}.json`, { ...sidecar(still), kind: 'still', frame: stillFrame });
        const clipFrames = wantsClip ? Array.from({ length: clipRange.count }, (_, index) => framePathOf(folder, clipRange.first + index, last)) : null;
        if (wantsClip) {
          const video = join(outRoot, side.name, `${name}.mp4`);
          encodeClip(folder, clipRange.first, clipRange.last, plan.fps, video);
          writeJson(`${video}.json`, { ...sidecar(video), kind: 'clip', frames: { first: clipRange.first, last: clipRange.last } });
        }
        const scope = `${side.name} ${name}`;
        const measured = await measureCamera({ frames: clipFrames ?? [still], first: wantsClip ? clipRange.first : stillFrame, subject, camera, width: plan.width, height: plan.height, margin, clippingShare, scope });
        checklist.push(...measured.items);
        perCamera[scope] = { box: measured.box, region: measured.region, metrics: measured.metrics };
        if (wantsClip) perCamera[scope].clipFrames = clipFrames.map(file => relative(outRoot, file));
      }
    }
    if (sides.length > 1) {
      const compare = join(outRoot, 'compare');
      mkdirSync(compare, { recursive: true });
      for (const name of cameraNames) {
        const panels = sides.map(side => ({ file: join(outRoot, side.name, `${name}.png`), label: `${side.label} - ${name}` }));
        const file = join(compare, `${name}.png`);
        await (await sideBySide(panels)).toFile(file);
        writeJson(`${file}.json`, { file: basename(file), kind: 'side-by-side still', camera: name, panels: sides.map(side => side.label), sides: sides.map(side => `${side.name}/${name}.png.json`) });
      }
      if (clipRange) await composeClip({ outRoot, sides, name: clipCamera, clipRange, plan });
    }
  } finally {
    for (const side of sides) side.cleanup();
  }
  writeJson(join(outRoot, 'checks.json'), { issue: options.issue, margin, clippingShare, checklist, cameras: perCamera });
  console.log(`Evidence for #${options.issue} in ${relative(process.cwd(), outRoot) || '.'} (${cameraNames.length} cameras${clipRange ? `, clip frames ${clip}` : ''}, ${sides.map(side => side.name).join(' + ')}).`);
  printChecklist(checklist, 'branch');
  const failed = checklist.filter(entry => entry.status === 'FAIL' && entry.scope.startsWith('branch'));
  console.log(failed.length ? `RESULT: FAIL (${failed.length} branch check${failed.length === 1 ? '' : 's'}). Fix them or say in the PR why each is accepted.` : 'RESULT: PASS');
  return failed.length ? 1 : 0;
}

/** The side-by-side clip: each frame of the clip camera composed with labels, then encoded. */
async function composeClip({ outRoot, sides, name, clipRange, plan }) {
  const composed = join(outRoot, 'compare', `${name}-frames`);
  mkdirSync(composed, { recursive: true });
  for (let frame = clipRange.first; frame <= clipRange.last; frame += 1) {
    const panels = sides.map(side => ({ file: framePathOf(join(outRoot, side.name, name), frame, clipRange.last), label: `${side.label} - ${name} - frame ${frame}` }));
    await (await sideBySide(panels)).toFile(framePathOf(composed, frame, clipRange.last));
  }
  const video = join(outRoot, 'compare', `${name}.mp4`);
  const sizeOfPanels = await sharp(framePathOf(composed, clipRange.first, clipRange.last)).metadata();
  encodeClip(composed, clipRange.first, clipRange.last, plan.fps, video);
  writeJson(`${video}.json`, { file: basename(video), kind: 'side-by-side clip', camera: name, frames: { first: clipRange.first, last: clipRange.last }, fps: plan.fps, size: { width: sizeOfPanels.width, height: sizeOfPanels.height }, panels: sides.map(side => side.label) });
  rmSync(composed, { recursive: true, force: true });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
