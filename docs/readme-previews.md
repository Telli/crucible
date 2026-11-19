# Rebuild the README pictures

The eight pictures at the top of the README (`public/previews/*.webp`) come from one command, so they can be refreshed whenever the look changes.

```sh
node scripts/render-readme-previews.mjs                       # all eight, written to public/previews
node scripts/render-readme-previews.mjs wall-e cook-monk      # only these
node scripts/render-readme-previews.mjs --preview artifacts/readme-previews --pairs artifacts/readme-pairs
```

`--preview <folder>` writes small, low-quality renders there instead of `public/previews`. `--pairs <folder>` also writes `readme-<name>-pair.png` for a still, or `.mp4` for a clip, with the published picture on the left and the new one on the right. `--help` lists the rest.

What each picture is built from (the table is `scripts/readme-previews-plan.mjs`):

| Picture | Source | Tool |
|---|---|---|
| `showcase-airport`, `showcase-port` | `public/showcase/<name>/scene.json` | `scripts/render-media.mjs` |
| `wall-e` | the object studio page | `scripts/render-media.mjs` |
| `feature-clockwork` | the motion page | `scripts/render-media.mjs`, then FFmpeg to an animated WebP |
| `feature-flicker-fixed` | `scripts/readme-previews/flicker-fixed.recipe.mjs` | MCP render job, then FFmpeg |
| `feature-cook-dof` | `scripts/readme-previews/cook-dof.recipe.mjs` | MCP render job on Cook, then FFmpeg |
| `hero-classroom`, `cook-monk` | Blender demo files | `scripts/blender-demo-to-glb.py`, then `scripts/render-file-native.mjs` on Cook |

- A clip keeps the frame count of the file it replaces and stays under that file's size: the encoder lowers the WebP quality until it fits, and stops with an error when even the lowest quality is too big.
- The three Cook pictures need the Cook native addon (`npm run cook:build`, or `node node_modules/@codepawlhq/cook/fetch-addon.mjs` for a prebuilt one) and a GPU with Vulkan ray queries. `--skip-cook` leaves them out.
- The two Blender demo scenes are downloaded on first use into `~/.cache/crucible-readme-previews` (change it with `--cache`), never into the repository, and converted with Blender 5.3 (`BLENDER=<path>`, or `blender` on the PATH). Classroom is by Christophe Seux (CC0); Lone Monk is by Carlo Bergonzini (CC-BY). The cameras are in the plan table: Classroom uses the Blender camera, Lone Monk the Blender camera moved 2 m forward.
- The MCP render needs `npm run build` and `node scripts/build-mcp.mjs` first.
- Run it as a light GPU job: `bash ~/.agents/tools/gpu-lock.sh node scripts/render-readme-previews.mjs ...`.
