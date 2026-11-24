import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  reportStudioLoadingProgress,
  revealStudio,
  showStudioLoadingFailure,
  STUDIO_LOADING_MILESTONES,
  waitForNextPaint,
  windDownStudioLoading,
} from '../src/studio-boot.js';
import { STUDIO_PREFERENCES_KEY } from '../src/studio-preferences.js';

const PAGE_HTML = await readFile(new URL('../bench/studio/index.html', import.meta.url), 'utf8');

// A page with a loading element, and a frame clock the test advances by hand.
function createFakePage() {
  const events = [];
  const pendingFrames = [];
  const messageElement = { textContent: '' };
  const loadingElement = {
    dataset: {},
    remove() {
      events.push('loading removed');
    },
    querySelector: selector => (selector === '[data-loading-message]' ? messageElement : null),
  };
  const documentReference = {
    documentElement: {
      removeAttribute(name) {
        events.push(`root ${name} removed`);
      },
    },
    getElementById: id => (id === 'studio-loading' ? loadingElement : null),
  };
  const studio = {
    ready: Promise.resolve(),
    setupDone: false,
    openSetup() {
      events.push('setup opened');
    },
  };
  function requestFrame(callback) {
    pendingFrames.push(callback);
  }
  function paintOneFrame() {
    events.push('frame painted');
    pendingFrames.splice(0).forEach(callback => callback());
  }
  return { events, studio, documentReference, loadingElement, messageElement, requestFrame, paintOneFrame };
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

test('waitForNextPaint resolves only after the browser has painted a frame', async () => {
  const page = createFakePage();
  let resolved = false;
  waitForNextPaint(page.requestFrame).then(() => {
    resolved = true;
  });
  await settle();
  assert.equal(resolved, false);
  page.paintOneFrame();
  await settle();
  assert.equal(resolved, false, 'the callback of the first frame runs before that frame is on screen');
  page.paintOneFrame();
  await settle();
  assert.equal(resolved, true);
});

test('the setup opens only after a frame of the app has painted and the loading state is gone', async () => {
  const page = createFakePage();
  const revealed = revealStudio({ studio: page.studio, setupParameter: null, documentReference: page.documentReference, requestFrame: page.requestFrame });
  await settle();
  assert.deepEqual(page.events, [], 'nothing is removed or opened before the app has drawn');
  page.paintOneFrame();
  await settle();
  page.paintOneFrame();
  await revealed;
  assert.deepEqual(page.events, ['frame painted', 'frame painted', 'loading removed', 'root data-theme removed', 'setup opened']);
});

test('the loading state stays while Studio is not ready', async () => {
  const page = createFakePage();
  let finishReady;
  page.studio.ready = new Promise(resolve => {
    finishReady = resolve;
  });
  revealStudio({ studio: page.studio, setupParameter: null, documentReference: page.documentReference, requestFrame: page.requestFrame });
  page.paintOneFrame();
  page.paintOneFrame();
  await settle();
  assert.deepEqual(page.events, ['frame painted', 'frame painted']);
  finishReady();
  await settle();
  page.paintOneFrame();
  page.paintOneFrame();
  await settle();
  assert.ok(page.events.includes('loading removed'));
});

test('setup=off and a finished setup never open the dialog, and the loading state still goes', async () => {
  for (const variant of [{ setupParameter: 'off', setupDone: false }, { setupParameter: null, setupDone: true }]) {
    const page = createFakePage();
    page.studio.setupDone = variant.setupDone;
    const revealed = revealStudio({ studio: page.studio, setupParameter: variant.setupParameter, documentReference: page.documentReference, requestFrame: page.requestFrame });
    await settle();
    page.paintOneFrame();
    await settle();
    page.paintOneFrame();
    await revealed;
    assert.ok(page.events.includes('loading removed'));
    assert.ok(!page.events.includes('setup opened'));
  }
});

test('a failed boot turns the loading element into an error that shows the message as text', () => {
  const page = createFakePage();
  showStudioLoadingFailure(page.documentReference, new Error('scene.json did not load (HTTP 404).'));
  assert.equal(page.loadingElement.dataset.state, 'error');
  assert.equal(page.messageElement.textContent, 'scene.json did not load (HTTP 404).');
});

test('the page HTML paints the theme and the loading state before any module script runs', () => {
  const moduleScript = PAGE_HTML.indexOf('<script type="module"');
  const tokens = PAGE_HTML.indexOf('href="../../src/site-tokens.css"');
  const themeScript = PAGE_HTML.indexOf('document.documentElement.dataset.theme');
  const loading = PAGE_HTML.indexOf('id="studio-loading"');
  assert.ok(tokens > -1 && tokens < moduleScript, 'the token stylesheet is a link in the HTML, not an import of the module');
  assert.ok(themeScript > tokens && themeScript < moduleScript, 'the saved theme is applied by an inline script');
  assert.ok(loading > -1 && loading < moduleScript, 'the loading element is in the HTML');
  assert.ok(PAGE_HTML.includes(`localStorage.getItem('${STUDIO_PREFERENCES_KEY}')`), 'the inline script reads the key Studio saves its theme under');
  assert.match(PAGE_HTML, /background: var\(--site-bg\)/);
  assert.match(PAGE_HTML, /role="status"/);
  assert.match(PAGE_HTML, /[.]progress [{][^}]*background: color-mix[(]in srgb, var[(]--site-text[)] 22%, transparent[)]/, 'the track is the text token at 22 percent, which stays visible on the paper and on the dark background');
  assert.match(PAGE_HTML, /[.]fill [{][^}]*background: var[(]--site-focus[)]/, 'the fill is the accent token of each theme (it replaced the moving segment of the first loading bar)');
  assert.match(PAGE_HTML, /prefers-reduced-motion: no-preference/);
  assert.match(PAGE_HTML, /data-loading-message/);
  assert.match(PAGE_HTML, /<svg viewBox="0 0 24 24"[^>]*>[\s\S]*<\/svg>\s*<span data-loading-message>/, 'the failure leads with an icon');
});

test('the page script no longer imports the token stylesheet or opens the setup by itself', async () => {
  const pageScript = await readFile(new URL('../bench/studio/main.js', import.meta.url), 'utf8');
  assert.ok(!pageScript.includes("site-tokens.css'"));
  assert.ok(!pageScript.includes('studio.openSetup()'));
  assert.ok(pageScript.includes('revealStudio'));
});

// The pour: the pot tips, a stream leaves the lip and the bar fills. Only transform and opacity may animate.
const LOADING_STYLE = PAGE_HTML.slice(PAGE_HTML.indexOf('<style>'), PAGE_HTML.indexOf('</style>'));
const KEYFRAME_BLOCKS = [...LOADING_STYLE.matchAll(/@keyframes (studio-[\w-]+) [{]([^\n]*)/g)];
const COMPOSITOR_PROPERTIES = new Set(['transform', 'opacity']);

function createProgressPage() {
  const properties = new Map();
  const loadingElement = {
    dataset: {},
    style: {
      getPropertyValue: name => properties.get(name) ?? '',
      setProperty: (name, value) => properties.set(name, value),
    },
    getAnimations: () => [],
    remove() {},
    querySelector: () => null,
  };
  const documentReference = {
    documentElement: { removeAttribute() {} },
    getElementById: id => (id === 'studio-loading' ? loadingElement : null),
  };
  return { loadingElement, documentReference, progress: () => Number(properties.get('--progress')) };
}

test('the loading element has a pot, a stream that leaves its lip and a fill in the bar', () => {
  assert.match(PAGE_HTML, /<div class="pour">\s*<div class="stream"><\/div>\s*<div class="pot">[\s\S]*mark-light[\s\S]*mark-dark[\s\S]*<\/div>\s*<div class="progress"><div class="fill"><\/div><\/div>/);
  assert.match(PAGE_HTML, /<img class="mark mark-light" src="\/brand\/crucible-mark[.]svg"/, 'the pot is the brand mark file, not a redrawn copy');
  assert.ok(!PAGE_HTML.includes('class="body"'), 'no copy of the mark artwork sits in the page');
});

test('the pour animates only transform and opacity, from keyframes and one transition', () => {
  assert.ok(KEYFRAME_BLOCKS.length >= 5, 'tilt, right, stream in, stream out and flow keyframes exist');
  for (const [, name, body] of KEYFRAME_BLOCKS) {
    const properties = [...body.matchAll(/([\w-]+): [^;]+;/g)].map(match => match[1]);
    assert.ok(properties.length > 0, name);
    for (const property of properties) {
      assert.ok(COMPOSITOR_PROPERTIES.has(property), `${name} animates ${property}`);
    }
  }
  const transitions = [...LOADING_STYLE.matchAll(/(?<![-\w])transition: ([\w-]+)[^;]*;/g)].map(match => match[1]);
  assert.deepEqual(transitions, ['transform'], 'the fill is the only transition and it moves by transform');
  assert.match(LOADING_STYLE, /[.]fill [{][^}]*transform: scaleX[(]var[(]--progress/);
  assert.ok(!/will-change|<animate/.test(PAGE_HTML), 'no will-change and no SMIL');
});

test('with reduced motion the pot stands upright and still, no stream moves and the bar still fills', () => {
  const motionStart = LOADING_STYLE.indexOf('@media (prefers-reduced-motion: no-preference) {');
  const motionBlock = LOADING_STYLE.slice(motionStart, LOADING_STYLE.indexOf('@keyframes', motionStart));
  const outsideMotionBlock = LOADING_STYLE.replace(motionBlock, '');
  const animationsOutside = [...outsideMotionBlock.matchAll(/(?<![-\w])animation: ([^;]+);/g)].map(match => match[1]);
  assert.deepEqual(animationsOutside, ['none'], 'every animation except the error reset sits inside prefers-reduced-motion: no-preference');
  assert.match(LOADING_STYLE, /[.]stream [{][^}]*opacity: 0;/, 'the stream is hidden until its animation shows it');
  assert.match(LOADING_STYLE, /[.]fill [{][^}]*transition: transform/, 'the fill moves with progress whatever the motion setting');
});

test('the pour uses only the brand tokens, with no colour of its own', () => {
  const pourRules = LOADING_STYLE.slice(LOADING_STYLE.indexOf('.stream {'), LOADING_STYLE.indexOf('@keyframes'));
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(pourRules));
  assert.match(pourRules, /var[(]--site-focus[)]/);
});

test('progress moves forward through each milestone and never reaches full before Studio is ready', () => {
  const page = createProgressPage();
  const values = [];
  for (const value of Object.values(STUDIO_LOADING_MILESTONES)) {
    reportStudioLoadingProgress(page.documentReference, value);
    values.push(page.progress());
  }
  assert.deepEqual(values, Object.values(STUDIO_LOADING_MILESTONES));
  assert.deepEqual([...values].sort((first, second) => first - second), values, 'the milestones rise');
  reportStudioLoadingProgress(page.documentReference, 0.2);
  assert.equal(page.progress(), values.at(-1), 'a lower report never moves the fill back');
  reportStudioLoadingProgress(page.documentReference, 1);
  assert.ok(page.progress() < 1, 'the report call cannot fill the bar');
});

test('the bar is full only after Studio is ready, and the pour winds down with it', async () => {
  const page = createProgressPage();
  let finishReady;
  const studio = { ready: new Promise(resolve => (finishReady = resolve)), setupDone: true, openSetup() {} };
  const frames = [];
  const revealed = revealStudio({ studio, setupParameter: null, documentReference: page.documentReference, requestFrame: callback => frames.push(callback) });
  reportStudioLoadingProgress(page.documentReference, STUDIO_LOADING_MILESTONES.studioCreated);
  await settle();
  assert.ok(page.progress() < 1);
  assert.equal(page.loadingElement.dataset.state, undefined);
  finishReady();
  await settle();
  assert.equal(page.progress(), 1);
  assert.equal(page.loadingElement.dataset.state, 'done', 'the stream and pot wind down as the bar fills');
  while (frames.length > 0) {
    frames.splice(0).forEach(callback => callback());
    await settle();
  }
  await revealed;
});

test('the wind-down waits for animations that end and not for the looping stream flow', async () => {
  const page = createProgressPage();
  let finished = false;
  const endingAnimation = {
    effect: { getComputedTiming: () => ({ endTime: 400 }) },
    finished: new Promise(resolve => {
      setTimeout(() => {
        finished = true;
        resolve();
      }, 20);
    }),
  };
  const loopingAnimation = { effect: { getComputedTiming: () => ({ endTime: Infinity }) }, finished: new Promise(() => {}) };
  page.loadingElement.getAnimations = () => [endingAnimation, loopingAnimation];
  await windDownStudioLoading(page.documentReference);
  assert.equal(finished, true);
});

test('the page script reports every milestone, in rising order, at the step it names', async () => {
  const pageScript = await readFile(new URL('../bench/studio/main.js', import.meta.url), 'utf8');
  const reported = [...pageScript.matchAll(/reportProgress\('(\w+)'\)/g)].map(match => match[1]);
  assert.deepEqual(reported, Object.keys(STUDIO_LOADING_MILESTONES));
  const position = name => pageScript.indexOf(`reportProgress('${name}')`);
  assert.ok(position('modulesLoaded') < pageScript.indexOf('await loadAllAgentSceneModules()'));
  assert.ok(position('sceneModulesLoaded') > pageScript.indexOf('await loadAllAgentSceneModules()'));
  assert.ok(position('studioCreated') > pageScript.indexOf('createStudio(root'));
  assert.ok(position('sceneFileLoaded') > pageScript.indexOf('await studio.loadExternalTextFile'));
});
