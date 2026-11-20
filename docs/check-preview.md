# Check a preview before review

Every look preview, still or clip, goes through `scripts/check-preview.mjs` before anyone is asked to judge it. The script measures three faults that a person spots at once but a picture-by-picture read misses:

| Check | Fails when | Typical cause |
| --- | --- | --- |
| `exposure` | Highlights are clipped, the darkest values sit high (washed out), or the frame is far brighter or darker than a path-traced reference of the same scene and camera | Missing sky occlusion or ambient occlusion, wrong exposure or tone mapping |
| `shimmer` | Blocks of the picture change shape between frames instead of moving with the camera | Texture aliasing (mip bias, anisotropy, UV scale), thin geometry without enough samples |
| `near-plane` | A large featureless area fills a frame, or appears or vanishes from one frame to the next | The camera path starts in or passes through a wall |

With a reference it also prints the structural similarity, and fails on it only when `--min-similarity` is given.

## Run it

```sh
node scripts/check-preview.mjs preview.png --reference cook.png
node scripts/check-preview.mjs clip.mp4 --reference cook.png --at 1.5
```

- `--reference` is a Cook or Cycles still of the same scene and camera. Without one, exposure is judged on its own.
- `--at` is the time in seconds of the clip frame to compare with the reference; `--from` skips the start of a clip.
- `--frames` (48) is how many consecutive frames of a clip are read, and `--width` (640) is the size they are measured at.
- `--json` prints the measurements for a script.

PNG files are read directly. JPEG, WebP and clips need `ffmpeg` and `ffprobe` on the path.

Each check prints one line with `PASS` or `FAIL`, the measurements and a hint for each problem. The command exits 1 when a check fails and 2 when it cannot read its input.

```text
FAIL exposure: median 182.7, shadow 117.7, highlight 235, brightClippedPercent 0 | reference median 33.8, shadow 7.5, highlight 181, brightClippedPercent 0
  - the darkest 5% of pixels are still at 117.7 (limit 70): the frame is washed out, with no dark values
  - median 182.7 is 148.9 brighter than the reference 33.8 (limit 25)
```

## How the limits were set

The limits come from the realtime candidates rejected in #2755 and from clean controls made from Cook stills:

| Input | exposure | shimmer | near-plane |
| --- | --- | --- | --- |
| Monk realtime still against its Cook still, same camera | fail: median 218 against 34, darkest 5% at 190 | | fail: the frame is near-uniform white |
| Classroom realtime still against its Cook still, same camera | pass: median 115 against 123 | | pass |
| Monk arcade and push clips | fail: darkest 5% at 119 | pass: 0.2 to 0.4% | pass |
| Classroom truck clip | pass | fail: 2.2%, lower left (chairs) | fail: 27% featureless at frame 0 against 10% typical |
| Cook still panned and zoomed without minifying | | pass: 0 to 0.2% | pass |
| Cook still zoomed while minified with bilinear sampling (aliased on purpose) | | fail: 1.5% | |

The functions behind each check are in `scripts/preview-checks.mjs` and work on plain luminance planes; `tests/check-preview.test.js` covers them with small synthetic frames.
