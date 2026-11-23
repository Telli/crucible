// The mark Studio shows while an edit's light bake is still running (#3052): the edit is on screen, its light is the last one
// (or none) until the bake lands. It sits on the island surface under the status pill and leads with the light icon.

const BAKE_MARK_LABEL = 'Baking light';

/**
 * Returns `{ element, show(pending) }`. `show` changes the mark only when `pending` changes, so a screen reader hears the label
 * once when the bake starts and not on every slice of it.
 */
export function createBakeMark({ documentReference, createIcon }) {
  const label = documentReference.createElement('span');
  const element = documentReference.createElement('div');
  element.className = 'crucible-studio-island crucible-studio-bake-mark';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.hidden = true;
  element.append(createIcon('sun'), label);

  let shown = false;

  function show(pending) {
    if (pending === shown) {
      return;
    }
    shown = pending;
    label.textContent = pending ? BAKE_MARK_LABEL : '';
    element.hidden = !pending;
  }

  return { element, show };
}
