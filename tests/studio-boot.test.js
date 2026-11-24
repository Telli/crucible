import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  creepTargetAfter,
  driftTargetAfter,
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

// The pour: the pot tips, a curved stream leaves the lip into a pool, droplets hop and the bar fills. Only transform and opacity animate.
const LOADING_STYLE = PAGE_HTML.slice(PAGE_HTML.indexOf('<style>'), PAGE_HTML.indexOf('</style>'));
const KEYFRAME_BLOCKS = [...LOADING_STYLE.matchAll(/@keyframes (studio-[\w-]+) [{]([^\n]*)/g)];
const COMPOSITOR_PROPERTIES = new Set(['transform', 'opacity', 'animation-timing-function']);

// A loading element with a fill that records the animations started on it. The fill stands where the last one ended.
function createProgressPage() {
  const properties = new Map();
  const state = { fillScale: 0.02, started: [], cancelled: 0 };
  const fillElement = {
    ownerDocument: {
      defaultView: { getComputedStyle: () => ({ transform: `matrix(${state.fillScale}, 0, 0, 1, 0, 0)` }) },
    },
    animate(keyframes, options) {
      const scales = keyframes.map(keyframe => Number(/scaleX[(]([\d.]+)/.exec(keyframe.transform)[1]));
      const target = scales[1];
      state.started.push({ from: scales[0], target, driftTarget: scales.at(-1), scales, keyframes, options });
      state.fillScale = target;
      return { cancel: () => (state.cancelled += 1) };
    },
  };
  const loadingElement = {
    dataset: {},
    style: {
      getPropertyValue: name => properties.get(name) ?? '',
      setProperty: (name, value) => properties.set(name, value),
    },
    getAnimations: () => [],
    remove() {},
    querySelector: selector => (selector === '.fill' ? fillElement : null),
  };
  const documentReference = {
    documentElement: { removeAttribute() {} },
    getElementById: id => (id === 'studio-loading' ? loadingElement : null),
  };
  return { loadingElement, documentReference, state, progress: () => Number(properties.get('--progress')) };
}

test('the loading element has a pot, a stream that leaves its lip into a pool, droplets and a fill in the bar', () => {
  assert.match(PAGE_HTML, /<div class="pour">\s*<div class="stream"><div class="flow"><i><\/i><\/div><\/div>\s*<div class="pot">[\s\S]*mark-light[\s\S]*mark-dark[\s\S]*<\/div>\s*<div class="pool"><\/div>\s*<b class="ripple"><\/b>\s*(?:<i class="drop"><\/i>){2}\s*<div class="progress"><div class="fill"><\/div><\/div>/);
  assert.match(PAGE_HTML, /<img class="mark mark-light" src="\/brand\/crucible-mark[.]svg"/, 'the pot is the brand mark file, not a redrawn copy');
  assert.ok(!PAGE_HTML.includes('class="body"'), 'no copy of the mark artwork sits in the page');
});

test('the stream is one static curved clip, wider at the lip than at the pool, with a flow texture inside it', () => {
  const clip = /[.]flow [{][^}]*clip-path: path[(]"([^"]+)"[)]/.exec(LOADING_STYLE);
  assert.ok(clip, 'the stream shape is a static clip-path');
  const topWidth = /^M(\d+) 0H(\d+)/.exec(clip[1]);
  assert.ok(Number(topWidth[2]) - Number(topWidth[1]) > 4, 'the stream is wide where it leaves the lip');
  assert.match(clip[1], /Q\d+ 66 6 66Q4 66 4 64/, 'it ends rounded, 4 px wide, at the pool');
  assert.match(LOADING_STYLE, /[.]flow i [{][^}]*repeating-linear-gradient[(]transparent 0, color-mix[(]in srgb, var[(]--site-text[)] 24%, transparent[)] 4px, transparent 8px, color-mix[(]in srgb, var[(]--site-bg[)] 30%, transparent[)] 11px, transparent 14px[)],\s*var[(]--site-focus[)]/, 'soft lighter and deeper bands made of tokens over the molten colour');
  assert.match(LOADING_STYLE, /studio-stream-flow 0[.]7s linear infinite/);
  assert.match(LOADING_STYLE, /@keyframes studio-stream-flow [{] to [{] transform: translateY[(]14px[)]; [}] [}]/, 'the flow moves by exactly one band period of 14 px, so the loop is seamless');
  assert.match(LOADING_STYLE, /studio-stream-sway 2[.]2s ease-in-out infinite alternate/);
});

test('the stream lands in the middle of the pool and the pool starts at the left end of the bar', () => {
  const rule = selector => new RegExp(`${selector} [{]([^}]*)[}]`).exec(LOADING_STYLE)[1];
  const lengthOf = (body, property) => Number(new RegExp(`(?:^|\\s)${property}: (-?[\\d.]+)(?:px)?;`).exec(body)[1]);
  const pool = rule('#studio-loading [.]pool');
  const bar = rule('#studio-loading [.]progress');
  const stream = rule('#studio-loading [.]stream');
  const clip = /clip-path: path[(]"[^"]*Q8 66 6 66/.test(LOADING_STYLE);
  assert.ok(clip);
  const landingX = lengthOf(stream, 'left') + 6;
  assert.equal(lengthOf(pool, 'left'), lengthOf(bar, 'left'), 'the pool and the bar start at the same x');
  assert.equal(landingX, lengthOf(pool, 'left') + lengthOf(pool, 'width') / 2, 'the stream lands in the middle of the pool');
  assert.equal(lengthOf(pool, 'top') + lengthOf(pool, 'height'), lengthOf(bar, 'top'), 'the pool sits on the bar');
  assert.equal(lengthOf(stream, 'top') + lengthOf(stream, 'height'), lengthOf(pool, 'top') + 4, 'the stream ends inside the pool, its rounded end sunk into it');
  const poolRatio = lengthOf(pool, 'width') / lengthOf(pool, 'height');
  assert.ok(poolRatio >= 2.3 && poolRatio <= 3, 'the pool is a flat puddle, about 2.5 times wider than tall');
});

test('the whole group is scaled up by one transform and still fits a 360 px window', () => {
  const group = /#studio-loading [.]pour [{][^}]*width: (\d+)px;[^}]*transform: translateX[(](\d+)px[)] scale[(]([\d.]+)[)]/.exec(LOADING_STYLE);
  assert.ok(group, 'one transform on the group sets its size and optical position');
  const [, barWidth, shift, scale] = group.map(Number);
  const potLeft = Number(/[.]pot [{][^}]*left: (-\d+)px/.exec(LOADING_STYLE)[1]);
  const windowWidth = 360;
  const origin = windowWidth / 2 + shift;
  const leftEdge = origin + (potLeft - barWidth / 2) * scale;
  const rightEdge = origin + (barWidth - barWidth / 2) * scale;
  assert.ok(leftEdge >= 0 && rightEdge <= windowWidth, `the group spans ${leftEdge} to ${rightEdge} of ${windowWidth}`);
  assert.equal(scale, 1.5);
});

test('the pour animates only transform and opacity, with the fill moved by script and no transition', () => {
  assert.ok(KEYFRAME_BLOCKS.length >= 10, 'tilt, right, stream, sway, flow, pool, drop, fade and fill keyframes exist');
  for (const [, name, body] of KEYFRAME_BLOCKS) {
    const properties = [...body.matchAll(/([\w-]+): [^;]+;/g)].map(match => match[1]);
    assert.ok(properties.length > 0, name);
    for (const property of properties) {
      assert.ok(COMPOSITOR_PROPERTIES.has(property), `${name} animates ${property}`);
    }
  }
  assert.ok(!/(?<![-\w])transition: /.test(LOADING_STYLE), 'no transitions: script and keyframes move the fill');
  assert.match(LOADING_STYLE, /[.]fill [{][^}]*transform: scaleX[(]var[(]--progress/);
  assert.ok(!/will-change|<animate/.test(PAGE_HTML), 'no will-change and no SMIL');
  const clipPaths = LOADING_STYLE.match(/clip-path/g);
  assert.equal(clipPaths.length, 1, 'one static clip, never animated');
});

test('with reduced motion the pot and stream stand still, the fill still moves and the loader still fades', () => {
  const motionStart = LOADING_STYLE.indexOf('@media (prefers-reduced-motion: no-preference) {');
  const motionBlock = LOADING_STYLE.slice(motionStart, LOADING_STYLE.indexOf('@keyframes', motionStart));
  const outsideMotionBlock = LOADING_STYLE.replace(motionBlock, '');
  const animationsOutside = [...outsideMotionBlock.matchAll(/(?<![-\w])animation: ([^;]+);/g)].map(match => match[1].split(' ')[0]);
  assert.deepEqual(animationsOutside, ['studio-fill-creep', 'studio-loader-fade', 'none'], 'only the fill, the closing fade and the error reset run without the no-preference query');
  for (const name of ['pot-tilt', 'stream-in', 'stream-sway', 'stream-flow', 'pool-in', 'ripple', 'drop']) {
    assert.ok(motionBlock.includes(`studio-${name}`), `${name} is inside the no-preference query`);
  }
  for (const selector of ['stream', 'pool', 'ripple', 'drop']) {
    assert.match(LOADING_STYLE, new RegExp(`[.]${selector} [{][^}]*opacity: 0;`), `the ${selector} is hidden until its animation shows it`);
  }
  assert.match(motionBlock, /data-state="done"\] [{] animation-delay: 0[.]2s; [}]/);
  assert.match(LOADING_STYLE, /data-state="done"\] [{] animation: studio-loader-fade 0[.]15s ease-out 0[.]15s both; pointer-events: none; [}]/, 'the hold is shorter with reduced motion');
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

test('between milestones the fill keeps creeping toward a point short of the next one', () => {
  const page = createProgressPage();
  const milestones = Object.values(STUDIO_LOADING_MILESTONES);
  milestones.forEach(value => reportStudioLoadingProgress(page.documentReference, value));
  assert.equal(page.state.started.length, milestones.length, 'each milestone starts one creep');
  assert.equal(page.state.cancelled, milestones.length - 1, 'a new creep replaces the one before it');
  page.state.started.forEach((creep, index) => {
    const nextMilestone = milestones[index + 1] ?? 1;
    assert.ok(creep.options.duration >= 30000, 'a long run, so the fill is still moving after ten seconds');
    assert.match(creep.keyframes[0].easing, /^cubic-bezier/);
    assert.ok(creep.target > milestones[index], 'it heads past the milestone just reached');
    assert.ok(creep.target < nextMilestone, 'it never arrives at the next milestone');
    assert.ok(creep.target <= 0.97, 'it never reaches full');
    assert.ok(creep.target >= creep.from, 'it never moves backward');
    assert.equal(creepTargetAfter(milestones[index]), creep.target);
  });
  const targets = page.state.started.map(creep => creep.target);
  assert.deepEqual([...targets].sort((first, second) => first - second), targets, 'the targets rise');
  assert.ok(creepTargetAfter(0.97) <= 0.97 && creepTargetAfter(2) <= 0.97, 'past the last step the cap holds');
});

test('a fill that has already crept past a lower target keeps its place', () => {
  const page = createProgressPage();
  page.state.fillScale = 0.6;
  reportStudioLoadingProgress(page.documentReference, STUDIO_LOADING_MILESTONES.modulesLoaded);
  assert.equal(page.state.started[0].from, 0.6);
  assert.equal(page.state.started[0].target, 0.6, 'the target is never below where the fill stands');
});

test('the bar fills in 200 ms only after Studio is ready, and the pour winds down with it', async () => {
  const page = createProgressPage();
  let finishReady;
  const studio = { ready: new Promise(resolve => (finishReady = resolve)), setupDone: true, openSetup() {} };
  const frames = [];
  const revealed = revealStudio({ studio, setupParameter: null, documentReference: page.documentReference, requestFrame: callback => frames.push(callback) });
  reportStudioLoadingProgress(page.documentReference, STUDIO_LOADING_MILESTONES.studioCreated);
  await settle();
  assert.ok(page.progress() < 1);
  assert.ok(page.state.started.every(run => run.target < 1), 'no run reaches full before ready');
  assert.equal(page.loadingElement.dataset.state, undefined);
  finishReady();
  await settle();
  assert.equal(page.progress(), 1);
  const completion = page.state.started.at(-1);
  assert.equal(completion.target, 1);
  assert.equal(completion.options.duration, 200);
  assert.equal(page.loadingElement.dataset.state, 'done', 'the stream and pot wind down as the bar fills');
  while (frames.length > 0) {
    frames.splice(0).forEach(callback => callback());
    await settle();
  }
  await revealed;
});

test('the wind-down waits for the animations of the closing sequence and not for the creep or the stream flow', async () => {
  const page = createProgressPage();
  let finished = false;
  const animationEnding = (endTime, finish) => ({ effect: { getComputedTiming: () => ({ endTime }) }, finished: finish });
  const closingFade = animationEnding(780, new Promise(resolve => {
    setTimeout(() => {
      finished = true;
      resolve();
    }, 20);
  }));
  const neverEnding = new Promise(() => {});
  page.loadingElement.getAnimations = () => [closingFade, animationEnding(Infinity, neverEnding), animationEnding(30000, neverEnding)];
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

test('the closing sequence adds at most 0.4 s, and the loading state passes input through from the moment of ready', () => {
  const seconds = pattern => Number(pattern.exec(LOADING_STYLE)[1]);
  const potRight = seconds(/studio-pot-right ([\d.]+)s/);
  const streamOut = seconds(/studio-stream-out ([\d.]+)s/);
  const fadeDuration = seconds(/studio-loader-fade ([\d.]+)s/);
  const fadeDelayWithMotion = seconds(/data-state="done"\] [{] animation-delay: ([\d.]+)s/);
  const fadeDelayReduced = seconds(/studio-loader-fade [\d.]+s ease-out ([\d.]+)s/);
  assert.equal(potRight, streamOut, 'the pot and the stream move together');
  assert.ok(fadeDelayWithMotion >= Math.max(potRight, streamOut), 'the fade starts as they finish');
  assert.ok(fadeDelayWithMotion + fadeDuration <= 0.4, 'the added wait with motion is 0.4 s at most');
  assert.ok(fadeDelayReduced + fadeDuration <= 0.3, 'the added wait with reduced motion is 0.3 s at most');
  assert.match(LOADING_STYLE, /data-state="done"\] [{][^}]*pointer-events: none/, 'the app underneath takes input at once');
});

test('the fade never thins the opaque panel: the panel sits under the loading state and goes with it in the same frame', () => {
  const panelRule = /body:has[(]#studio-loading[)]::before [{]([^}]*)[}]/.exec(LOADING_STYLE);
  assert.ok(panelRule, 'the panel is drawn by the page while the loading element exists');
  assert.match(panelRule[1], /position: fixed; ?\s*inset: 0/s, 'it covers the whole window');
  assert.match(panelRule[1], /background: var[(]--site-bg[)]/, 'it is the theme background token');
  const zIndex = index => Number(new RegExp(index + '[^}]*z-index: (\\d+)', 's').exec(LOADING_STYLE)?.[1]);
  assert.ok(zIndex('body:has') < zIndex('#studio-loading [{]'), 'the loading content stays above the panel');
  const loadingRule = /#studio-loading [{]([^}]*)[}]/.exec(LOADING_STYLE)[1];
  assert.doesNotMatch(loadingRule, /background/, 'the faded element has no background of its own, so the fade shows the panel and never the app');
});

test('past the long ease the fill drifts on, slowly and linearly, and stays below the next step', () => {
  const page = createProgressPage();
  const milestones = Object.values(STUDIO_LOADING_MILESTONES);
  milestones.forEach(value => reportStudioLoadingProgress(page.documentReference, value));
  page.state.started.forEach((creep, index) => {
    const nextMilestone = milestones[index + 1] ?? 1;
    assert.equal(creep.options.duration, 150000, 'thirty seconds of ease and two minutes of drift');
    assert.equal(creep.keyframes[1].offset, 0.2, 'the ease takes the first fifth');
    assert.equal(creep.keyframes[1].easing, 'linear', 'the drift after it is linear');
    assert.ok(creep.driftTarget >= creep.target, 'the drift never goes back');
    assert.ok(creep.driftTarget > creep.target || creep.target === 0.97, 'the drift keeps the fill moving after the ease, unless the cap is already reached');
    assert.ok(creep.driftTarget < nextMilestone, 'the drift never arrives at the next step');
    assert.ok(creep.driftTarget <= 0.97, 'the drift never reaches full');
    assert.equal(driftTargetAfter(milestones[index]), creep.driftTarget);
  });
  assert.ok(driftTargetAfter(0.97) <= 0.97 && driftTargetAfter(2) <= 0.97, 'past the last step the cap holds');
  assert.match(LOADING_STYLE, /studio-fill-creep 150s linear both/);
  assert.match(LOADING_STYLE, /20% [{] transform: scaleX\(0[.]3\); [}] 100% [{] transform: scaleX\(0[.]34\); [}]/, 'before the first step the CSS creep also drifts on, below 0.35');
});
