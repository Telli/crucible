import { registerShaderFeatureCode } from './shader-registry.js';
import { fullscreenVertex } from './gl-program.js';
import { numberInRange, groupOf, onlyKeys } from './post-fields.js';

// Automatic exposure (#2797), a post step that is off until effects.autoExposure is set. Each frame the renderer meters the
// log-average luminance of the lit frame on a fixed grid, picks the exposure that brings it to `key`, clamps it to
// [minimum, maximum] and moves toward it at `speed`. The adaptation runs on the frame's own time (frame.time), never the
// wall clock, so a render job that steps frames at a fixed interval repeats the same exposures on every run.

export const METERING_MODES = Object.freeze(['average', 'centre-weighted']);
const METER_GRID = 16;
const SAMPLES_PER_CELL_SIDE = 4;
const CENTRE_SPREAD = 0.35;
const MINIMUM_LUMINANCE = 0.0001;
const LUMA_WEIGHTS = '0.2126, 0.7152, 0.0722';
const DEFAULTS = Object.freeze({ metering: 'average', key: 0.18, minimum: 0.25, maximum: 4, speed: 1.5 });

/** The autoExposure settings with defaults filled in; errors name the field and what to pass. */
export function resolveAutoExposure(input) {
  const group = groupOf(input, 'effects.autoExposure');
  onlyKeys(group, Object.keys(DEFAULTS), 'effects.autoExposure');
  const metering = group.metering ?? DEFAULTS.metering;
  if (!METERING_MODES.includes(metering)) {
    throw new TypeError(`effects.autoExposure.metering must be one of ${METERING_MODES.join(', ')}. Pass "average" to weigh the whole frame equally or "centre-weighted" to favour the middle.`);
  }
  const resolved = {
    metering,
    key: numberInRange(group.key, DEFAULTS.key, 0.01, 1, 'effects.autoExposure.key'),
    minimum: numberInRange(group.minimum, DEFAULTS.minimum, 0.01, 16, 'effects.autoExposure.minimum'),
    maximum: numberInRange(group.maximum, DEFAULTS.maximum, 0.01, 16, 'effects.autoExposure.maximum'),
    speed: numberInRange(group.speed, DEFAULTS.speed, 0.01, 100, 'effects.autoExposure.speed'),
  };
  if (resolved.minimum > resolved.maximum) {
    throw new RangeError(`effects.autoExposure.minimum (${resolved.minimum}) must not exceed maximum (${resolved.maximum}). Pass a minimum at or below the maximum, such as { "minimum": 0.25, "maximum": 4 }.`);
  }
  return resolved;
}

function gridWeight(metering, column, row) {
  if (metering === 'average') return 1;
  const offsetX = (column + 0.5) / METER_GRID - 0.5;
  const offsetY = (row + 0.5) / METER_GRID - 0.5;
  return Math.exp(-(offsetX * offsetX + offsetY * offsetY) / (2 * CENTRE_SPREAD * CENTRE_SPREAD));
}

/** The weighted log-average luminance of a METER_GRID x METER_GRID grid of mean log luminances (row major), as a luminance. */
export function meteredLuminance(logLuminances, metering) {
  if (logLuminances.length !== METER_GRID * METER_GRID) {
    throw new RangeError(`The meter grid holds ${METER_GRID * METER_GRID} values, got ${logLuminances.length}.`);
  }
  let weightedSum = 0;
  let totalWeight = 0;
  for (let row = 0; row < METER_GRID; row++) {
    for (let column = 0; column < METER_GRID; column++) {
      const weight = gridWeight(metering, column, row);
      weightedSum += weight * logLuminances[row * METER_GRID + column];
      totalWeight += weight;
    }
  }
  return Math.exp(weightedSum / totalWeight);
}

/** The exposure that brings a frame with this luminance at exposure 1 to the key, within the limits. */
export function targetExposure(luminanceAtUnitExposure, settings) {
  const wanted = settings.key / Math.max(luminanceAtUnitExposure, MINIMUM_LUMINANCE);
  return Math.min(settings.maximum, Math.max(settings.minimum, wanted));
}

/**
 * The exposure of the frame at `time`, adapted from `previous` ({ exposure, time }) toward `target`. The step is exponential in log
 * exposure with the elapsed frame time. A first frame, a repeated time or a seek back snaps to the target, so a still never depends
 * on what was drawn before it.
 */
export function adaptExposure(previous, target, time, speed) {
  const elapsed = previous ? time - previous.time : 0;
  if (!previous || !(elapsed > 0)) return target;
  const remaining = Math.exp(-speed * elapsed);
  return Math.exp(Math.log(target) + (Math.log(previous.exposure) - Math.log(target)) * remaining);
}

const METER_FRAGMENT = `#version 300 es
precision highp float;
in vec2 textureCoordinate;
uniform sampler2D frameTexture;
out vec4 outputColor;
void main() {
  vec2 cell = floor(textureCoordinate * ${METER_GRID}.0) / ${METER_GRID}.0;
  float sum = 0.0;
  for (int row = 0; row < ${SAMPLES_PER_CELL_SIDE}; row++) {
    for (int column = 0; column < ${SAMPLES_PER_CELL_SIDE}; column++) {
      vec2 offset = (vec2(float(column), float(row)) + 0.5) / ${SAMPLES_PER_CELL_SIDE}.0 / ${METER_GRID}.0;
      vec3 color = min(texture(frameTexture, cell + offset).rgb, vec3(65504.0));
      sum += log(max(dot(color, vec3(${LUMA_WEIGHTS})), ${MINIMUM_LUMINANCE}));
    }
  }
  outputColor = vec4(sum / ${SAMPLES_PER_CELL_SIDE * SAMPLES_PER_CELL_SIDE}.0, 0.0, 0.0, 1.0);
}`;

function createMeter(renderer) {
  const { context, backend } = renderer;
  const program = backend.finishProgram(backend.startProgram(fullscreenVertex, METER_FRAGMENT));
  const texture = context.createTexture();
  context.bindTexture(context.TEXTURE_2D, texture);
  context.texImage2D(context.TEXTURE_2D, 0, context.RGBA32F, METER_GRID, METER_GRID, 0, context.RGBA, context.FLOAT, null);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
  const framebuffer = context.createFramebuffer();
  context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
  context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, texture, 0);
  if (context.checkFramebufferStatus(context.FRAMEBUFFER) !== context.FRAMEBUFFER_COMPLETE) {
    throw new Error('The auto exposure meter target could not be allocated. Remove effects.autoExposure or render on a GPU with float render targets.');
  }
  return { program, frameTextureLocation: context.getUniformLocation(program, 'frameTexture'), framebuffer, pixels: new Float32Array(METER_GRID * METER_GRID * 4) };
}

function readMeterGrid(renderer, sourceTexture) {
  const { context } = renderer;
  renderer.autoExposureMeter ??= createMeter(renderer);
  const meter = renderer.autoExposureMeter;
  context.disable(context.DEPTH_TEST);
  context.disable(context.CULL_FACE);
  context.bindVertexArray(null);
  context.bindFramebuffer(context.FRAMEBUFFER, meter.framebuffer);
  context.viewport(0, 0, METER_GRID, METER_GRID);
  context.useProgram(meter.program);
  context.activeTexture(context.TEXTURE0);
  context.bindTexture(context.TEXTURE_2D, sourceTexture);
  context.uniform1i(meter.frameTextureLocation, 0);
  context.drawArrays(context.TRIANGLES, 0, 3);
  context.readPixels(0, 0, METER_GRID, METER_GRID, context.RGBA, context.FLOAT, meter.pixels);
  context.bindFramebuffer(context.FRAMEBUFFER, null);
  return Array.from({ length: METER_GRID * METER_GRID }, (unused, index) => meter.pixels[index * 4]);
}

const TONE_MAP_START = '  if (hdrEnabled > 0.5) {\n    color = clamp((color * (2.51';

registerShaderFeatureCode('autoExposure', {
  /** Splices the exposure scale in before the tone map, so bloom and fog are scaled with the rest of the radiance. */
  post(mainBody) {
    if (!mainBody.includes(TONE_MAP_START) || !mainBody.startsWith('void main() {')) {
      throw new Error('The post shader no longer holds the tone map line that auto exposure is applied before.');
    }
    return `uniform float autoExposureScale;\n${mainBody.replace(TONE_MAP_START, `  color *= autoExposureScale;\n${TONE_MAP_START}`)}`;
  },
  /**
   * Meters the frame, adapts the exposure on frame.time and returns the factor the post pass multiplies the frame by.
   * The chosen exposure and the metered luminance are left on renderer.autoExposure for scene_inspect.
   */
  measure(renderer, frame, sourceTexture) {
    if (!renderer.hdr) {
      throw new Error('effects.autoExposure needs an HDR renderer: create the renderer with hdr: true, or remove effects.autoExposure.');
    }
    const settings = resolveAutoExposure(frame.effects.autoExposure);
    const frameExposure = frame.exposure ?? 1;
    const luminance = meteredLuminance(readMeterGrid(renderer, sourceTexture), settings.metering);
    const target = targetExposure(luminance / frameExposure, settings);
    const time = frame.time ?? 0;
    const exposure = adaptExposure(renderer.autoExposure, target, time, settings.speed);
    renderer.autoExposure = { exposure, target, luminance: luminance / frameExposure, time };
    return exposure / frameExposure;
  },
});
