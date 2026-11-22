// A 64-bit fingerprint of what a value holds (numbers, strings, arrays, plain objects, typed arrays), so a cache can be
// keyed by content instead of by object identity: a scene rebuilt from the same recipe makes new objects with the same content.

const FIRST_MULTIPLIER = 0x9e3779b1;
const SECOND_MULTIPLIER = 0x85ebca6b;
const FINISH_MULTIPLIER = 0xc2b2ae35;

function createState() {
  return { first: 0x811c9dc5, second: 0x1b873593, words: 0 };
}

function mixWord(state, word) {
  state.first = Math.imul(state.first ^ word, FIRST_MULTIPLIER);
  state.first = (state.first << 13) | (state.first >>> 19);
  state.second = Math.imul(state.second + word, SECOND_MULTIPLIER);
  state.second ^= state.second >>> 15;
  state.words++;
}

const numberScratch = new Float64Array(1);
const numberWords = new Uint32Array(numberScratch.buffer);

function mixNumber(state, number) {
  numberScratch[0] = number;
  mixWord(state, numberWords[0]);
  mixWord(state, numberWords[1]);
}

function mixString(state, text) {
  mixWord(state, text.length);
  for (let index = 0; index < text.length; index++) {
    mixWord(state, text.charCodeAt(index));
  }
}

function mixTypedArray(state, array) {
  mixString(state, array.constructor.name);
  mixWord(state, array.byteLength);
  const wholeWords = array.byteOffset % 4 === 0 && array.byteLength % 4 === 0;
  if (wholeWords) {
    const words = new Uint32Array(array.buffer, array.byteOffset, array.byteLength / 4);
    for (let index = 0; index < words.length; index++) {
      mixWord(state, words[index]);
    }
    return;
  }
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  for (let index = 0; index < bytes.length; index++) {
    mixWord(state, bytes[index]);
  }
}

function mixValue(state, value, path) {
  if (value === null || value === undefined) {
    mixString(state, value === null ? 'null' : 'undefined');
  } else if (typeof value === 'number') {
    mixNumber(state, value);
  } else if (typeof value === 'string') {
    mixString(state, value);
  } else if (typeof value === 'boolean') {
    mixWord(state, value ? 1 : 2);
  } else if (typeof value === 'function') {
    mixString(state, 'function');
  } else if (ArrayBuffer.isView(value)) {
    mixTypedArray(state, value);
  } else if (typeof value === 'object') {
    mixObject(state, value, path);
  } else {
    mixString(state, String(value));
  }
}

function mixObject(state, object, path) {
  if (path.has(object)) {
    mixString(state, 'cycle');
    return;
  }
  path.add(object);
  if (object instanceof Map) {
    mixString(state, 'Map');
    for (const [key, value] of object) {
      mixValue(state, key, path);
      mixValue(state, value, path);
    }
  } else if (Array.isArray(object)) {
    mixString(state, 'Array');
    mixWord(state, object.length);
    for (const item of object) {
      mixValue(state, item, path);
    }
  } else {
    mixString(state, 'Object');
    for (const key of Object.keys(object)) {
      mixString(state, key);
      mixValue(state, object[key], path);
    }
  }
  path.delete(object);
}

/** The fingerprint of `value` as a short string; equal content gives an equal string, and key order inside an object counts. */
export function contentFingerprint(value) {
  const state = createState();
  mixValue(state, value, new Set());
  const first = Math.imul(state.first ^ state.words, FINISH_MULTIPLIER) >>> 0;
  const second = Math.imul(state.second ^ (state.words >>> 16), FINISH_MULTIPLIER) >>> 0;
  return `${first.toString(36)}-${second.toString(36)}-${state.words.toString(36)}`;
}

/** The bytes a value's typed arrays hold, which is what a cache of it keeps alive. */
export function retainedBytes(value, seen = new Set()) {
  if (ArrayBuffer.isView(value)) {
    return seen.has(value.buffer) ? 0 : (seen.add(value.buffer), value.byteLength);
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return 0;
  }
  seen.add(value);
  const children = value instanceof Map ? [...value.values()] : Object.values(value);
  return children.reduce((total, child) => total + retainedBytes(child, seen), 0);
}
