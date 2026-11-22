import { invalidField } from './field-error.js';

// The channel views of scene_look. Each one draws a render pass (RENDER_PASS_MODES in render-passes.js) into the preview
// instead of the lit image; beauty is the lit image and has no pass. This module stays small because the MCP server bundles it.
export const LOOK_VIEW_PASSES = Object.freeze({
  beauty: null,
  albedo: 'albedo',
  normal: 'normal',
  roughness: 'roughness',
  metallic: 'metallic',
  ao: 'ao',
  lighting: 'lighting',
});

export const LOOK_VIEW_NAMES = Object.freeze(Object.keys(LOOK_VIEW_PASSES));

/** The view name to draw: beauty when none is given, or an error that lists the valid names. */
export function resolveLookView(view) {
  if (view === undefined || view === null) return 'beauty';
  if (typeof view !== 'string' || !Object.hasOwn(LOOK_VIEW_PASSES, view)) {
    throw invalidField('view', view, `one of ${LOOK_VIEW_NAMES.join(', ')}`);
  }
  return view;
}
