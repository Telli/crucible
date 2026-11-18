# Pack for the web

![The poster that crucible pack wrote for a kettle recipe](/previews/modeling.webp)

`crucible pack` compiles a recipe in Node into a compact data file, so a web page loads the renderer and the data but not the recipe compiler. The page uses a `<crucible-scene>` element: it shows a poster picture first, then swaps in live 3D when the scene is ready.

```sh
npx crucible pack scene.json --out dist/scene
```

Poster options, the element's attributes and what a pack does not carry yet: [Pack](/pack.md).
