// Pages that build a renderer from a scene file (file-scene.js, showcase.js) cannot ask the caller to import the view
// transform code, so they load it here when the file asks for a curve other than aces or for a look (#2764).

function namesDisplayChange(source) {
  if (!source) return false;
  const hasLook = Boolean(source.look);
  const hasCurve = Boolean(source.viewTransform) && source.viewTransform !== 'aces';
  return hasLook || hasCurve;
}

/** Whether renderer options (top level or their environment) pick a view transform other than aces or a look. */
export function rendererOptionsNeedViewTransform(rendererOptions) {
  return namesDisplayChange(rendererOptions) || namesDisplayChange(rendererOptions?.environment);
}

/** Load view-transform-shader.js before the renderer is built, when the options need it. Safe to call repeatedly. */
export async function loadViewTransformForRendererOptions(rendererOptions) {
  if (!rendererOptionsNeedViewTransform(rendererOptions)) return;
  await import('./view-transform-shader.js');
}
