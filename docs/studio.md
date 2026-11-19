# Studio

Crucible Studio lets designers and AI agents work on the same `crucible.scene` recipe. It is an addon (`crucible/addons/studio`) that an app embeds; it is not a page of the public site. It adds zero bytes to the core library entry (`crucible`).

## Open Studio

An app mounts it with `createStudio(container, options)` (see below). To try it from a checkout, run `npm run dev` and open `/bench/studio/index.html`. Drop a `scene.json` on the window, or click the file name at the top left and choose **Open**.

## The screen

The scene fills the window and the controls float on top of it.

| Where | What it does |
| --- | --- |
| Top left | The file name opens the file menu: open, save, the recipe JSON and the starting scenes. A green dot means Studio reloads the file when an agent edits it. |
| Top, beside the file name | The workspaces, in the order the work runs: **Build** (objects and their place), **Look** (materials, lighting, sun, exposure, fog) and **Animate** (camera, lens, shots and the timeline). Each one shows only the panels its step needs. Opening a panel from anywhere, or adding a keyframe, brings its workspace forward. A workspace is a way of looking at the scene: it is not saved in the recipe and undo does not touch it. |
| Top right | Work with an agent, Settings, keyboard shortcuts, and **Export** (PNG image, GLB model, web pack). |
| Left rail | Select, move, rotate, scale, snap to a surface, undo, redo, add an object or a light, show or hide the grid, show or hide the panels. |
| Scene card | At the top of the right column, with a filter box. Every object in the scene, drawn as the shape of its geometry (cube, sphere, cylinder, cone, torus, plane, or a stack for a group) in the colour of its material, an eye to hide each one, and the scene materials as swatches. |
| Properties | Under the Scene card, in the same column. The panels of the open workspace: the object in Build, material and look in Look, the camera (views, lens, shots) in Animate. |
| Bottom, in Animate | Play, add a keyframe, scrub the time, jump to a saved shot. The readout and the view widget move up to make room for it. |
| Bottom left | The camera (perspective and lens, or orthographic), the grid step, and the size of the selected object in metres. |
| Bottom right | The view widget: the X, Y and Z axes as the camera sees them. Click an end to look from the right, left, top, front or back. |

The ground carries a grid with one line per metre over 20 m, the X axis in red and the Z axis in blue. The grid is a working aid: it is not part of the recipe and stays out of PNG, GLB and pack exports. `studio.setGridVisible(false)` hides it from code.

The selected object gets an outline. Below 820 px wide the two cards start closed so the scene keeps the screen; the panels button on the rail opens them.

## Move, rotate and scale

Each tool has its own handle shape, so the shape says what a drag will do: arrows move, rings turn, squares scale. The handles follow the object, not the camera: the three axes are the object's own X, Y and Z, so a turned object moves along the way it faces.

- **Move** drags the object exactly as far as the pointer travels along the axis. Hold Shift to move in steps (0.25 m unless you change it in Settings). While you drag, a dashed outline stays where the object was and a dashed line runs from there to where it is now; scale and rotate drags keep the outline too. A new object lands on the ground beside the ones already there, not inside them.
- **Rotate** turns the object by the angle the pointer sweeps on the ring. Hold Shift to turn in steps (15 degrees unless you change it in Settings). While you drag, the other two rings leave, a dashed spoke stays where the drag began, a solid spoke follows the object, and a faint wedge between them fills the angle turned so far. A turn can go past half a circle and keeps counting.
- **Scale** on an axis handle scales by how far you pull it: twice the distance doubles that axis. The centre handle scales all three.

One drag is one undo step, and undo leaves the viewport camera where you put it.

## Keys

The keys follow Blender where Studio has the same action. The **?** button lists them all.

| Key | Action |
| --- | --- |
| Q, G, R, S, T | Select, move, rotate, scale, snap to a surface |
| Shift+A | Add an object or a light |
| Shift+D or Ctrl+D | Duplicate |
| X or Delete | Delete |
| Esc | Deselect |
| F or . | Frame the selection |
| 1, 3, 7 | Front, right and top view |
| 5 | Perspective or orthographic |
| N | Show or hide Properties |
| I or K | Insert a keyframe |
| Space | Play |
| Ctrl+Z, Ctrl+Shift+Z | Undo, redo |
| Ctrl+O, Ctrl+S | Open, save |
| Ctrl+, | Settings |

Keys do nothing while you type in a field or while a dialog is open. Typing an axis after G, R or S, as Blender does, is not supported: drag the handle of that axis instead.

## Settings

The sliders button at the top right opens Settings: the step and the angle a Shift drag snaps to, the size of the handles, the workspace Studio opens in, and whether the grid, the readout, the axis widget and the agent cursor show. They are kept in the browser (`localStorage`, key `crucible-studio-preferences`), not in the scene recipe, so a scene looks the same for everyone and each person keeps their own setup. **Reset** brings back the defaults. An app can pass `preferences` to `createStudio` to start from other values, `preferenceStorage: null` to keep nothing, and call `studio.setPreference(name, value)`.

## Mount the Studio in an app

Import `createStudio` from `crucible/addons/studio` and pass a container element and a scene recipe.

```js
import { createStudio } from 'crucible/addons/studio';

const studio = createStudio(document.querySelector('#studio-root'), {
  homeHref: '/', // optional: makes the mark at the top left a link back to your app
  recipe: {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'box', type: 'box' }],
    materials: [{ id: 'clay', tag: 'surface', color: [0.8, 0.4, 0.3], roughness: 0.45, metallic: 0 }],
    nodes: [{ id: 'cube', geometry: 'box', material: 'clay', translation: [0, 0.5, 0] }],
    camera: { eye: [3, 2, 4], target: [0, 0.5, 0], up: [0, 1, 0], fov: 45 },
  },
});

// Read back the updated recipe for your AI agent workflow.
const updatedRecipe = studio.exportRecipe();
```

## See the agent at work

When an agent edits the scene, Studio shows a pointer with the agent's name, the way a collaborator's cursor shows in a shared document. The pointer travels to each object the agent changed, a dashed outline marks that object, and the status line says what changed ("Claude edited hero, orb").

- A reload of the watched file counts as an agent edit. `createStudio(container, { agentName: 'Claude' })` sets the name on the pointer; without it the name is "Agent".
- `studio.loadExternalTextFile(text, { agent })` takes `agent: { name }` to name the agent for one edit, `agent: true` to mark any load as an agent edit, and `agent: false` to load without the pointer.
- `studio.showAgentEdit({ name, nodeIds })` points at objects directly, for a host that hears about each agent step as it happens.

Each agent gets its own colour, picked from its name out of five brand colours, so two agents are easy to tell apart; the pointer, the name tag and the outline share it. The pointer keeps to its object while you orbit, visits at most eight objects for one edit, and with reduced motion it steps from object to object without gliding.

## Headless controller for tools and tests

Import `createStudioController` to drive picking, gizmo drags, surface snapping, look edits and camera bookmarks without DOM rendering.

```js
import { createAgentScene } from 'crucible/addons/agent-scene';
import { createStudioController } from 'crucible/addons/studio';

const scene = createAgentScene(recipe);
const controller = createStudioController({ scene, viewportWidth: 960, viewportHeight: 540 });

controller.pickAt(480, 270);
controller.saveBookmark('Front');
controller.setSunAngles({ azimuthDegrees: -40, elevationDegrees: 52 });
```

`controller.gizmoHandles()` returns the pivot, the object's world axes (`basis`) and the screen points of each handle. `controller.selectionOutline()` returns the screen polygon around the selected object, or `null` when nothing is selected or part of it is behind the camera.

## What Studio edits in the recipe

1. Viewport clicks and gizmo drags emit deterministic `set-node` updates on `translation`, `rotation` and `scale`, measured along the object's own axes.
2. Surface snap (`Snap` mode or Alt-click) raycasts against other scene parts and offsets the node along the surface normal.
3. Material and look controls update the active material, `environment` and `effects` sections directly.
4. Saved camera bookmarks read and write named shots in `recipe.timeline.shots`.
5. Every change exports cleanly with `exportRecipe()` so AI agents can continue from the same scene revision.
