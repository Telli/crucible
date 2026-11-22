import assert from 'node:assert/strict';
import test from 'node:test';
import { mat4 } from 'gl-matrix';
import { attachGaussianSplats, createGaussianSplats, GAUSSIAN_SPLAT_SHADER_SOURCES, parseGaussianSplatPly, parseGaussianSplatPlyAsync } from '../src/gaussian-splats.js';
import { evaluateSplatHarmonics, fromHalfFloatBits, harmonicBasis, harmonicTexelsPerSplat, toHalfFloatBits } from '../src/gaussian-splat-harmonics.js';

const BASE_PROPERTIES = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];

// A PLY whose splats carry `restCount` f_rest values each, written after the base properties as 3DGS files do.
function buildPly(splats, restCount) {
  const properties = [...BASE_PROPERTIES, ...Array.from({ length: restCount }, (_, index) => `f_rest_${index}`)];
  const header = ['ply', 'format binary_little_endian 1.0', `element vertex ${splats.length}`, ...properties.map(name => `property float ${name}`), 'end_header', ''].join('\n');
  const headerBytes = new TextEncoder().encode(header);
  const body = new Float32Array(splats.length * properties.length);
  splats.forEach(({ base, rest }, index) => {
    body.set(base, index * properties.length);
    body.set(rest, index * properties.length + BASE_PROPERTIES.length);
  });
  const file = new Uint8Array(headerBytes.length + body.byteLength);
  file.set(headerBytes, 0);
  file.set(new Uint8Array(body.buffer), headerBytes.length);
  return file.buffer;
}

const baseAt = (x, y, z) => [x, y, z, 0.2, 0.4, 0.6, 2, Math.log(0.1), Math.log(0.2), Math.log(0.3), 1, 0, 0, 0];
// f_rest values stored channel by channel, as 3DGS writes them: all red coefficients, then green, then blue.
const restValues = (count, seed) => Array.from({ length: count }, (_, index) => Math.round(Math.sin(seed * 7.1 + index * 1.3) * 1000) / 4000);

test('degree 1 to 3 files keep every band, stored per coefficient as red, green, blue (#2734)', () => {
  for (const [restCount, degree] of [[9, 1], [24, 2], [45, 3]]) {
    const rest = restValues(restCount, degree);
    const parsed = parseGaussianSplatPly(buildPly([{ base: baseAt(0, 0, -3), rest }], restCount));
    assert.equal(parsed.sphericalHarmonics.degree, degree);
    const perChannel = restCount / 3;
    const expected = [];
    for (let coefficient = 0; coefficient < perChannel; coefficient++) {
      for (let channel = 0; channel < 3; channel++) expected.push(Math.fround(rest[channel * perChannel + coefficient]));
    }
    assert.deepEqual(Array.from(parsed.sphericalHarmonics.coefficients), expected);
  }
});

test('sphericalHarmonicDegree keeps fewer bands, and 0 or a file without f_rest gives none (#2734)', async () => {
  const rest = restValues(45, 4);
  const file = buildPly([{ base: baseAt(0, 0, -3), rest }], 45);
  const degreeOne = parseGaussianSplatPly(file, { sphericalHarmonicDegree: 1 });
  assert.equal(degreeOne.sphericalHarmonics.degree, 1);
  assert.deepEqual(Array.from(degreeOne.sphericalHarmonics.coefficients), [0, 1, 2].flatMap(coefficient => [0, 1, 2].map(channel => Math.fround(rest[channel * 15 + coefficient]))));
  assert.equal(parseGaussianSplatPly(file, { sphericalHarmonicDegree: 0 }).sphericalHarmonics, undefined);
  assert.equal(parseGaussianSplatPly(buildPly([{ base: baseAt(0, 0, -3), rest: [] }], 0)).sphericalHarmonics, undefined);
  assert.throws(() => parseGaussianSplatPly(file, { sphericalHarmonicDegree: 4 }), /sphericalHarmonicDegree must be a whole number from 0.*to 3.*got 4/);
  await assert.rejects(parseGaussianSplatPlyAsync(file, { sphericalHarmonicDegree: 1.5 }), /sphericalHarmonicDegree must be/);
  const asynchronous = await parseGaussianSplatPlyAsync(file, { chunkSize: 1 });
  assert.deepEqual(asynchronous.sphericalHarmonics, parseGaussianSplatPly(file).sphericalHarmonics);
});

test('a splat with a non-finite band coefficient is dropped with the rest of its row (#2734)', () => {
  const bad = restValues(9, 2);
  bad[4] = Number.NaN;
  const parsed = parseGaussianSplatPly(buildPly([{ base: baseAt(0, 0, -3), rest: bad }, { base: baseAt(1, 0, -3), rest: restValues(9, 3) }], 9));
  assert.equal(parsed.count, 1);
  assert.deepEqual(parsed.skipped, { count: 1, fields: ['f_rest'] });
  assert.equal(parsed.sphericalHarmonics.coefficients.length, 9);
  assert.equal(parsed.positions[0], 1);
});

test('upAxis z turns the bands with the splat, so each view direction keeps its colour (#2734)', () => {
  const file = buildPly([{ base: baseAt(0, 0, -3), rest: restValues(45, 5) }], 45);
  const original = parseGaussianSplatPly(file);
  const turned = parseGaussianSplatPly(file, { upAxis: 'z' });
  // The turn sends a file direction (x, y, z) to (x, z, -y).
  for (const direction of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.48, -0.6, 0.64], [-0.36, 0.8, 0.48]]) {
    const [x, y, z] = direction;
    const before = evaluateSplatHarmonics(original.sphericalHarmonics, 0, direction);
    const after = evaluateSplatHarmonics(turned.sphericalHarmonics, 0, [x, z, -y]);
    before.forEach((value, channel) => assert.ok(Math.abs(value - after[channel]) < 1e-5, `${direction} channel ${channel}: ${value} vs ${after[channel]}`));
  }
});

test('the basis is the 3DGS one: band one is -y, z, -x times 0.4886 (#2734)', () => {
  const values = harmonicBasis(1, 0.6, 0.8, 0);
  assert.deepEqual(values.map(value => Number(value.toFixed(6))), [-0.390882, 0, -0.293162]);
  assert.equal(harmonicBasis(3, 0, 0, 1).length, 15);
});

test('half floats round trip the coefficient range within half precision (#2734)', () => {
  for (const value of [0, 1, -1, 0.5, 0.1234, -2.75, 65504, 1e-6, -3e-5]) {
    const back = fromHalfFloatBits(toHalfFloatBits(value));
    assert.ok(Math.abs(back - value) <= Math.abs(value) / 1024 + 6e-8, `${value} came back as ${back}`);
  }
  assert.equal(fromHalfFloatBits(toHalfFloatBits(1e6)), Infinity);
  assert.ok(Number.isNaN(fromHalfFloatBits(toHalfFloatBits(Number.NaN))));
  assert.deepEqual([1, 2, 3].map(harmonicTexelsPerSplat), [2, 4, 6]);
});

// A WebGL2 stand-in that records texture uploads and uniforms.
function createRecordingRenderer({ largestTexture = 16384 } = {}) {
  const uploads = [];
  const uniforms = [];
  let nextObject = 0;
  const handlers = {
    isContextLost: () => false,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: name => (name === 'MAX_TEXTURE_SIZE' ? largestTexture : null),
    createTexture: () => ({ texture: nextObject++ }),
    getUniformLocation: (program, name) => name,
    texImage2D: (...parameters) => uploads.push({ height: parameters[4], words: Uint32Array.from(parameters[8]) }),
    uniform1i: (location, value) => uniforms.push([location, value]),
    uniform3f: (location, ...values) => uniforms.push([location, values]),
  };
  const context = new Proxy({}, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (handlers[name]) return handlers[name];
      if (/^[A-Z_0-9]+$/.test(name)) return name;
      return () => ({ created: name });
    },
  });
  const renderer = {
    context,
    canvas: { width: 64, height: 64 },
    multisampleFramebuffer: {},
    projection: mat4.perspective(mat4.create(), 1, 1, 0.1, 50),
    view: mat4.lookAt(mat4.create(), [0, 0, 2], [0, 0, -3], [0, 1, 0]),
    hdr: false,
    drawBlendBatches() {},
    dispose() {},
  };
  return { renderer, uploads, uniforms };
}

test('splats with bands upload their coefficients as half floats and draw with the eye in their own space (#2734)', () => {
  const rest = restValues(9, 6);
  const parsed = parseGaussianSplatPly(buildPly([{ base: baseAt(0, 0, -3), rest }, { base: baseAt(1, 0, -3), rest: restValues(9, 7) }], 9));
  const translated = mat4.fromTranslation(mat4.create(), [5, 0, 0]);
  const splats = createGaussianSplats(parsed, { matrix: translated });
  const harmonicWords = splats.packed.harmonics.words;
  const { renderer, uploads, uniforms } = createRecordingRenderer();
  attachGaussianSplats(renderer, splats);
  assert.ok(uploads.some(upload => upload.words.length === harmonicWords.length && upload.words.every((word, index) => word === harmonicWords[index])));
  const firstSplatValues = [];
  for (let word = 0; word < 8; word++) firstSplatValues.push(fromHalfFloatBits(harmonicWords[word] & 0xffff), fromHalfFloatBits(harmonicWords[word] >>> 16));
  firstSplatValues.slice(0, 9).forEach((value, index) => assert.ok(Math.abs(value - parsed.sphericalHarmonics.coefficients[index]) < 1e-3));
  // Then the colour overflow, then zero padding to the end of the second texel.
  firstSplatValues.slice(9, 12).forEach((value, axis) => assert.ok(Math.abs(value - parsed.sphericalHarmonics.colorOverflow[axis]) < 1e-4));
  assert.deepEqual(firstSplatValues.slice(12), [0, 0, 0, 0]);
  renderer.drawBlendBatches({ eye: [0, 0, 2], exposure: 1 });
  assert.deepEqual(uniforms.filter(([name]) => name === 'harmonicDegree').map(([, value]) => value), [1, 1]);
  assert.ok(uniforms.some(([name, value]) => name === 'harmonicTexels' && value === 2));
  const [, eye] = uniforms.find(([name]) => name === 'eyeModel');
  // The eye sits at world (0, 0, 2); the splats are moved by +5 on x, so in their own space it is at (-5, 0, 2).
  eye.forEach((value, axis) => assert.ok(Math.abs(value - [-5, 0, 2][axis]) < 1e-5, `eye axis ${axis}: ${value}`));
  assert.ok(splats.statistics.gpuBytes >= harmonicWords.byteLength);
});

test('splats without bands draw with degree 0 and upload no band texture of their own (#2734)', () => {
  const parsed = parseGaussianSplatPly(buildPly([{ base: baseAt(0, 0, -3), rest: [] }], 0));
  const { renderer, uploads, uniforms } = createRecordingRenderer();
  attachGaussianSplats(renderer, createGaussianSplats(parsed));
  renderer.drawBlendBatches({ eye: [0, 0, 2], exposure: 1 });
  assert.equal(uploads.length, 2, 'the attachment placeholder for the band sampler and the splat data');
  assert.deepEqual(uniforms.filter(([name]) => name === 'harmonicDegree').map(([, value]) => value), [0, 0]);
  assert.ok(GAUSSIAN_SPLAT_SHADER_SOURCES.vertex.includes('if (harmonicDegree > 0)'));
});

test('createGaussianSplats checks the bands it is given and says what to pass (#2734)', () => {
  const parsed = parseGaussianSplatPly(buildPly([{ base: baseAt(0, 0, -3), rest: restValues(9, 8) }], 9));
  assert.throws(() => createGaussianSplats({ ...parsed, sphericalHarmonics: { degree: 4, coefficients: parsed.sphericalHarmonics.coefficients } }), /degree as a whole number from 1 to 3, got 4/);
  assert.throws(() => createGaussianSplats({ ...parsed, sphericalHarmonics: { degree: 2, coefficients: parsed.sphericalHarmonics.coefficients } }), /coefficients as a Float32Array or Float64Array of 24 values.*got a Float32Array of 9/);
  assert.throws(() => createGaussianSplats({ ...parsed, sphericalHarmonics: { degree: 1, coefficients: [1, 2] } }), /got object/);
  assert.doesNotThrow(() => createGaussianSplats({ ...parsed, sphericalHarmonics: null }));
});

test('detached splats with bands read both textures back and attach again unchanged (#2734)', () => {
  const parsed = parseGaussianSplatPly(buildPly([{ base: baseAt(0, 0, -3), rest: restValues(24, 9) }], 24));
  const splats = createGaussianSplats(parsed);
  const harmonicWords = Uint32Array.from(splats.packed.harmonics.words);
  const textures = new Map();
  const attachedTo = new Map();
  let bound = null;
  let readFramebuffer = null;
  const { renderer } = createRecordingRenderer();
  const recordingContext = renderer.context;
  renderer.context = new Proxy({}, {
    get(target, name) {
      if (name === 'bindTexture') return (unit, texture) => { bound = texture; };
      if (name === 'texImage2D') return (...parameters) => { textures.set(bound, Uint32Array.from(parameters[8])); };
      if (name === 'bindFramebuffer') return (kind, framebuffer) => { if (kind === 'READ_FRAMEBUFFER') readFramebuffer = framebuffer; };
      if (name === 'framebufferTexture2D') return (kind, attachment, target2, texture) => { attachedTo.set(readFramebuffer, texture); };
      if (name === 'readPixels') return (...parameters) => parameters[6].set(textures.get(attachedTo.get(readFramebuffer)));
      return recordingContext[name];
    },
  });
  const detach = attachGaussianSplats(renderer, splats);
  detach();
  assert.equal(splats.packed.harmonics.degree, 2);
  assert.deepEqual(splats.packed.harmonics.words, harmonicWords);
});

test('a constant colour past the colour bytes travels with the bands, so a band can darken it back (#2734)', () => {
  // f_dc 3 gives 0.5 + 0.2821 x 3 = 1.346 red: the byte stops at 255 and the overflow keeps the rest.
  const bright = baseAt(0, 0, -3);
  bright[3] = 3;
  bright[4] = -3;
  const parsed = parseGaussianSplatPly(buildPly([{ base: bright, rest: restValues(9, 2) }], 9));
  assert.equal(parsed.colors[0], 255);
  assert.equal(parsed.colors[1], 0);
  const { colorOverflow } = parsed.sphericalHarmonics;
  assert.ok(Math.abs(colorOverflow[0] - (0.5 + 0.28209479177387814 * 3 - 1)) < 1e-6);
  assert.ok(Math.abs(colorOverflow[1] - (0.5 - 0.28209479177387814 * 3)) < 1e-6);
  assert.ok(Math.abs(colorOverflow[2]) <= 0.5 / 255 + 1e-6, 'an in-range channel keeps only its rounding');
  assert.equal(parseGaussianSplatPly(buildPly([{ base: bright, rest: [] }], 0)).sphericalHarmonics, undefined, 'without bands the colour stays clamped');
  const withoutOverflow = createGaussianSplats({ ...parsed, sphericalHarmonics: { degree: 1, coefficients: parsed.sphericalHarmonics.coefficients } });
  assert.equal(fromHalfFloatBits(withoutOverflow.packed.harmonics.words[4] >>> 16), 0, 'data without an overflow packs zero');
  assert.throws(() => createGaussianSplats({ ...parsed, sphericalHarmonics: { ...parsed.sphericalHarmonics, colorOverflow: new Float32Array(2) } }), /colorOverflow as a Float32Array or Float64Array of 3 values/);
});

test('a flipped and moved matrix puts the eye in the splats own space (#2734)', () => {
  const parsed = parseGaussianSplatPly(buildPly([{ base: baseAt(0, 0, -3), rest: restValues(9, 4) }], 9));
  // The guide's y-down capture matrix: flip y and z and move 3 m back.
  const splats = createGaussianSplats(parsed, { matrix: [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, -3, 1] });
  const { renderer, uniforms } = createRecordingRenderer();
  attachGaussianSplats(renderer, splats);
  renderer.drawBlendBatches({ eye: [0, 0, 2], exposure: 1 });
  const [, eye] = uniforms.find(([name]) => name === 'eyeModel');
  // World z = -model z - 3, so the eye at world z 2 sits at model z -5.
  eye.forEach((value, axis) => assert.ok(Math.abs(value - [0, 0, -5][axis]) < 1e-5, `eye axis ${axis}: ${value}`));
});

test('a GPU too small for the band texture draws one colour per splat instead of failing (#2734)', () => {
  const rows = Array.from({ length: 700 }, (unused, index) => ({ base: baseAt(index * 0.01, 0, -3), rest: restValues(45, index) }));
  const parsed = parseGaussianSplatPly(buildPly(rows, 45));
  const splats = createGaussianSplats(parsed);
  // 700 splats take one row of the splat texture and three rows of degree 3 bands; this GPU allows two.
  const { renderer, uploads, uniforms } = createRecordingRenderer({ largestTexture: 2 });
  attachGaussianSplats(renderer, splats);
  renderer.drawBlendBatches({ eye: [0, 0, 2], exposure: 1 });
  const heights = uploads.map(upload => upload.height);
  assert.ok(heights.includes(2) && !heights.includes(3), `the two-row splat texture goes up, the three-row bands do not: ${heights}`);
  assert.match(splats.statistics.harmonicsSkipped, /needs 3 rows, over this GPU's limit of 2.*lower sphericalHarmonicDegree/);
  assert.equal(splats.statistics.gpuBytes, 2 * 2048 * 16 + 700 * 4, 'the bands are not counted');
  const degrees = uniforms.filter(([name]) => name === 'harmonicDegree').map(([, value]) => value);
  assert.ok(degrees.length > 0 && degrees.every(value => value === 0), `every pass draws without bands: ${degrees}`);
});
