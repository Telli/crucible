// Each part keeps its assembled matrix; its explode offset and detailOffset are added by the shader, and an exporter can write the same pose with assemblyOffset.
export function assemblyOffset(part, amount = 0) {
  if (!Number.isFinite(amount)) throw new TypeError('Assembly amount must be finite');
  const progress = Math.max(0, Math.min(1, amount));
  if (progress === 0) return [0, 0, 0];
  const detailProgress = Math.max(0, Math.min(1, (progress - 0.3) / 0.7));
  const detailAmount = detailProgress * detailProgress * (3 - 2 * detailProgress);
  const offset = part.assembly?.offset ?? [0, 0, 0];
  const detailOffset = part.assembly?.detailOffset ?? [0, 0, 0];
  return offset.map((value, axis) => value * progress + detailOffset[axis] * detailAmount);
}
