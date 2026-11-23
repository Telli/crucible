// Draws a scene without and with effects.localToneMapping and writes a still, its recipe JSON, the OKLab L of two points and whole-frame contrast, saturation and clip numbers.
// node bench/post/local-tone-mapping.mjs [--out=<folder>] [--size=WIDTHxHEIGHT] [--scene=lowsun,sunlit] [--cases=off,demo,default] [--label=<text>]
import { constants, setPriority } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const argumentValue = (name, fallback) => process.argv.find(argument => argument.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const outputFolder = resolve(argumentValue('out', 'artifacts/2798'));
const [width, height] = argumentValue('size', '960x540').split('x').map(Number);
const sceneNames = argumentValue('scene', 'lowsun,sunlit').split(',');
const caseNames = argumentValue('cases', 'off,demo,default').split(',');
const label = argumentValue('label', '');
// Points are fractions of the frame from the lower left: sky beside the sun, and shaded grass in the foreground.
const POINTS = { skyNextToSun: JSON.parse(argumentValue('sky', '[0.72,0.5]')), shadedGrass: JSON.parse(argumentValue('grass', '[0.5,0.12]')) };
// demo is the recipe the pull request first showed (full strength, strong compression); default names the group and takes every default.
const CASES = {
  off: {},
  demo: { localToneMapping: { strength: 1, highlightContrast: 0.35, shadowContrast: 0.35, detail: 1, blurRadius: 0.1 } },
  default: { localToneMapping: {} },
};

setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
const server = await createServer({ root: resolve('.'), server: { host: '127.0.0.1', port: 0, fs: { strict: false } }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/bench/post/local-tone-mapping.html`, { timeout: 240000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ready, null, { timeout: 240000 });
  await mkdir(outputFolder, { recursive: true });
  const report = {};
  for (const sceneName of sceneNames) {
    for (const caseName of caseNames) {
      const result = await page.evaluate(([scene, caseEffects, points]) => window.drawCase(scene, caseEffects, points), [sceneName, CASES[caseName], POINTS]);
      if (result.glError !== 0) throw new Error(`${sceneName} ${caseName}: GL error ${result.glError}`);
      const stem = `${sceneName}-${caseName}${label ? `-${label}` : ''}`;
      await writeFile(resolve(outputFolder, `${stem}.png`), Buffer.from(result.image, 'base64'));
      await writeFile(resolve(outputFolder, `${stem}.json`), JSON.stringify({ size: [width, height], backend: 'chrome d3d11 webgl2, hdr, 4x msaa', seed: 'none', points: POINTS, ...result.frame, samples: result.samples, statistics: result.statistics }, null, 1));
      report[stem] = { statistics: result.statistics, samples: result.samples };
    }
  }
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
