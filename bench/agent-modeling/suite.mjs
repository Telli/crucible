// The agent bench: the tasks that make up one bench run, each tagged with the kind of work it tests. Ids come from
// tasks.mjs (every one has a reference solution and an automatic grader). SMOKE_TASKS is the two-task subset used to
// prove the pipeline end to end without paying for a full run.
//
// `topics` names the scene_capabilities topics a task clearly exercises, only where it does. bench.mjs --kinds and --topics
// select tasks by `kind` and `topics`, so a one-topic change runs only its related tasks (subsets.mjs).

import { SCENE_TASKS } from './scenes.mjs';

export const BENCH_TASKS = [
  { id: 'crate', kind: 'modeling', topics: ['meshEdits'] },
  { id: 'bolt', kind: 'modeling' },
  { id: 'table', kind: 'modeling' },
  { id: 'mug', kind: 'modeling' },
  { id: 'gear', kind: 'modeling' },
  { id: 'pillar-court', kind: 'modeling' },
  { id: 'chair', kind: 'modeling' },
  { id: 'crate-uv', kind: 'modeling', topics: ['meshUv'] },
  { id: 'crate-revision', kind: 'revision' },
  { id: 'bracket-revision', kind: 'revision' },
  { id: 'kettle-resize', kind: 'revision', topics: ['relations'] },
  { id: 'workshop', kind: 'scene' },
  { id: 'shelf-faces', kind: 'scene', topics: ['relations'] },
  { id: 'desk-resize', kind: 'scene', topics: ['relations'] },
  { id: 'terrain-hole-walk', kind: 'scene', topics: ['terrain'] },
  { id: 'explosion-blast', kind: 'scene', topics: ['explosion', 'particles', 'localVolumes'] },
  { id: 'look-pick', kind: 'look' },
  { id: 'look-metal', kind: 'look' },
  { id: 'look-fog', kind: 'look' },
  { id: 'render-pick', kind: 'light' },
  { id: 'light-pick-hard', kind: 'light' },
  { id: 'light-key-fill', kind: 'light' },
  { id: 'light-spot-shadow', kind: 'light' },
  { id: 'camera-closeup', kind: 'camera' },
  { id: 'camera-orbit', kind: 'camera', topics: ['filmTimeline'] },
  { id: 'robot-shot', kind: 'camera', topics: ['motionIk', 'placedAssets'] },
  { id: 'overshoot-lift', kind: 'animation' },
  { id: 'robot-walk-wave', kind: 'animation', topics: ['placedAssets'] },
  { id: 'sunset-timelapse', kind: 'film', topics: ['filmTimeline'] },
  { id: 'film-reveal', kind: 'film', topics: ['filmTimeline'] },
];

// Tasks that scenes.mjs defines but the default run leaves out (findings-fix tests the findings channel, not a tool schema).
// `--tasks` accepts them by id; `--kinds`, `--topics` and the default run stay on BENCH_TASKS.
export const OPTIONAL_TASK_IDS = SCENE_TASKS.map(task => task.id).filter(id => !BENCH_TASKS.some(task => task.id === id));

export const SMOKE_TASKS = ['bolt', 'camera-closeup'];

export const kindOf = Object.fromEntries(BENCH_TASKS.map(task => [task.id, task.kind]));
