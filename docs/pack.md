# Pack: a recipe as a runtime-only web bundle

`crucible pack` compiles a recipe (`format: "crucible.scene"`) in Node into a compact data file, so a web page loads the renderer and the data but not the recipe compiler. The page uses a `<crucible-scene>` element: it shows a poster picture first, then swaps in live 3D when the scene is ready.

This is slice 1 of #2178. It packs a still scene. Scroll, hover and click triggers, and baked lightmaps, come in later slices.

## Pack a scene

```sh
npx crucible pack scene.json --out dist/scene
```

It writes into `dist/scene`:

| File | What it holds |
| --- | --- |
| `scene.pack` | the compiled parts (geometry as typed arrays), camera, lighting, effects and the shader modules the scene needs |
| `crucible-scene.js` and its chunks | the runtime: the `<crucible-scene>` element and the renderer |
| `poster.webp` | the poster: rendered from the recipe's camera, or the picture you passed with `--poster` (WebP, PNG or JPEG) |
| `index.html` | a page that uses all of the above |

## The poster

Pack renders the poster itself: it opens the bundle it just wrote in headless Chrome, lets the live element draw the recipe's camera view and saves the canvas as `poster.webp`. The poster is the picture the live 3D settles on, and the element shows it at once, before the renderer has loaded.

| Flag | What it does |
| --- | --- |
| `--poster-size <w>x<h>` | the poster size in pixels, default `1280x720`, each side from 64 to 2560 |
| `--poster <picture>` | use a WebP, PNG or JPEG you rendered instead of rendering one |
| `--no-poster` | write no poster; the element shows a dark box until the 3D is ready |

Rendering needs Chrome (set `CHROME_PATH` to its executable when it is not installed in the usual place). Without Chrome, pack stops and says to pass `--poster` or `--no-poster`.

`--runtime <file>` names a built `crucible-scene.js` when the package has no `build/` folder, such as in a source checkout.

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
