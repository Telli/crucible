import assert from 'node:assert/strict';
import test from 'node:test';
import { STUDIO_CSS } from '../src/studio-styles.js';

const LAYOUT_PROPERTIES = ['left', 'top', 'right', 'bottom', 'width', 'height', 'margin', 'padding', 'inset', 'grid-template', 'flex-basis', 'font-size', 'all'];
const BAKE_PULSE_SELECTOR = '.crucible-studio-bake-mark .crucible-studio-icon';

/** Flattens the stylesheet into rules, each with the at-rule conditions it sits inside. */
function parseRules(stylesheet) {
  const text = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const conditions = [];
  let buffer = '';
  for (const character of text) {
    if (character === '{') {
      const prelude = buffer.trim();
      buffer = '';
      if (prelude.startsWith('@media') || prelude.startsWith('@container') || prelude.startsWith('@supports')) {
        conditions.push(prelude);
      } else {
        rules.push({ selector: prelude, conditions: [...conditions], body: '' });
        conditions.push(null);
      }
    } else if (character === '}') {
      const closed = conditions.pop();
      if (closed === null) {
        rules.at(-1).body = buffer;
      }
      buffer = '';
    } else {
      buffer += character;
    }
  }
  return rules;
}

function motionDeclarations(rule) {
  const declarations = [];
  for (const declaration of rule.body.split(/;(?![^(]*\))/)) {
    const separator = declaration.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (['transition', 'transition-property', 'transition-duration', 'transition-timing-function', 'animation', 'animation-duration', 'animation-timing-function'].includes(property)) {
      declarations.push({ property, value });
    }
  }
  return declarations;
}

const motionRules = parseRules(STUDIO_CSS)
  .map(rule => ({ ...rule, declarations: motionDeclarations(rule) }))
  .filter(rule => rule.declarations.length > 0);

function transitionedProperties(declaration) {
  if (declaration.property === 'transition-property') {
    return declaration.value.split(',').map(name => name.trim());
  }
  if (declaration.property !== 'transition') {
    return [];
  }
  const segments = declaration.value.split(/,(?![^(]*\))/);
  return segments.map(segment => segment.trim().split(/\s+/)[0]);
}

test('the stylesheet finds the transitions it is meant to check', () => {
  assert.ok(motionRules.length >= 7, `only ${motionRules.length} rules with motion were parsed`);
  assert.ok(motionRules.some(rule => rule.selector === '.crucible-studio-agent-cursor[data-travelling="true"]'));
});

test('no Studio transition animates a layout property or all (#3223)', () => {
  for (const rule of motionRules) {
    for (const declaration of rule.declarations) {
      for (const property of transitionedProperties(declaration)) {
        assert.ok(!LAYOUT_PROPERTIES.includes(property), `${rule.selector} transitions "${property}", which lays out on every frame; use transform, translate, scale, rotate or opacity`);
      }
    }
  }
});

test('every Studio transition is off for reduced motion (#3223)', () => {
  const rules = parseRules(STUDIO_CSS);
  const reducedRules = rules.filter(rule => rule.conditions.some(condition => condition?.includes('prefers-reduced-motion: reduce')));
  const zeroedTokens = reducedRules.flatMap(rule => [...rule.body.matchAll(/(--studio-motion-[a-z]+):\s*0ms/g)].map(match => match[1]));
  for (const rule of motionRules) {
    const gated = rule.conditions.some(condition => condition?.includes('prefers-reduced-motion: no-preference'));
    const switchedOff = reducedRules.some(reduced => reduced.selector === rule.selector && /transition:\s*none|animation:\s*none/.test(reduced.body));
    const durations = rule.declarations.flatMap(declaration => [...declaration.value.matchAll(/var\((--studio-motion-[a-z]+)\)/g)].map(match => match[1]));
    const onlyZeroedTokens = durations.length > 0 && durations.every(token => zeroedTokens.includes(token));
    assert.ok(gated || switchedOff || onlyZeroedTokens, `${rule.selector} moves under reduced motion: wrap it in prefers-reduced-motion: no-preference or add a reduce rule that switches it off`);
  }
});

test('every Studio transition takes its duration and easing from the motion tokens (#3223)', () => {
  for (const rule of motionRules.filter(candidate => candidate.selector !== BAKE_PULSE_SELECTOR)) {
    for (const declaration of rule.declarations) {
      if (declaration.property !== 'transition' || declaration.value === 'none') {
        continue;
      }
      for (const segment of declaration.value.split(/,(?![^(]*\))/)) {
        assert.match(segment, /var\(--studio-motion-(press|quick|base|travel)\)/, `${rule.selector}: "${segment.trim()}" has a hard-coded duration`);
        assert.match(segment, /var\(--studio-ease-(out|in)\)/, `${rule.selector}: "${segment.trim()}" has a hard-coded easing`);
      }
    }
  }
});

test('the motion tokens fall back to the site tokens and reduced motion zeroes the durations without the site sheet (#3223)', () => {
  assert.match(STUDIO_CSS, /--studio-motion-quick: var\(--site-motion-quick, 110ms\);/);
  assert.match(STUDIO_CSS, /--studio-motion-base: var\(--site-motion-base, 170ms\);/);
  assert.match(STUDIO_CSS, /--studio-ease-out: var\(--site-ease-out, cubic-bezier\(0\.2, 0, 0, 1\)\);/);
  const reduced = parseRules(STUDIO_CSS).filter(rule => rule.selector === '.crucible-studio' && rule.conditions.some(condition => condition?.includes('reduce')));
  assert.equal(reduced.length, 1);
  for (const token of ['press', 'quick', 'base', 'travel']) {
    assert.match(reduced[0].body, new RegExp(`--studio-motion-${token}: 0ms`));
  }
});

test('the agent pointer is placed by translate and eases only while it travels (#3223)', () => {
  const pointerRules = parseRules(STUDIO_CSS).filter(rule => rule.selector.startsWith('.crucible-studio-agent-cursor'));
  const base = pointerRules.find(rule => rule.selector === '.crucible-studio-agent-cursor');
  assert.match(base.body, /translate:\s*var\(--studio-agent-x, 0px\) var\(--studio-agent-y, 0px\)/);
  assert.ok(!/(^|[;\s])(left|top)\s*:/.test(base.body), 'the pointer is not placed with left or top');
  const transitioned = pointerRules.filter(rule => /transition/.test(rule.body));
  assert.deepEqual(transitioned.map(rule => rule.selector), ['.crucible-studio-agent-cursor[data-travelling="true"]']);
});
