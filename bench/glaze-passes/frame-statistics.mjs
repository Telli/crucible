// Pure helpers shared by the Glaze and three.js harnesses, so every mode reduces its frame times the same way (#2144).

export function median(values) {
  if (values.length === 0) throw new RangeError('median needs at least one value; pass the measured frame times.');
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

function roundToMicroseconds(value) {
  return Number(value.toFixed(3));
}

// Median and range of one list of frame times, in the unit the caller measured.
export function summarize(values) {
  return {
    median: roundToMicroseconds(median(values)),
    min: roundToMicroseconds(Math.min(...values)),
    max: roundToMicroseconds(Math.max(...values)),
    count: values.length,
  };
}

// Drops the first `warmupFrames` entries, which are the warm-up, then summarizes the rest.
export function summarizeAfterWarmup(values, warmupFrames) {
  return summarize(values.slice(warmupFrames));
}

// The items in a different order each round (round 0 keeps the order, round 1 starts from the second item), so a card whose
// load drifts does not favour the item that always runs first.
export function rotatedOrder(items, round) {
  const offset = round % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

// Median of each consecutive block of `blockSize` frames: shows whether the first frames are slower than the later ones.
export function blockMedians(values, blockSize) {
  const blocks = [];
  for (let start = 0; start < values.length; start += blockSize) {
    const block = values.slice(start, start + blockSize);
    if (block.length === blockSize) blocks.push(roundToMicroseconds(median(block)));
  }
  return blocks;
}

// Median of the per-round medians, with the lowest and highest round, for a series of rounds on a shared card.
export function summarizeRounds(roundMedians) {
  return { median: roundToMicroseconds(median(roundMedians)), min: roundToMicroseconds(Math.min(...roundMedians)), max: roundToMicroseconds(Math.max(...roundMedians)), rounds: roundMedians.length };
}
