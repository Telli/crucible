/** Read a numeric URL parameter; a missing, empty, non-numeric or out-of-range value gives the fallback so the page still opens. */
export function readQueryNumber(parameters, name, fallback, { minimum = -Infinity, integer = false } = {}) {
  const text = parameters.get(name)?.trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) return fallback;
  return value;
}
