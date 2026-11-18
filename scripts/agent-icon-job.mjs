// The `icons` render job: draws each item as a transparent square icon (at one or more angles), frames its silhouette, and writes one
// PNG per frame, an optional breakdown strip per item, an atlas of all the frames and icons.json. The browser side is passed in as
// `openItem`, so the loop runs without a page.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ICON_ARTIFACTS, alphaBounds, breakdownArtifactName, cameraForFraming, iconArtifactName, iconFrames, iconManifest, isFramed, layoutAtlas, refineFraming, relativeScale, sphereFraming, BREAKDOWN_STEPS } from '../src/icon-sheet.js';
import { blankImage, copyIntoAtlas, decodePng, encodePng } from './agent-icon-png.mjs';

/** Draws and measures at most this many times per frame: the sphere guess, then up to three refinements. */
const MAXIMUM_DRAWS = 4;
const PNG_MIME = 'image/png';

function describeFrame(settings, frame) {
  const { source } = settings.items[frame.itemIndex];
  return settings.angles > 1 ? `items[${frame.itemIndex}] (${source}) at ${frame.view.azimuth} degrees` : `items[${frame.itemIndex}] (${source})`;
}

function drewNothingError(settings, frame) {
  return new Error(`${describeFrame(settings, frame)} drew no pixels. Check that the GLB has visible, opaque geometry in front of the camera.`);
}

function tooSmallForSharedScaleError(settings, frame, sizeRatio) {
  if (settings.scale === 'relative') {
    return new Error(`${describeFrame(settings, frame)} is too small for scale "relative": the largest item of the set is about ${Math.round(sizeRatio)} times its size, so it draws under one pixel. Use scale "fit", or give the set consistent units.`);
  }
  return new Error(`${describeFrame(settings, frame)} is too small next to the largest view of its item: that view is about ${Math.round(sizeRatio)} times its size, so it draws under one pixel. Use fewer angles, or a viewpoint that shows the item more evenly.`);
}

function notFramedError(settings, frame, box) {
  return new Error(`${describeFrame(settings, frame)} could not be framed in ${MAXIMUM_DRAWS} draws: its silhouette spans ${box.left},${box.top} to ${box.right},${box.bottom} of ${settings.size} px. Try a smaller padding or another view.`);
}

/**
 * Draws one frame until its silhouette is centred and inside the icon: a first guess from the bounding sphere, then each measured
 * box moves the camera. With `fixedScale` the view height stays, so a set (or the views of one item) keeps one scale.
 */
async function frameItem({ item, frame, settings, startFraming, fixedScale, signal }) {
  const { size, padding } = settings;
  let framing = startFraming;
  for (let draw = 1; draw <= MAXIMUM_DRAWS; draw++) {
    signal.throwIfAborted();
    const image = decodePng(await item.draw(cameraForFraming(framing, frame.view)));
    if (image.width !== size || image.height !== size) throw new Error(`${describeFrame(settings, frame)} was drawn at ${image.width}x${image.height}, not ${size}x${size}. The render budget may have reduced the frame; raise --memory.`);
    const box = alphaBounds(image.data, size, size);
    if (!box) throw fixedScale === undefined ? drewNothingError(settings, frame) : tooSmallForSharedScaleError(settings, frame, fixedScale / startFraming.fittedScale);
    if (isFramed(box, { size, padding, fit: fixedScale === undefined })) return { framing, image, box };
    if (draw === MAXIMUM_DRAWS) throw notFramedError(settings, frame, box);
    framing = refineFraming(framing, box, { size, view: frame.view, padding, fixedScale });
  }
  throw notFramedError(settings, frame, { left: 0, top: 0, right: 0, bottom: 0 });
}

function entryOf({ framing, box }) {
  return { bounds: { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top }, viewHeight: Number(framing.orthoScale.toPrecision(7)) };
}

/** The strip of one item: shaded, outline, hatching, final side by side, each drawn from the camera the final icon used. */
async function drawBreakdownStrip({ item, framed, settings }) {
  const { size } = settings;
  const strip = blankImage(size * BREAKDOWN_STEPS.length, size);
  const camera = cameraForFraming(framed.framing, framed.view);
  for (const [position, step] of BREAKDOWN_STEPS.entries()) {
    const panel = step === 'final' ? framed.image : decodePng(await item.drawStep(camera, step));
    copyIntoAtlas(strip, panel, position * size, 0);
  }
  return strip;
}

/**
 * Runs the job. `openItem(item, index, frame)` resolves to `{ bounds, draw(camera), drawStep(camera, step), close() }`: the item's
 * world bounds, a function that draws it with a camera and returns a transparent PNG of the icon size, one that draws a step of the
 * sketch (outline, hatching or shaded) the same way, and a release. Returns the runner result the job store reads.
 */
export async function renderIconJob({ settings, directory, signal, progress, openItem }) {
  const frames = iconFrames(settings);
  const layout = layoutAtlas(frames.length, settings.size, settings.angles > 1 ? settings.angles : undefined);
  const atlas = blankImage(layout.width, layout.height);
  const artifacts = [];
  const strips = [];
  const entries = [];
  const fitted = [];

  async function withItem(frame, work) {
    const item = await openItem(settings.items[frame.itemIndex], frame.itemIndex, frame);
    try { return await work(item); }
    finally { await item.close(); }
  }

  async function writeArtifact(filename, bytes, mimeType = PNG_MIME) {
    await writeFile(join(directory, `${filename}.partial`), bytes, { flag: 'wx' });
    artifacts.push({ temporary: `${filename}.partial`, filename, mimeType });
  }

  async function keep(frameIndex, framed) {
    copyIntoAtlas(atlas, framed.image, layout.rectangles[frameIndex].x, layout.rectangles[frameIndex].y);
    await writeArtifact(iconArtifactName(frameIndex), encodePng(framed.image));
    entries[frameIndex] = entryOf(framed);
  }

  /** Frames one frame and, when it is the one a strip hangs on, draws the strip while its scene is still open. */
  async function drawFinal(frameIndex, startFor, fixedScale) {
    const frame = frames[frameIndex];
    return withItem(frame, async item => {
      const startFraming = startFor(item);
      const framed = { ...(await frameItem({ item, frame, settings, startFraming, fixedScale, signal })), view: frame.view };
      if (settings.breakdown && frame.angleIndex === 0) strips[frame.itemIndex] = await drawBreakdownStrip({ item, framed, settings });
      return framed;
    });
  }

  // One shared scale needs every frame measured first: the set's largest for relative, the item's largest view for a turnaround.
  const sharesScale = settings.scale === 'relative' || settings.angles > 1;
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    signal.throwIfAborted();
    const frame = frames[frameIndex];
    if (sharesScale) {
      const measured = await withItem(frame, item => frameItem({ item, frame, settings, startFraming: sphereFraming(item.bounds), signal }));
      fitted[frameIndex] = measured.framing;
    } else {
      await keep(frameIndex, await drawFinal(frameIndex, item => sphereFraming(item.bounds)));
    }
    await progress({ frames: frameIndex + 1, maximumPendingFrames: 0 });
  }

  if (sharesScale) {
    const setScale = relativeScale(fitted.map(framing => framing.orthoScale));
    const itemScales = new Map();
    for (const [frameIndex, frame] of frames.entries()) {
      itemScales.set(frame.itemIndex, Math.max(itemScales.get(frame.itemIndex) ?? 0, fitted[frameIndex].orthoScale));
    }
    for (const [frameIndex, frame] of frames.entries()) {
      signal.throwIfAborted();
      const fixedScale = settings.scale === 'relative' ? setScale : itemScales.get(frame.itemIndex);
      const startFraming = { ...fitted[frameIndex], fittedScale: fitted[frameIndex].orthoScale, orthoScale: fixedScale };
      await keep(frameIndex, await drawFinal(frameIndex, () => startFraming, fixedScale));
    }
  }

  for (const [itemIndex, strip] of strips.entries()) {
    if (strip) await writeArtifact(breakdownArtifactName(itemIndex), encodePng(strip));
  }
  await writeArtifact(ICON_ARTIFACTS.atlas, encodePng(atlas));
  await writeArtifact(ICON_ARTIFACTS.manifest, `${JSON.stringify(iconManifest({ settings, layout, entries }), null, 2)}\n`, 'application/json');
  return { artifacts, metrics: { icons: frames.length, items: settings.items.length, atlasWidth: layout.width, atlasHeight: layout.height } };
}
