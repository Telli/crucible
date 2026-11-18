# Web Studio

Crucible Web Studio lets designers and AI agents work on the same `crucible.scene` recipe in the browser. It adds zero bytes to the core library entry (`crucible`).

## Open the Studio page

Open `/studio.html` in the site or dev server. Drop a `scene.json` on the window, or click the file name at the top left and choose **Open**.

## The screen

The scene fills the window and the controls float on top of it.

| Where | What it does |
| --- | --- |
| Top left | The file name opens the file menu: open, save, the recipe JSON and the starting scenes. A green dot means Studio reloads the file when an agent edits it. |
| Top right | Work with an agent, keyboard shortcuts, and **Export** (PNG image, GLB model, web pack). |
| Left rail | Select, move, rotate, scale, snap to a surface, undo, redo, add an object or a light, show or hide the panels. |
| Scene card | Every object in the scene, an eye to hide each one, and the scene materials as swatches. |
| Inspector | Four tabs: object, material, look (lighting, sun, exposure, fog) and camera (views, lens, shots). |
| Bottom | Play, add a keyframe, scrub the time, jump to a saved shot. |

The selected object gets an outline. Below 820 px wide the two cards start closed so the scene keeps the screen; the panels button on the rail opens them.

## Move, rotate and scale

The handles follow the object, not the camera: the three axes are the object's own X, Y and Z, so a turned object moves along the way it faces.

- **Move** drags the object exactly as far as the pointer travels along the axis. Hold Shift to move in steps of 0.25 m.
- **Rotate** turns the object by the angle the pointer sweeps on the ring. Hold Shift to turn in steps of 15 degrees.
- **Scale** on an axis handle scales by how far you pull it: twice the distance doubles that axis. The centre handle scales all three.

One drag is one undo step, and undo leaves the viewport camera where you put it.

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
