import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAgentScene } from '../src/agent-scene.js';
import { layoutTextPanel, normalizeTextPanel, rasterizeTextPanel, textPanelTextureSize } from '../src/text-panel.js';

const SIGN = { content: 'OPEN\nCoffee 24h', width: 2, height: 0.8, fontSize: 0.25, color: [1, 0.9, 0.6], background: [0.1, 0.05, 0.02], resolution: 128 };

function digest(frame) {
  return createHash('sha256').update(frame.data).digest('hex');
}

test('the same text panel gives the same bytes on every run (#3237)', () => {
  const first = rasterizeTextPanel(normalizeTextPanel(SIGN));
  const second = rasterizeTextPanel(normalizeTextPanel({ ...SIGN }));
  assert.equal(digest(first), digest(second));
  assert.equal(first.width, 256);
  assert.equal(first.height, 102);
  assert.notEqual(digest(first), digest(rasterizeTextPanel(normalizeTextPanel({ ...SIGN, content: 'CLOSED' }))));
});

test('the glyphs cover pixels and a transparent panel keeps the text colour with alpha as coverage', () => {
  const frame = rasterizeTextPanel(normalizeTextPanel({ content: 'I', width: 0.5, height: 0.5, fontSize: 0.4, color: [1, 0, 0], resolution: 64 }));
  const alphas = Array.from({ length: frame.width * frame.height }, (_, pixel) => frame.data[pixel * 4 + 3]);
  assert.ok(alphas.some(alpha => alpha === 255), 'the stem is fully covered');
  assert.ok(alphas.some(alpha => alpha === 0), 'the corners stay clear');
  for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
    assert.deepEqual(Array.from(frame.data.subarray(pixel * 4, pixel * 4 + 3)), [255, 0, 0]);
  }
});

test('the texture stays within 1024 pixels a side whatever the face size', () => {
  const size = textPanelTextureSize(normalizeTextPanel({ content: 'WIDE', width: 40, height: 10, fontSize: 4, resolution: 2048 }));
  assert.equal(size.width, 1024);
  assert.equal(size.height, 256);
});

test('text wraps at the panel width and "\\n" always breaks', () => {
  const narrow = layoutTextPanel(normalizeTextPanel({ content: 'one two three four five six', width: 1, height: 1, fontSize: 0.2, resolution: 128 }));
  const wide = layoutTextPanel(normalizeTextPanel({ content: 'one two three four five six', width: 20, height: 1, fontSize: 0.2, resolution: 128 }));
  assert.ok(narrow.lines.length > 1);
  assert.equal(wide.lines.length, 1);
  for (const line of narrow.lines) assert.ok(line.width <= narrow.available + 1e-9, `${line.text} fits ${narrow.available}`);
  assert.equal(narrow.lines.map(line => line.text).join(' '), 'one two three four five six');
  const broken = layoutTextPanel(normalizeTextPanel({ content: 'a\nb', width: 20, height: 1, fontSize: 0.2 }));
  assert.deepEqual(broken.lines.map(line => line.text), ['a', 'b']);
  const unwrapped = layoutTextPanel(normalizeTextPanel({ content: 'one two three four five six', width: 1, height: 1, fontSize: 0.2, wrap: false, resolution: 128 }));
  assert.equal(unwrapped.lines.length, 1);
});

test('a word wider than the panel breaks between characters', () => {
  const layout = layoutTextPanel(normalizeTextPanel({ content: 'WWWWWWWWWWWWWWWW', width: 1, height: 1, fontSize: 0.3, resolution: 128 }));
  assert.ok(layout.lines.length > 1);
  for (const line of layout.lines) assert.ok(line.width <= layout.available + 1e-9);
});

test('input is checked at the boundary with the fix in the message', () => {
  assert.throws(() => normalizeTextPanel({ content: '', width: 1, height: 1 }), /text\.content[\s\S]*1 to 512 characters/);
  assert.throws(() => normalizeTextPanel({ content: 'x'.repeat(513), width: 1, height: 1 }), /text\.content/);
  assert.throws(() => normalizeTextPanel({ content: 'a', width: 1, height: 1, font: 'comic' }), /text\.font[\s\S]*sans/);
  assert.throws(() => normalizeTextPanel({ content: 'a', width: 1, height: 1, align: 'justify' }), /text\.align[\s\S]*left, center, right/);
  assert.throws(() => normalizeTextPanel({ content: 'a', width: 1, height: 1, color: [2, 0, 0] }), /text\.color[\s\S]*0 to 1/);
  assert.throws(() => normalizeTextPanel({ content: 'a', height: 1 }), /text\.width/);
  assert.throws(() => normalizeTextPanel({ content: 'a', width: 1, height: 1, size: 3 }), /text\.size[\s\S]*one of the text fields/);
  assert.throws(() => normalizeTextPanel({ content: 'a\n'.repeat(40), width: 1, height: 1 }), /at most 32 lines/);
});

function recipe({ eye = [0, 1.6, 6], nodes = [], materials = [], motion } = {}) {
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'sheet', type: 'plane' }, { id: 'block', type: 'box' }],
    materials: [{ id: 'tag', tag: 'unlit', text: { content: 'Ana', width: 1, height: 0.25, color: [1, 1, 1], background: [0, 0, 0] } }, ...materials],
    nodes,
    camera: { eye, target: [0, 1, 0], up: [0, 1, 0], fov: 40 },
    ...(motion ? { motion } : {}),
  };
}

test('a material with text hands the renderer a baked colour map and blends when transparent', () => {
  const scene = createAgentScene(recipe({
    materials: [{ id: 'glass-sign', tag: 'unlit', text: { content: 'OPEN', width: 1, height: 0.4 } }],
    nodes: [{ id: 'sign', geometry: 'sheet', material: 'glass-sign', scale: [1, 0.4, 1] }],
  }));
  const part = scene.parts.find(candidate => candidate.name === 'sign');
  assert.ok(part.material.map.image.data.length > 0);
  assert.equal(part.material.map.colorSpace, 'srgb');
  assert.equal(part.material.alphaMode, 'blend');
});

function worldCorners(part) {
  const matrix = part.matrix;
  const corners = [];
  // A plane is a 17 by 17 grid: its corners are the first and last of the first row, then the first and last of the last row.
  for (const vertex of [0, 16, 272, 288]) {
    const [x, y, z] = part.geometry.positions.subarray(vertex * 3, vertex * 3 + 3);
    corners.push([0, 1, 2].map(axis => matrix[axis] * x + matrix[4 + axis] * y + matrix[8 + axis] * z + matrix[12 + axis]));
  }
  return corners;
}

// corners are [bottom left, bottom right, top left, top right] of the sheet.
function faceNormal(corners) {
  const first = corners[1].map((value, axis) => value - corners[0][axis]);
  const second = corners[2].map((value, axis) => value - corners[0][axis]);
  const cross = [first[1] * second[2] - first[2] * second[1], first[2] * second[0] - first[0] * second[2], first[0] * second[1] - first[1] * second[0]];
  const length = Math.hypot(...cross);
  return cross.map(value => value / length);
}

test('a billboard faces the camera from several eyes, sits above its node and keeps its world size (#3237)', () => {
  for (const eye of [[0, 1.6, 6], [7, 2, 0], [-4, 5, -4]]) {
    const scene = createAgentScene(recipe({
      eye,
      nodes: [
        { id: 'head', geometry: 'block', material: 'tag', translation: [1, 1, 0] },
        { id: 'nametag', parent: 'head', geometry: 'sheet', material: 'tag', billboard: { size: [1, 0.25], offset: [0, 0.8, 0] } },
      ],
    }));
    scene.sampleMotion(0);
    const part = scene.parts.find(candidate => candidate.name === 'nametag');
    const corners = worldCorners(part);
    const center = [0, 1, 2].map(axis => corners.reduce((sum, corner) => sum + corner[axis], 0) / 4);
    assert.ok(Math.hypot(center[0] - 1, center[1] - 1.8, center[2]) < 1e-3, `centre above the head: ${center}`);
    const toEye = eye.map((value, axis) => value - center[axis]);
    const length = Math.hypot(...toEye);
    const normal = faceNormal(corners);
    const cosine = toEye.reduce((sum, value, axis) => sum + value / length * normal[axis], 0);
    assert.ok(Math.abs(cosine) > 0.9999, `faces ${eye}: ${cosine}`);
    const widths = [Math.hypot(...corners[1].map((value, axis) => value - corners[0][axis])), Math.hypot(...corners[2].map((value, axis) => value - corners[0][axis]))];
    assert.ok(Math.abs(widths[0] - 1) < 1e-3 || Math.abs(widths[1] - 1) < 1e-3, `world size ${widths}`);
  }
});

test('a billboard under a moving part follows it and keeps facing a moving camera', () => {
  const scene = createAgentScene(recipe({
    nodes: [
      { id: 'walker', geometry: 'block', material: 'tag' },
      { id: 'nametag', parent: 'walker', geometry: 'sheet', material: 'tag', billboard: { screenHeight: 0.1, offset: [0, 1, 0] } },
    ],
    motion: { duration: 2, tracks: [
      { kind: 'node', id: 'walker', property: 'translation', keyframes: [{ time: 0, value: [-2, 0, 0] }, { time: 2, value: [2, 0, 0] }] },
      { kind: 'camera', property: 'eye', keyframes: [{ time: 0, value: [0, 1.6, 6] }, { time: 2, value: [6, 1.6, 0] }] },
    ] },
  }));
  const centerAt = time => {
    scene.sampleMotion(time);
    const corners = worldCorners(scene.parts.find(candidate => candidate.name === 'nametag'));
    return [0, 1, 2].map(axis => corners.reduce((sum, corner) => sum + corner[axis], 0) / 4);
  };
  const start = centerAt(0);
  const end = centerAt(2);
  assert.ok(Math.abs(start[0] + 2) < 1e-3 && Math.abs(end[0] - 2) < 1e-3, `x ${start[0]} to ${end[0]}`);
  assert.ok(Math.abs(start[1] - 1) < 1e-3);
});

test('screenHeight keeps the tag one share of the frame at any distance', () => {
  const heightAt = distance => {
    const scene = createAgentScene(recipe({
      eye: [0, 1, distance],
      nodes: [{ id: 'nametag', geometry: 'sheet', material: 'tag', billboard: { screenHeight: 0.05 }, translation: [0, 1, 0] }],
    }));
    scene.sampleMotion(0);
    const corners = worldCorners(scene.parts.find(candidate => candidate.name === 'nametag'));
    const sides = [1, 2].map(index => Math.hypot(...corners[index].map((value, axis) => value - corners[0][axis])));
    return Math.min(...sides);
  };
  const near = heightAt(4);
  const far = heightAt(8);
  assert.ok(Math.abs(far / near - 2) < 1e-3, `ratio ${far / near}`);
  assert.ok(Math.abs(near - 0.05 * 2 * 4 * Math.tan(20 * Math.PI / 180)) < 1e-3);
});

test('billboard input is checked at the boundary', () => {
  const node = billboard => ({ id: 'tag', geometry: 'sheet', material: 'tag', billboard });
  assert.throws(() => createAgentScene(recipe({ nodes: [node({})] })), /billboard[\s\S]*exactly one of size/);
  assert.throws(() => createAgentScene(recipe({ nodes: [node({ size: [1, 1], screenHeight: 0.1 })] })), /exactly one of size/);
  assert.throws(() => createAgentScene(recipe({ nodes: [node({ size: [1] })] })), /billboard\.size[\s\S]*\[width, height\]/);
  assert.throws(() => createAgentScene(recipe({ nodes: [node({ size: [1, 1], tilt: 3 })] })), /billboard\.tilt/);
  assert.throws(() => createAgentScene(recipe({ nodes: [{ id: 'cube', geometry: 'block', material: 'tag', billboard: { size: [1, 1] } }] })), /plane/);
});

test('a billboard is hidden by a part in front of it unless alwaysOnTop is set (#3237)', () => {
  const tagNode = billboard => ({ id: 'tag', geometry: 'sheet', material: 'tag-material', billboard, translation: [0, 1, 0] });
  const scene = materialExtra => createAgentScene(recipe({
    materials: [{ id: 'tag-material', tag: 'unlit', text: { content: 'Ana', width: 1, height: 0.25, background: [0, 0, 0] }, ...materialExtra }],
    nodes: [{ id: 'wall', geometry: 'block', material: 'tag', translation: [0, 1, 2] }, tagNode(materialExtra.depthTest === false ? { size: [1, 0.25], alwaysOnTop: true } : { size: [1, 0.25] })],
  }));
  const hidden = scene({});
  assert.notEqual(hidden.parts.find(part => part.name === 'tag').material.depthTest, false, 'the default tests depth, so the wall hides the tag');
  const onTop = scene({ depthTest: false, alphaMode: 'blend' });
  assert.equal(onTop.parts.find(part => part.name === 'tag').material.depthTest, false, 'alwaysOnTop draws through the wall');
});

test('alwaysOnTop and the material depthTest must agree, and the error says which to change', () => {
  const build = (material, billboard) => createAgentScene(recipe({
    materials: [{ id: 'm', tag: 'unlit', text: { content: 'A', width: 1, height: 0.25, background: [0, 0, 0] }, ...material }],
    nodes: [{ id: 'tag', geometry: 'sheet', material: 'm', billboard }],
  }));
  assert.throws(() => build({}, { size: [1, 1], alwaysOnTop: true }), /alwaysOnTop[\s\S]*depthTest false and alphaMode "blend"/);
  assert.throws(() => build({ depthTest: false, alphaMode: 'blend' }, { size: [1, 1] }), /depthTest[\s\S]*billboard\.alwaysOnTop true/);
  assert.throws(() => build({}, { size: [1, 1], alwaysOnTop: 'yes' }), /billboard\.alwaysOnTop[\s\S]*true or false/);
});
