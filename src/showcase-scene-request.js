// Reads the `scene` query of showcase.html. An unknown name still opens the first scene, and the notice says what was asked for.

/**
 * @param {string | null} requestedName the `scene` query value, or null when the page was opened without one
 * @param {string[]} sceneIds the scenes the page has, first one is the fallback
 * @returns {{ id: string, notice: string | null }}
 */
export function resolveRequestedScene(requestedName, sceneIds) {
  if (!Array.isArray(sceneIds) || sceneIds.length === 0) throw new Error('resolveRequestedScene needs a non-empty list of scene ids.');
  if (requestedName === null || requestedName === '') return { id: sceneIds[0], notice: null };
  if (sceneIds.includes(requestedName)) return { id: requestedName, notice: null };
  const available = sceneIds.join(', ');
  return { id: sceneIds[0], notice: `There is no scene "${requestedName}". Showing ${sceneIds[0]}. Scenes: ${available}.` };
}
