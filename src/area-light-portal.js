// A portal area light (#1948) marks a window: it emits nothing and only lets sky light in. Everything that sums or traces the light a
// panel gives off (light bake, object reflection probes, the room bounce estimate, the strongest-light list) works on this list.

/** The area lights that give off light of their own: the list without its portals. Keeps the order. */
export function emittingAreaLights(areaLights) {
  return (areaLights ?? []).filter(light => light.portal !== true);
}
