// The compile side of a packed sky (docs/pack.md): the decoded HDR image of `environment.hdri`, sized for a page.
// Node and Studio (a browser) both import this module, so it reads no file; the page reads the result through src/scene-pack-environment.js.
import { agentEnvironmentMap } from './agent-look.js';

/**
 * Widest sky image one pack carries. The renderer prefilters a sky down to 1024 pixels wide for lighting, so a wider image
 * lights the scene the same; only a visible background would show the extra pixels. A 1024 by 512 sky is 2 MiB packed as RGBE.
 */
export const PACK_MAX_SKY_WIDTH = 1024;

function sourceTexel(map, column, row) {
  const clampedColumn = Math.min(column, map.width - 1);
  const clampedRow = Math.min(row, map.height - 1);
  return (clampedRow * map.width + clampedColumn) * map.channels;
}

// Each output pixel is the mean of up to four source pixels, so the total light of the sky stays the same.
function halved(map) {
  const width = Math.max(4, Math.ceil(map.width / 2));
  const height = Math.max(2, Math.ceil(map.height / 2));
  const data = new Float32Array(width * height * map.channels);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([across, down]) => sourceTexel(map, column * 2 + across, row * 2 + down));
      for (let channel = 0; channel < map.channels; channel++) {
        const sum = corners.reduce((total, corner) => total + map.data[corner + channel], 0);
        data[(row * width + column) * map.channels + channel] = sum / corners.length;
      }
    }
  }
  return Object.freeze({ ...map, width, height, data });
}

/** The environment map of a built scene whose recipe names an HDRI, halved until it fits the pack; undefined for any other scene. */
export function packedSkyOf(environment) {
  if (!environment.hdri) return undefined;
  let map = agentEnvironmentMap(environment);
  while (map.width > PACK_MAX_SKY_WIDTH) map = halved(map);
  return map;
}
