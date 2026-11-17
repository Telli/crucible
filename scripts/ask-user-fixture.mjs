// A test-only stand-in for the person who answers scene_ask_user (#1956). The agent bench runs the real MCP server through
// `claude -p`, and the browser page waits for Send, so a bench task could never finish. Whoever starts the server may set
// CRUCIBLE_ASK_USER_FIXTURE to an absolute path of a small JSON file; scene_ask_user then answers from its marks instead of opening
// a browser. The variable is read once at start, never appears in a tool schema or the flag list, and no tool call can set it.
import { readFileSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute } from 'node:path';
import { ANNOTATE_LIMITS } from '../src/agent-annotate.js';

export const ASK_USER_FIXTURE_VARIABLE = 'CRUCIBLE_ASK_USER_FIXTURE';
export const ASK_USER_FIXTURE_LIMITS = Object.freeze({ maxBytes: 64 * 1024, maxPixel: 1024, maxMotionTime: 3600 });

function fixtureError(detail) {
  return new Error(`${ASK_USER_FIXTURE_VARIABLE} ${detail}`);
}

function readFixtureText(filePath) {
  if (!isAbsolute(filePath)) throw fixtureError(`must be an absolute path to a .json file, got "${filePath}". Pass the full path.`);
  if (extname(filePath).toLowerCase() !== '.json') throw fixtureError(`must point to a .json file, got "${basename(filePath)}". Rename the file or point to another one.`);
  let size;
  try {
    size = statSync(filePath).size;
  } catch (error) {
    throw fixtureError(`cannot read ${basename(filePath)}: ${error.code ?? error.message}. Point it to an existing file.`);
  }
  if (size > ASK_USER_FIXTURE_LIMITS.maxBytes) {
    throw fixtureError(`file ${basename(filePath)} is ${size} bytes, over the ${ASK_USER_FIXTURE_LIMITS.maxBytes} byte limit. Keep only the marks.`);
  }
  return readFileSync(filePath, 'utf8');
}

function validateFixtureMark(mark, index, name) {
  const where = `${name} mark ${index + 1}`;
  if (!mark || typeof mark !== 'object' || Array.isArray(mark)) throw fixtureError(`${where} must be an object with pixel and note.`);
  const { pixel, note = '', motionTime } = mark;
  const validPixel = Array.isArray(pixel) && pixel.length === 2
    && pixel.every(value => Number.isFinite(value) && value >= 0 && value <= ASK_USER_FIXTURE_LIMITS.maxPixel);
  if (!validPixel) throw fixtureError(`${where} pixel must be [x, y], two numbers from 0 to ${ASK_USER_FIXTURE_LIMITS.maxPixel}.`);
  if (typeof note !== 'string' || note.length > ANNOTATE_LIMITS.maxNoteLength) {
    throw fixtureError(`${where} note must be text of at most ${ANNOTATE_LIMITS.maxNoteLength} characters.`);
  }
  if (motionTime !== undefined && !(Number.isFinite(motionTime) && motionTime >= 0 && motionTime <= ASK_USER_FIXTURE_LIMITS.maxMotionTime)) {
    throw fixtureError(`${where} motionTime must be a number of seconds from 0 to ${ASK_USER_FIXTURE_LIMITS.maxMotionTime}.`);
  }
  // Marks of the browser flow are { x, y, note }; motionTime is checked and then ignored, the pick is of the still frame.
  return { x: pixel[0], y: pixel[1], note };
}

/**
 * The fixture named by the environment, or undefined when the variable is unset or empty.
 * Returns { name, marks } with marks as { x, y, note }, the shape the annotate page sends. Throws an Error that names the variable.
 */
export function loadAskUserFixture(environment = process.env) {
  const filePath = environment[ASK_USER_FIXTURE_VARIABLE];
  if (filePath === undefined || filePath === '') return undefined;
  const name = basename(filePath);
  let parsed;
  try {
    parsed = JSON.parse(readFixtureText(filePath));
  } catch (error) {
    if (error instanceof SyntaxError) throw fixtureError(`file ${name} is not valid JSON: ${error.message}.`);
    throw error;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.marks)) {
    throw fixtureError(`file ${name} must be an object like {"marks":[{"pixel":[384,256],"note":"make this red"}]}.`);
  }
  if (parsed.marks.length < 1 || parsed.marks.length > ANNOTATE_LIMITS.maxMarks) {
    throw fixtureError(`file ${name} needs 1 to ${ANNOTATE_LIMITS.maxMarks} marks, got ${parsed.marks.length}.`);
  }
  return { name, marks: parsed.marks.map((mark, index) => validateFixtureMark(mark, index, name)) };
}

export function describeAskUserFixture(fixture) {
  return `Crucible: scene_ask_user answers come from the fixture ${fixture.name}`;
}
