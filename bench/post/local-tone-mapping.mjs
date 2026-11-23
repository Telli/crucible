// Draws a toward-the-low-sun frame without and with effects.localToneMapping and writes a still, its recipe JSON and the OKLab L of the sky and the grass.
// node bench/post/local-tone-mapping.mjs [--out=<folder>] [--size=WIDTHxHEIGHT]
import { constants, setPriority } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const argumentValue = (name, fallback) => process.argv.find(argument => argument.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const outputFolder = resolve(argumentValue('out', 'artifacts/2798'));
const [width, height] = argumentValue('size', '960x540').split('x').map(Number);
// Points are fractions of the frame from the lower left: sky beside the sun, and shaded grass in the foreground.
const POINTS = { skyNextToSun: JSON.parse(argumentValue('sky', '[0.72,0.5]')), shadedGrass: JSON.parse(argumentValue('grass', '[0.5,0.12]')) };
const CASES = {
  without: {},
  with: { localToneMapping: { strength: 1, highlightContrast: 0.35, shadowContrast: 0.35, detail: 1, blurRadius: 0.1 } },
};

setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
const server = await createServer({ root: resolve('.'), server: { host: '127.0.0.1', port: 0, fs: { strict: false } }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/bench/post/local-tone-mapping.html`, { timeout: 60000 });
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
  await mkdir(outputFolder, { recursive: true });
  const report = {};
  for (const [name, effects] of Object.entries(CASES)) {
    const result = await page.evaluate(([caseEffects, points]) => window.drawCase(caseEffects, points), [effects, POINTS]);
    if (result.glError !== 0) throw new Error(`${name}: GL error ${result.glError}`);
    await writeFile(resolve(outputFolder, `local-tone-mapping-${name}.png`), Buffer.from(result.image, 'base64'));
    await writeFile(resolve(outputFolder, `local-tone-mapping-${name}.json`), JSON.stringify({ size: [width, height], backend: 'chrome d3d11 webgl2, hdr, 4x msaa', seed: 'none', points: POINTS, ...result.frame, samples: result.samples }, null, 1));
    report[name] = result.samples;
  }
  console.log(JSON.stringify(report, null, 1));
} finally {
  await browser.close();
  await server.close();
}
