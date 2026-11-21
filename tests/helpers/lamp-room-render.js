// Runs in Node and in the page of withWebGpuPage: a closed room lit by one point light inside a glowing bulb box (#2353), traced
// with the bulb and without it, so a test and an evidence script compare how much light the bulb lets out. The camera looks at
// a wall, so the bulb itself is out of frame and only the room's light shows. `moduleBase` is where src/ is reached from.
export async function renderLampRoom({ width, height, samples, backend = 'cpu', kernel = 'megakernel', moduleBase = '../..', cameraTarget = [0, 1, -3] }) {
  const { box } = await import(`${moduleBase}/src/geometry.js`);
  const { renderPathTracedImage } = await import(`${moduleBase}/src/path-tracer.js`);
  const wall = { color: [0.8, 0.8, 0.8], roughness: 1 };
  const placed = (name, translation, scale, material) => ({
    name,
    geometry: box(0, 1),
    matrix: new Float32Array([scale[0], 0, 0, 0, 0, scale[1], 0, 0, 0, 0, scale[2], 0, ...translation, 1]),
    material,
  });
  const room = [
    placed('floor', [0, -0.1, 0], [6, 0.2, 6], wall),
    placed('ceiling', [0, 3.1, 0], [6, 0.2, 6], wall),
    placed('back', [0, 1.5, -3.1], [6.4, 3.2, 0.2], wall),
    placed('left', [-3.1, 1.5, 0], [0.2, 3.2, 6], wall),
    placed('right', [3.1, 1.5, 0], [0.2, 3.2, 6], wall),
    placed('front', [0, 1.5, 3.1], [6.4, 3.2, 0.2], wall),
  ];
  const lampPosition = [0, 2.5, 0];
  const bulb = placed('bulb', lampPosition, [0.4, 0.4, 0.4], { color: [1, 0.8, 0.5], emission: 3 });
  const environment = { keyIntensity: 0, fillIntensity: 0, pointLights: [{ position: lampPosition, color: [1, 0.85, 0.65], intensity: 18, radius: 0.1, range: 9 }] };
  const camera = { eye: [0, 1.2, 2.8], target: cameraTarget, fov: 60 };
  const options = { width, height, samples, bounces: 2, seed: 7, backend, kernel, denoiser: 'none', threads: 1 };
  const result = {};
  for (const [name, parts] of [['withBulb', [...room, bulb]], ['withoutBulb', room]]) {
    const image = await renderPathTracedImage({ parts, environment, camera }, options);
    let total = 0;
    for (let index = 0; index < image.linear.length; index++) total += image.linear[index];
    result[name] = { meanLinear: total / image.linear.length, rgba: Array.from(image.rgba), ignored: image.report?.ignored ?? [] };
  }
  return result;
}
