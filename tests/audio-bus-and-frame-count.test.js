import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, webAudioBackend } from '../src/audio.js';

function createParameter(value = 0) {
  return { value, setTargetAtTime(target) { this.value = target; } };
}

function createNode(kind) {
  const node = { kind, connections: [] };
  node.connect = target => { node.connections.push(target); return target; };
  node.disconnect = () => { node.connections.length = 0; };
  return node;
}

function createContext() {
  const nodes = [];
  const track = node => { nodes.push(node); return node; };
  const context = { state: 'running', currentTime: 0, nodes, destination: createNode('destination') };
  context.listener = {};
  for (const name of ['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ']) context.listener[name] = createParameter();
  context.createGain = () => track(Object.assign(createNode('gain'), { gain: createParameter(1) }));
  context.createDynamicsCompressor = () => track(Object.assign(createNode('limiter'), {
    threshold: createParameter(), knee: createParameter(), ratio: createParameter(), attack: createParameter(), release: createParameter(),
  }));
  context.createBufferSource = () => track(Object.assign(createNode('source'), {
    playbackRate: createParameter(1), start() {}, stop() {},
  }));
  return context;
}

test('creating a bus that already exists moves the bus its voices play through', () => {
  const context = createContext();
  const audio = createAudio({ backend: webAudioBackend({ createContext: () => context, gestureTarget: null }) });
  audio.init();
  audio.defineSound('theme', { buffer: { duration: 1 }, bus: 'music', loop: true });
  audio.play('theme');
  const gainsBefore = context.nodes.filter(node => node.kind === 'gain').length;
  audio.createBus('music', 0.5);
  assert.equal(context.nodes.filter(node => node.kind === 'gain').length, gainsBefore, 'no second gain node for the same bus');
  audio.setBusVolume('music', 0.2);
  const voiceGain = context.nodes.find(node => node.kind === 'source').connections[0];
  const busGain = voiceGain.connections[0];
  assert.equal(busGain.gain.value, 0.2);
});

test('videoFrameCount refuses a duration or rate that would give no frame count', async () => {
  const { videoFrameCount } = await import('../src/film-timeline.js');
  assert.equal(videoFrameCount(30, 1), 30);
  assert.throws(() => videoFrameCount(30, Number.NaN), /duration must be a number of seconds from 0/);
  assert.throws(() => videoFrameCount(30, -1), /duration must be a number of seconds from 0/);
  assert.throws(() => videoFrameCount(0, 1), /fps must be a number above 0/);
  assert.throws(() => videoFrameCount(Number.NaN, 1), /fps must be a number above 0/);
});
