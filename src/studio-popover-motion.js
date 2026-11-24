// How a Studio menu grows out of its trigger: the corner it scales from and the few pixels it starts displaced toward the trigger.
const SHIFT_DISTANCE = '4px';

/** The two custom properties the popover styles read, from the way the menu opened. */
export function popoverOpeningStyle({ beside, opensLeftward, opensUpward }) {
  const originX = opensLeftward ? '100%' : '0';
  const originY = opensUpward ? '100%' : '0';
  let shift = opensUpward ? `0 ${SHIFT_DISTANCE}` : `0 -${SHIFT_DISTANCE}`;
  if (beside) {
    shift = opensLeftward ? `${SHIFT_DISTANCE} 0` : `-${SHIFT_DISTANCE} 0`;
  }
  return { origin: `${originX} ${originY}`, shift };
}

/** The longest duration in a computed `transition-duration` list, in milliseconds; 0 when the value is missing or has none. */
export function longestTransitionMilliseconds(transitionDuration) {
  let longest = 0;
  for (const part of String(transitionDuration ?? '').split(',')) {
    const trimmed = part.trim();
    const amount = Number.parseFloat(trimmed);
    if (!Number.isFinite(amount)) {
      continue;
    }
    longest = Math.max(longest, trimmed.endsWith('ms') ? amount : amount * 1000);
  }
  return longest;
}
