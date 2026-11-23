# Fit the look to references

`scene_fit_look` finds the look parameters that make labelled regions of the scene match the colours of reference frames.
You say where the regions are and what colour each should be. The tool renders candidate looks in the preview, measures the same regions, and returns the `scene_apply` operations that carry the best look it found.

## What goes in

- `shots`: one to four views, each with a `name` and an optional `camera` (`eye`, `target`, `up`, `fov` or `focalLength`). A shot without a camera uses the scene camera.
- `regions`: one to 32 boxes. Each has a `label`, the `shot` it is measured in, a `rect` `[x0, y0, x1, y1]` in 0..1 image coordinates (y down), up to four `exclude` boxes inside it, and `lab`, the OKLab mean `[L, a, b]` of that region in the reference frame. `holdout: true` reports a region without fitting it, so you can see how well the fit carries over to a frame it never saw.
- `parameters`: one to eight names with optional `min`, `max` and `start`. Without `start` the scene's own value is used.
- `maxIterations` (1 to 8, default 6) and `width` and `height` of the measuring renders (64 to 512, default 256 by 160).

The tool reads no image files and no URLs. Measure the reference regions yourself and pass the means: OKLab is the Ottosson 2020 transform of linear sRGB, and a region's mean is taken over the middle 60 percent of its pixels by lightness, so a stray speck does not move it. The tool measures the render the same way.

## Parameters

| Stage | Names | Notes |
|---|---|---|
| physical | `sunElevation`, `sunRotation`, `turbidity`, `aerialPerspective`, `ozone`, `groundAlbedo` | Need a physical `environment.sky`; the tool refuses them on a scene without one and says which edit adds it. |
| physical | `environmentIntensity`, `keyIntensity`, `ambientIntensity`, `fogDensity` | Fields of `environment`. |
| grade | `exposure`, `saturation`, `contrast`, `temperature` | Fields of `effects`. A prior pulls each toward its neutral value, so the grade only moves as far as the pictures need. |

Each name has a hard range; `min` and `max` may narrow it, never widen it. Physical parameters fit first, with the grade held where it started; then the grade fits with the physical values held. Narrow the bounds to what the reference allows: parameters that lighten the frame in the same way are not told apart by region colours alone, so fit two or three at once, not all eight.

## What comes back

- `operations`: a `set-environment` and a `set-effects` operation to pass to `scene_apply`. A sky parameter writes the whole sky object (the scene's sky with the fitted fields over it).
- `values` and `startValues`.
- `error.before` and `error.after`: the mean OKLab delta E over the fitted regions (and `holdoutMeanDeltaE` when some are held out), plus `error.regions` with each region's delta E before and after.
- `history`: one entry per accepted step with its cost and values.
- `evaluations` and `renders`, and `stoppedBy` (`maximumEvaluations` or `deadline`) when a limit cut the fit short. The result is still the best look found.
- `revision`: the scene's revision after the fit.

## What it changes

The fit draws every candidate on the open scene and puts the scene's recipe back at the end, even when a render fails, so the look, camera and nodes are as you left them. The revision counter does advance, so pass the returned `revision` as `expectedRevision` to the next edit. Nothing is applied for you: look at the result with `scene_look` after applying the operations.

## Limits

At most 100 evaluations (one render per shot each) and 50 seconds, 32 regions, 8 parameters, 4 shots. The fit holds the preview like `scene_look` does, so other calls wait for it. Imported asset scenes are not supported; the tool needs a procedural recipe.

The solver is bounded Levenberg-Marquardt on parameters scaled to 0..1 by their bounds, with a finite-difference Jacobian (one evaluation per free parameter) and Huber loss on each residual, so one badly placed region does not pull the whole look. It lives in `src/look-fit-solver.js` with the render injected, so a test can run it against a formula.
