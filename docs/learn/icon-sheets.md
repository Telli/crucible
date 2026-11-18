# Icon sheets

![A sketch breakdown of a boat: shaded, outline, hatching and the final icon side by side](/docs-media/icon-sketch-breakdown.png "One breakdown strip: shaded, outline, hatching, final.")

One call turns a folder of 3D models into matching 2D icons: an inventory sheet, an asset browser or a set of docs pictures. It is available from version `0.22.0`. The sketch style draws every model as ink and pencil hatching, and the strip above shows how: the shaded frame, the ink outline, the hatching that follows the light, then the finished icon.

## The call

Ask an MCP server started with `--assets <folder>` for an icon job. The scene you submit it with is not drawn, so an empty one will do.

```json
{ "kind": "icons", "items": ["boat.glb", "robot.glb", "chair.glb"], "size": 128, "style": "sketch", "breakdown": true, "seed": 1 }
```

Each icon is a transparent square PNG with the model framed to fill it. `atlas.png` packs them in a grid and `icons.json` says where each one sits. `angles: 4` or `8` draws every model from that many sides in a row of the atlas, which makes a turnaround sheet. The same items, settings and seed give the same files. [Render jobs](https://github.com/codepawl/crucible/blob/main/docs/agent-render-jobs.md) lists every field.

## Three styles

The same nine models in each style, at 128 px. `clean` is the shaded render, `toon` adds outlines and light bands, and `sketch` is ink and pencil.

![Nine models as shaded clean icons in a three by three grid](/docs-media/icon-sheet-clean.png "style: clean")

![Nine models as toon icons with outlines and light bands](/docs-media/icon-sheet-toon.png "style: toon")

![Nine models as sketch icons with an ink outline and pencil hatching](/docs-media/icon-sheet-sketch.png "style: sketch")

## Sketch settings

Sketch takes four knobs under `sketch`, and every one is bounded: `inkColor` and `paperColor` as `#rrggbb`, `hatchDensity` from 0.5 to 2 and `jitter` from 0 to 1, which wobbles the lines. `seed` picks the wobble. Hatching is laid out in whole pixels, so it stays a pattern of lines at 64 px instead of turning into grey.

## A turnaround

`angles: 8` gives every model a row of eight views, each 45 degrees apart, at one scale per model. Here are three models.

![One model drawn from eight sides in a row of sketch icons](/docs-media/icon-sheet-turnaround.png "angles: 8")
