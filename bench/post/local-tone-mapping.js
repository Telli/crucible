// Runs in the page: a low sun in front of the camera over grass, drawn without and with effects.localToneMapping (#2798).
import { CrucibleRenderer } from '/src/renderer.js';
import { box } from '/src/geometry.js';
import { installCameraEffects } from '/src/camera-effects.js';
import { installPostSteps } from '/src/post-steps.js';

function placed(center, size) {
  return new Float32Array([size[0], 0, 0, 0, 0, size[1], 0, 0, 0, 0, size[2], 0, center[0], center[1], center[2], 1]);
}

const grass = { color: [0.12, 0.3, 0.07], metallic: 0, roughness: 0.9 };
const trunk = { color: [0.25, 0.17, 0.1], metallic: 0, roughness: 0.9 };
const parts = [{ geometry: box(), matrix: placed([0, -0.05, -10], [40, 0.1, 40]), material: grass }];
for (let index = 0; index < 7; index++) {
  parts.push({ geometry: box(), matrix: placed([-6 + index * 2, 1.2, -6 - (index % 3) * 3], [0.35, 2.4, 0.35]), material: trunk });
}

// The sun sits just above the horizon straight ahead; the ground it grazes is lit only a little.
const environment = { keyIntensity: 1, fillIntensity: 0.1, ambientIntensity: 0.15, lightDirection: [0.25, 0.09, -1], skyTop: [0.2, 0.38, 0.52], skyBottom: [2.6, 1.8, 1.0], daylight: 1 };
const camera = { eye: [0, 1.7, 4], target: [0, 2.6, -10], fov: 55 };
const SAMPLE_SIZE = 8;

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

// OKLab lightness of a display colour (0 to 1 per channel), after Bjorn Ottosson's matrices.
function oklabLightness(red, green, blue) {
  const [r, g, b] = [red, green, blue].map(srgbToLinear);
  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const medium = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short;
}

// Mean OKLab L of a patch at a point of the frame (0 to 1 from the lower left) and the share of its channels at 255.
function patch(context, x, y) {
  const pixels = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE * 4);
  context.readPixels(Math.round(x * context.drawingBufferWidth) - SAMPLE_SIZE / 2, Math.round(y * context.drawingBufferHeight) - SAMPLE_SIZE / 2, SAMPLE_SIZE, SAMPLE_SIZE, context.RGBA, context.UNSIGNED_BYTE, pixels);
  let lightness = 0;
  let clipped = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    lightness += oklabLightness(pixels[index] / 255, pixels[index + 1] / 255, pixels[index + 2] / 255) / (SAMPLE_SIZE * SAMPLE_SIZE);
    if (pixels[index] === 255 || pixels[index + 1] === 255 || pixels[index + 2] === 255) clipped += 1;
  }
  return { oklabL: Number(lightness.toFixed(4)), clippedShare: Number((clipped / (SAMPLE_SIZE * SAMPLE_SIZE)).toFixed(3)) };
}

window.drawCase = function drawCase(effects, points) {
  const canvas = document.querySelector('canvas');
  const renderer = installPostSteps(installCameraEffects(new CrucibleRenderer(canvas, parts, { ground: false, hdr: true, depth: true, samples: 4, pixelRatio: 1, memoryBudgetMiB: 1024, environment })));
  renderer.resize();
  const frame = { ...camera, environment, time: 0, exposure: 1, effects: { ambientOcclusion: 0, ...effects } };
  for (let index = 0; index < 3; index++) renderer.render(frame);
  const glError = renderer.context.getError();
  const samples = Object.fromEntries(Object.entries(points).map(([name, [x, y]]) => [name, patch(renderer.context, x, y)]));
  const image = canvas.toDataURL('image/png').split(',')[1];
  renderer.dispose();
  return { glError, image, samples, frame: { ...camera, environment, effects, exposure: 1 } };
};
window.ready = true;
