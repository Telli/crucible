# Web Studio

Crucible Web Studio lets designers and AI agents work on the same `crucible.scene` recipe in the browser. It adds zero bytes to the core library entry (`crucible`).

## Open the Studio page

Open `/studio.html` in the site or dev server. Load any saved JSON recipe file through the **Import JSON** button.

## Mount the Studio in an app

Import `createStudio` from `crucible/addons/studio` and pass a container element and a scene recipe.

```js
import { createStudio } from 'crucible/addons/studio';

const studio = createStudio(document.querySelector('#studio-root'), {
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

## What Studio edits in the recipe

1. Viewport clicks and gizmo drags emit deterministic `set-node` updates on `translation`, `rotation` and `scale`.
2. Surface snap (`Snap` mode or Alt-click) raycasts against other scene parts and offsets the node along the surface normal.
3. Material and look controls update the active material, `environment` and `effects` sections directly.
4. Saved camera bookmarks read and write named shots in `recipe.timeline.shots`.
5. Every change exports cleanly with `exportRecipe()` so AI agents can continue from the same scene revision.
