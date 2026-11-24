// Meshes a small voxel landscape and writes portrait stills of it:
//   node scripts/capture-voxel-terrain.mjs <folder>
// wide.png and slope.png show the whole landscape from two sides in a steep, map-like view (the landscape is 80 x 128 cells, longer than wide, so it can fill a tall frame) that fills at least half of
// the frame height, with at least 50 px of margin on every side. shore.png is a close-up of the lake edge. All are
// 1080x1920. The margins and the height share are measured on the pixels (against a render of the same view without the
// landscape) and printed per still.
//   The stills use edges: 'closed' (side walls and a base, like a diorama); EDGES=open cuts the landscape at the grid
//   bounds; SMOOTHING=<0 to 4> changes the blur.
import { mkdir, writeFile } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createVoxelTerrain } from '../src/voxel-terrain.js';
import { fitSteepView } from './voxel-camera.mjs';
import { DIRT, makeLandscape } from './voxel-landscape.mjs';

setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
const folder = process.argv[2];
if (!folder) throw new Error('Give the output folder.');
const WIDTH = 1080;
const HEIGHT = 1920;
const MARGIN = 50;
const MINIMUM_HEIGHT_SHARE = 0.55;
const GRID = [80, 40, 128];
const PALETTE = ['grass', 'rock', 'sand', 'water', 'dirt'];
const CENTRE = [40, 10, 64];
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
  const edges = process.env.EDGES ?? 'closed';
  const { occupancy, materials } = makeLandscape(GRID, { deepMaterial: DIRT });
  const { parts } = createVoxelTerrain({ grid: GRID, cellSize: 1, palette: PALETTE, occupancy, materials, smoothing, edges });
  const fitOptions = { minimumHeightShare: MINIMUM_HEIGHT_SHARE };
  const views = {
    wide: fitSteepView(parts, 20, CENTRE, WIDTH, HEIGHT, MARGIN, fitOptions).view,
    slope: fitSteepView(parts, -25, CENTRE, WIDTH, HEIGHT, MARGIN, fitOptions).view,
    shore: { eye: [118, 62, 196], target: [38, 4, 94] },
  };
  const results = await page.evaluate(async ({ smoothing, edges, views, grid, palette, deepMaterial }) => {
    await import('/src/world-material-shader.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { createVoxelTerrain } = await import('/src/voxel-terrain.js');
    const { makeLandscape } = await import('/scripts/voxel-landscape.mjs');
    const { occupancy, materials } = makeLandscape(grid, { deepMaterial });
    const terrain = createVoxelTerrain({ grid, cellSize: 1, palette, occupancy, materials, smoothing, edges });
    const canvas = document.querySelector('canvas');
    const environment = { lightDirection: [-4, 5, 3], daylight: 1, fogDensity: 0.0004 };
    const readPixels = () => {
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d');
      context.drawImage(canvas, 0, 0);
      return context.getImageData(0, 0, copy.width, copy.height).data;
    };
    const pictures = {};
    const withLandscape = {};
    const renderer = new CrucibleRenderer(canvas, terrain.parts, { hdr: true, depth: true, world: true, ground: false, pixelRatio: 1, samples: 4 });
    for (const [name, view] of Object.entries(views)) {
      renderer.render({ ...view, time: 1, environment });
      pictures[name] = canvas.toDataURL('image/png');
      withLandscape[name] = readPixels();
    }
    renderer.dispose();
    // The same views without the landscape: any pixel that differs belongs to it.
    const empty = new CrucibleRenderer(canvas, [], { hdr: true, depth: true, world: true, ground: false, pixelRatio: 1, samples: 4 });
    const boxes = {};
    for (const [name, view] of Object.entries(views)) {
      empty.render({ ...view, time: 1, environment });
      const background = readPixels();
      const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (let pixel = 0; pixel < background.length / 4; pixel++) {
        const offset = pixel * 4;
        const difference = Math.abs(withLandscape[name][offset] - background[offset]) + Math.abs(withLandscape[name][offset + 1] - background[offset + 1]) + Math.abs(withLandscape[name][offset + 2] - background[offset + 2]);
        if (difference <= 24) continue;
        const x = pixel % canvas.width;
        const y = Math.floor(pixel / canvas.width);
        box.left = Math.min(box.left, x);
        box.right = Math.max(box.right, x);
        box.top = Math.min(box.top, y);
        box.bottom = Math.max(box.bottom, y);
      }
      boxes[name] = box;
    }
    empty.dispose();
    return { pictures, boxes };
  }, { smoothing, edges, views, grid: GRID, palette: PALETTE, deepMaterial: DIRT });
  await mkdir(folder, { recursive: true });
  for (const [name, image] of Object.entries(results.pictures)) await writeFile(`${folder}/${name}.png`, Buffer.from(image.split(',')[1], 'base64'));
  for (const [name, box] of Object.entries(results.boxes)) {
    const share = (box.bottom - box.top + 1) / HEIGHT;
    console.log(`${name} (pixels): left ${box.left}, right ${WIDTH - 1 - box.right}, top ${box.top}, bottom ${HEIGHT - 1 - box.bottom}, height share ${(share * 100).toFixed(1)}%`);
  }
  console.log('written', Object.keys(results.pictures).join(', '));
} finally {
  await browser.close();
  await server.close();
}
