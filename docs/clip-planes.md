# Clip planes

A clip plane cuts a model open. Everything on the far side of the plane disappears, and so does its shadow, so a section looks like a real cut part: lit, shadowed, and ready to film as a slice, a cutaway or an x-ray reveal.

```js
const renderer = new CrucibleRenderer(canvas, parts, {
  clipPlanes: [], // turns the feature on; the planes can come later
});

// Keep what is at or below y = 1.2 and cut the rest. Call it before any render to move the cut.
renderer.setClipPlanes([{ normal: [0, -1, 0], constant: 1.2 }]);
renderer.render(frame);
```

## The plane

A plane is `{ normal: [x, y, z], constant }`. A point `p` stays when `dot(normal, p) + constant` is 0 or more, so the normal points toward what you keep. The normal does not need to be a unit vector, only not zero. With several planes a point must pass all of them, so two planes cut a corner out of the model.

| Plane | Keeps |
| --- | --- |
| `{ normal: [0, -1, 0], constant: 1.2 }` | everything at or below y = 1.2 |
| `{ normal: [1, 0, 0], constant: 0 }` | the right half, x of 0 or more |

A draw takes at most 4 planes. More than that, a normal of length 0 or a number that is not finite throws an error that says what to pass.

## On the renderer or on a part

`setClipPlanes(planes)` cuts every part that has no planes of its own. `[]` cuts nothing.

A part with its own `clipPlanes` array ignores the renderer's and uses that array. An empty array exempts the part, for a floor that must stay whole while the model above it is cut. Edit the array in place to animate the part's cut; giving the part a different array later throws, because the renderer batches parts by their array.

```js
const floor = { name: 'floor', geometry, matrix, material, clipPlanes: [] };
```

## Cost

Without `clipPlanes` in the options and without a part that has them, the shaders have no plane code and the pictures are unchanged. With it on, each fragment tests up to 4 planes. A plane that moves redraws the shadow map on the next frame.

The renderer needs the feature when it starts, because the shadow program is built once. `setClipPlanes` on a renderer without it throws and says to pass `clipPlanes: []`, and so does a part with `clipPlanes` that arrives later through `replaceParts`.

## What it does not do

- It does not fill the cut face. Nothing closes the opening, so a hollow model shows its inside.
- The liquid and foam pass draws its own program and is not cut.
- There is no MCP tool for it yet.
