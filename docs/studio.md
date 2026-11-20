# Studio

Crucible Studio lets designers and AI agents work on the same `crucible.scene` recipe. It is an addon (`crucible/addons/studio`) that an app embeds; it is not a page of the public site. It adds zero bytes to the core library entry (`crucible`).

## Open Studio

An app mounts it with `createStudio(container, options)` (see below). To try it from a checkout, run `npm run dev` and open `/bench/studio/index.html`. Drop a `scene.json` on the window, or click the file name at the top left and choose **Open**.

## The screen

The scene fills the window and the controls float on top of it.

| Where | What it does |
| --- | --- |
| Top left | The menus. **File**: open, save, the recipe JSON, the three exports and the starting scenes. **Edit**: undo, redo, duplicate, delete, deselect and Settings. **View**: front, right and top view, perspective or orthographic, frame the selection, the grid and the panels. **Agent**: copy a prompt for an AI agent and reload when it edits the file. **Help**: the keyboard shortcuts. Each row shows its key. |
| Top centre | The workspaces, in the order the work runs: **Build** (objects and their place), **Look** (materials, lighting, sun, exposure, fog) and **Animate** (camera, lens, shots and the timeline). Each one shows only the panels its step needs. Opening a panel from anywhere, or adding a keyframe, brings its workspace forward. A workspace is a way of looking at the scene: it is not saved in the recipe and undo does not touch it. |
| Top right | The file name, which opens the File menu, and **Export** (PNG image, GLB model, web pack). A green dot beside the name means Studio reloads the file when an agent edits it. |
| Left rail | The tools that change the scene come first: select, move, rotate, scale, snap to a surface, then add an object or a light, undo and redo. Under one line sit the switches that only change what you see: show or hide the grid, show or hide the panels. |
| Scene card | At the top of the right column, across from the rail. Its head has a search button, which opens a box that filters the list as you type (Esc closes it and clears the filter), and an add button with the same menu as the rail. Every object in the scene, drawn as the shape of its geometry (cube, sphere, cylinder, cone, torus, plane, or a stack for a group) in the colour of its material, an eye to hide each one, and the scene materials as swatches. |
| Properties | Under the Scene card, in the same column. The panels of the open workspace: the object in Build, material and look in Look, the camera (views, lens, shots) in Animate. |
| Bottom, in Animate | Play, add a keyframe, scrub the time, jump to a saved shot. The readout and the view widget move up to make room for it. |
| Bottom left | The camera (perspective and lens, or orthographic), the grid step, and the size of the selected object in metres. |
| Bottom right | The view widget: the X, Y and Z axes as the camera sees them. Click an end to look from the right, left, top, front or back. |

The ground carries a grid that covers the floor far out, with the X axis in red and the Z axis in blue. Up close it has one line per metre; as you zoom out the step grows tenfold (10 m, 100 m) and as you zoom in it shrinks (10 cm), and the readout at the bottom left names the step. Every tenth line is stronger, and the lines thin and fade with distance instead of crowding the far floor. The grid is a working aid: it is not part of the recipe and stays out of PNG, GLB and pack exports. `studio.setGridVisible(false)` hides it from code.

The floor of the viewport reaches the horizon however far you zoom out (up to 400 m from the target), and the viewport keeps drawing the scene beyond the `far` of the scene camera. A PNG export still uses the scene camera as it is saved.

The selected object gets an outline that follows its shape: it goes in between the points of a star and around each letter of a text. An object with more than 8,000 triangles gets a simpler outline around its hull. Drag the inner edge of the right column to make it wider or narrower (240 to 520 px), and drag the gap between the two cards to give the Scene card more or less of the column. Both grips also take the arrow keys, and a double click puts the opening size back. The arrow in the head of each card folds that card down to its head. Studio keeps these sizes and folded cards in the browser. The panels float over the scene by default. Turn off **Floating panels** in the View menu or in Settings and the bar, the rail and the column take the edges of the window instead: the viewport becomes the room they leave and the scene is drawn at that size, so nothing covers it and its proportions stay true. Below 820 px wide the two cards start closed so the scene keeps the screen; the panels button on the rail opens them.

## Move, rotate and scale

Each tool has its own handle shape, so the shape says what a drag will do: arrows move, rings turn, squares scale. A handle does not have to be hit exactly: a press within about 11 pixels of an axis or ring, or 16 pixels of its tip, takes it. The handles follow the object, not the camera: the three axes are the object's own X, Y and Z, so a turned object moves along the way it faces. The handles have no border at rest; the one under the pointer grows thicker and brighter and gets a pale border, so you see what a press will grab. An axis that points almost at the camera is drawn longer, so it never shrinks to a stub you cannot catch.

- **Move** drags the object exactly as far as the pointer travels along the axis. Hold Shift to move in steps (0.25 m unless you change it in Settings). While you drag, a dashed outline stays where the object was and a dashed line runs from there to where it is now; scale and rotate drags keep the outline too. The dashed lines are pale with a dark border, so they show over a pale object and over the dark ground. A new object lands on the ground beside the ones already there, not inside them.
- **Rotate** turns the object by the angle the pointer sweeps on the ring. Hold Shift to turn in steps (15 degrees unless you change it in Settings). While you drag, the other two rings leave, a dashed spoke stays where the drag began, a solid spoke follows the object, and a faint wedge between them fills the angle turned so far. A turn can go past half a circle and keeps counting.
- **Scale** on an axis handle scales by how far you pull it: twice the distance doubles that axis. The centre handle scales all three.

One drag is one undo step, and undo leaves the viewport camera where you put it.

## Add an object or a light

The add button on the rail and the one in the Scene head (or Shift+A) open the same menu. The shapes come in three groups, then the lights (point, spot and area):

| Group | Shapes |
| --- | --- |
| Solids | box, sphere, icosphere, cylinder, cone, torus, capsule, dome, pyramid, prism, hexagon, wedge, pipe, arch, gem |
| Flat shapes | plane, disc, ring, star, heart, 3D text |
| Swept and grown shapes | vase, bowl, spring, knot, stairs, terrain |

Each shape is an ordinary recipe geometry, so an agent can keep editing it: a ring is a `circle` with `innerRadius`, a vase and a capsule are a `lathe`, a star, a heart, a prism, a wedge and stairs are an `extrude`, a spring and a knot are a `tube` along a path, and a pyramid, a dome, a pipe, a bowl and a gem are a `mesh` around a `lathe` with a `smoothAngle` that keeps their edges hard. A new shape is about a metre wide and rests on the ground. A menu that opens low on the screen grows upward, so it stays inside the window.

## Keys

The keys follow Blender where Studio has the same action. **Help ▸ Keyboard shortcuts** (or **?**) lists them all.

| Key | Action |
| --- | --- |
| Q, T | Select, snap to a surface |
| G, R, S | Pick the selected object up to move, rotate or scale it |
| X, Y, Z | While holding an object: keep it to that axis; the same key again frees it |
| Click or Enter, Esc or right click | While holding an object: place it, put it back |
| Shift+A | Add an object or a light |
| Shift+D or Ctrl+D | Duplicate |
| X or Delete | Delete |
| Esc | Deselect |
| H, Alt+H | Hide the selection, show everything that is hidden |
| Alt+G, Alt+R, Alt+S | Reset the position, rotation or scale of the selection |
| Right click | Menu of the object under the pointer |
| F or . | Fly to the selection, or to the whole scene when nothing is selected |
| 1, 3, 7 | Front, right and top view |
| 5 | Perspective or orthographic |
| N | Show or hide Properties |
| I or K | Insert a keyframe |
| Space | Play |
| Ctrl+Z, Ctrl+Shift+Z | Undo, redo |
| Ctrl+O, Ctrl+S | Open, save |
| Ctrl+, | Settings |

F keeps the direction you look from and stands back just far enough for the object to fill the view. The camera flies there in a third of a second, so you can follow where the view went; any other camera input takes over at once, and with reduced motion the view jumps. Like an orbit, it is not an undo step.

When a motion track moves the camera, the track decides what the scene camera sees. So the first orbit, zoom, pan, F or view preset there starts a free view: the viewport looks around on its own, and the recipe, the animated camera and a still stay as they were. **View → Animated camera** takes you back to the animated camera, and a saved view keeps what the viewport shows.

Keys do nothing while you type in a field or while a dialog is open.

G, R and S work as in Blender. With an object selected and the pointer over the viewport, the key picks the object up: it follows the pointer with no handle to aim at, and a pill at the bottom of the viewport shows how far it has gone and the keys that act on it. X, Y or Z keeps the move to that axis of the object, a click or Enter places it, and Esc or a right click puts it back as if nothing happened. A placed move is one undo step. With nothing selected, or the pointer over a panel, the key only switches the tool, and the handles work as before. Typing a number while holding an object is not supported: type it in Properties instead.

A right click on an object, in the viewport or in the Scene list, selects it and opens its menu at the pointer: Frame, Duplicate, Hide, the three resets and Delete. They are the same rows as in **Edit**, with the same keys. A menu row starts with its icon when one fits and with an empty square when none does, so the labels line up. Dragging with the right button still pans. Alt takes back what the plain key does: G, R and S change a transform and Alt+G, Alt+R and Alt+S reset it, H hides the selection and Alt+H shows everything again, as one undo step.

## Settings

**Edit ▸ Settings** (Ctrl+,) opens Settings: the step and the angle a Shift drag snaps to, the size of the handles, the workspace Studio opens in, and whether the grid, the readout, the axis widget and the agent cursor show. They are kept in the browser (`localStorage`, key `crucible-studio-preferences`), not in the scene recipe, so a scene looks the same for everyone and each person keeps their own setup. **Reset** brings back the defaults. An app can pass `preferences` to `createStudio` to start from other values, `preferenceStorage: null` to keep nothing, and call `studio.setPreference(name, value)`.

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

`controller.gizmoHandles()` returns the pivot, the object's world axes (`basis`) and the screen points of each handle. `controller.selectionSilhouette()` returns the selected object's triangles on screen as a flat list of x, y pairs (six numbers a triangle), which the viewport fills and outlines; `controller.selectionOutline()` returns the hull polygon around it. Both return `null` when nothing is selected or part of the object is behind the camera. `controller.frameSelectionPose()` returns the camera that frames the selection without moving anything, and `controller.moveViewportCamera(patch)` moves the camera without an undo step.

## What Studio edits in the recipe

1. Viewport clicks and gizmo drags emit deterministic `set-node` updates on `translation`, `rotation` and `scale`, measured along the object's own axes.
2. Surface snap (`Snap` mode or Alt-click) raycasts against other scene parts and offsets the node along the surface normal.
3. Material and look controls update the active material, `environment` and `effects` sections directly.
4. Saved camera bookmarks read and write named shots in `recipe.timeline.shots`.
5. Every change exports cleanly with `exportRecipe()` so AI agents can continue from the same scene revision.
