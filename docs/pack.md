# Pack: a recipe as a runtime-only web bundle

`crucible pack` compiles a recipe (`format: "crucible.scene"`) in Node into a compact data file, so a web page loads the renderer and the data but not the recipe compiler. The page uses a `<crucible-scene>` element: it shows a poster picture first, then swaps in live 3D when the scene is ready.

This is slice 1 of #2178. It packs a still scene. Triggers are below; baked lightmaps come in a later slice.

## Pack a scene

```sh
npx crucible pack scene.json --out dist/scene --poster shot.webp
```

It writes into `dist/scene`:

| File | What it holds |
| --- | --- |
| `scene.pack` | the compiled parts (geometry as typed arrays), camera, lighting, effects and the shader modules the scene needs |
| `crucible-scene.js` and its chunks | the runtime: the `<crucible-scene>` element and the renderer |
| `poster.webp` | the picture you passed with `--poster` (WebP, PNG or JPEG) |
| `index.html` | a page that uses all of the above |

`--poster` copies a picture you rendered. Pack does not render one itself yet. Without it the element shows a dark box until the 3D is ready. `--runtime <file>` names a built `crucible-scene.js` when the package has no `build/` folder, such as in a source checkout.

Packing the same recipe twice writes the same `scene.pack` bytes.

## The element

```html
<script type="module" src="https://example.com/scene/crucible-scene.js"></script>
<crucible-scene src="https://example.com/scene/scene.pack" poster="https://example.com/scene/poster.webp" style="height: 480px"></crucible-scene>
```

- The poster draws at once. The element then loads the pack and the renderer, draws the scene and fades the poster out.
- The `state` attribute is `loading`, `live` or `error`. The element fires `crucible-scene-ready` or `crucible-scene-error` (with `detail.message`). After an error the poster stays.
- Changing `src` or `poster` reloads it. It draws again when it changes size.

`crucible-scene.js` imports no `agent-scene` module. `tests/scene-pack.test.js` checks the import graph.

## What a pack refuses

Pack names the recipe field and what to change. For now it refuses `motion`, `timeline`, `physics`, `cloth`, `particles`, `game`, `postPasses`, `armatures`, `environment.sky`, `environment.hdri`, cascaded shadows, area lights, line art, material snippets and procedural material patterns. Scenes light with `environment.setup`. The automatic floor is not drawn: put a floor in the recipe.

## What it costs

Measured on `public/recipes/view-transform.json` (a lamp, six parts), Chrome, gzip of every file the page downloaded, with the same lighting and the same still:

| | Recipe build (compiler + renderer + recipe) | Packed bundle |
| --- | --- | --- |
| JavaScript | 232,047 B | 113,960 B |
| Data | the recipe JSON, inside the JavaScript | `scene.pack`, 114,681 B |
| Total | 232,182 B | 228,641 B |

The JavaScript halves. The data does not shrink for this scene, because the baked reflection probes of its two metal parts are 196 KB before gzip. A scene without baked probes pays much less data.

## Triggers

Three attributes move the camera from the page, with no script. The element draws only while a trigger is moving the camera, and goes back to sleeping when it settles.

```html
<crucible-scene src="https://example.com/scene/scene.pack" poster="https://example.com/scene/poster.webp" scroll="orbit 0 90, dolly 1 0.6" hover-tilt="6" view="wide">
  <script type="application/json">{ "wide": {}, "close": { "orbit": 40, "elevation": 10, "dolly": 0.5 } }</script>
</crucible-scene>
```

| Attribute | What it does |
| --- | --- |
| `scroll="orbit 0 90"` | Scrubs the camera with the element's pass through the viewport: the first number is the value when its top edge enters at the bottom, the second when its bottom edge leaves at the top. Kinds: `orbit` (degrees around the up axis), `elevation` (degrees, kept under 85) and `dolly` (distance scale, 0.1 to 10). Join kinds with commas. The scroll listener is attached only while the element is on screen. |
| `hover-tilt="6"` | Leans the camera up to 6 degrees (at most 30) toward the pointer, and eases back when it leaves. Off under `prefers-reduced-motion: reduce`. |
| `view="close"` | Moves the camera to a named view with a short ease. Views are declared in a `<script type="application/json">` child as `orbit`, `elevation` and `dolly` offsets from the scene camera. Remove the attribute to go back. The name is `view`, not `state`, because `state` already reports `loading`, `live` or `error`. Under reduced motion the camera jumps instead of easing. |

The three add up: scroll plus tilt plus the named view. A wrong attribute or an undeclared view name fires `crucible-scene-error` with what to write instead and is ignored; the scene stays `live`. Views read from the pack itself are not supported yet.
