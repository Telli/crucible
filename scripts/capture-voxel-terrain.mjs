// Meshes a small voxel landscape and writes portrait stills of it:
//   node scripts/capture-voxel-terrain.mjs <folder>
// wide.png shows the whole landscape, slope.png the foot of the rocky hill where rock, grass and sand blend, shore.png the lake edge. Both are 1080x1920.
import { mkdir, writeFile } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { chromium } from 'playwright';
import { createServer } from 'vite';

setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
const folder = process.argv[2];
if (!folder) throw new Error('Give the output folder.');
const WIDTH = 1080;
const HEIGHT = 1920;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-audio-output'],
});
try {
  const serverUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.route('**/voxel.html', route => route.fulfill({ contentType: 'text/html', body: `<canvas width="${WIDTH}" height="${HEIGHT}" style="width:${WIDTH}px;height:${HEIGHT}px;display:block"></canvas>` }));
  await page.goto(`${serverUrl}/voxel.html`);
  const smoothing = Number(process.env.SMOOTHING ?? 1);
  const results = await page.evaluate(async (smoothing) => {
    await import('/src/world-material-shader.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { createVoxelTerrain } = await import('/src/voxel-terrain.js');
    const { makeLandscape } = await import('/scripts/voxel-landscape.mjs');
    const grid = [96, 40, 96];
    const { occupancy, materials } = makeLandscape(grid);
    const terrain = createVoxelTerrain({ grid, cellSize: 1, occupancy, materials, smoothing });
    const canvas = document.querySelector('canvas');
    const environment = { lightDirection: [-4, 5, 3], daylight: 1, fogDensity: 0.0012 };
    const views = {
      wide: { eye: [165, 105, 180], target: [48, 8, 50] },
      slope: { eye: [104, 40, 92], target: [64, 14, 44] },
      shore: { eye: [74, 30, 66], target: [40, 11, 64] },
    };
    const pictures = {};
    const renderer = new CrucibleRenderer(canvas, terrain.parts, { hdr: true, depth: true, world: true, ground: false, pixelRatio: 1, samples: 4 });
    for (const [name, view] of Object.entries(views)) {
      renderer.render({ ...view, time: 1, environment });
      pictures[name] = canvas.toDataURL('image/png');
    }
    renderer.dispose();
    return pictures;
  }, smoothing);
  await mkdir(folder, { recursive: true });
  for (const [name, image] of Object.entries(results)) await writeFile(`${folder}/${name}.png`, Buffer.from(image.split(',')[1], 'base64'));
  console.log('written', Object.keys(results).join(', '));
} finally {
  await browser.close();
  await server.close();
}
