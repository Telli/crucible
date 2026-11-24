// Runs the transparent order benchmark in Chrome: node bench/transparent-order/run.mjs [still|cost] [outputPrefix] [rootFolder]
// `rootFolder` is the checkout whose src/ is drawn (default: the current folder), so the same page measures before and after.
import { mkdir, writeFile } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [mode = 'cost', outputPrefix = 'artifacts/transparent-order/run', rootFolder = '.'] = process.argv.slice(2);
setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
await mkdir(resolve(outputPrefix, '..'), { recursive: true });
const server = await createServer({ root: resolve(rootFolder), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-audio-output', '--disable-renderer-backgrounding'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', error => console.log('PAGE ERROR', error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/bench/transparent-order/harness.html`, { timeout: 180000 });
  await page.waitForFunction(() => window.harnessReady, null, { timeout: 180000 });
  if (mode === 'still') {
    const { image } = await page.evaluate(() => window.runStill());
    await writeFile(`${outputPrefix}.png`, Buffer.from(image, 'base64'));
    console.log(`wrote ${outputPrefix}.png`);
  } else {
    for (const kinds of [1, 3]) {
      for (const count of [50, 500]) console.log(JSON.stringify(await page.evaluate(parameters => window.runCost(parameters), { count, kinds })));
    }
  }
} finally {
  await browser.close();
  await server.close();
}
