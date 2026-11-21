// The picture half of scene_review `checks: "realism"`: reads each shot of the review grid and warns about a texture
// that repeats in a grid. The material checks need no picture and live in src/realism-checks.js.
import { decodePng } from './agent-icon-png.mjs';
import { cellPlane, detectTiling } from './review-tiling.mjs';
import { tilingDiagnostic } from '../src/realism-checks.js';
import { REVIEW_LIMITS } from './agent-review.mjs';

/** One tiling warning per shot of the review grid (base64 PNG) whose picture repeats. Never throws: an unreadable grid gives none. */
export function reviewTilingFindings(gridBase64, settings) {
  let grid;
  try { grid = decodePng(Buffer.from(gridBase64, 'base64')); }
  catch { return []; }
  const findings = [];
  for (const [index, shot] of settings.shots.entries()) {
    const cell = { x: (index % settings.columns) * settings.width, y: Math.floor(index / settings.columns) * (settings.height + REVIEW_LIMITS.labelHeight) + REVIEW_LIMITS.labelHeight, cellWidth: settings.width, cellHeight: settings.height };
    if (cell.x + cell.cellWidth > grid.width || cell.y + cell.cellHeight > grid.height) continue;
    const tiling = detectTiling(cellPlane(grid, cell));
    if (tiling) findings.push(tilingDiagnostic(shot.label, tiling));
  }
  return findings;
}
