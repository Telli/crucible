// The spot light cone angle is in radians while the camera fov is in degrees, so an agent sends degrees and reads a bare
// range error. These words name the unit and, for a value that only makes sense as degrees, give the conversion.
export const MINIMUM_SPOT_ANGLE = 0.01;
export const MAXIMUM_SPOT_ANGLE = Math.PI / 2 - 0.01;

const RADIANS_PER_DEGREE = Math.PI / 180;

function shortNumber(value) {
  return String(Number(value.toPrecision(3)));
}

// What a spot `angle` accepts, and for a value above pi the radians value it would be if it were degrees.
export function spotAngleExpectation(received) {
  const range = `the outer half angle of the cone in radians, from ${MINIMUM_SPOT_ANGLE} to ${shortNumber(MAXIMUM_SPOT_ANGLE)} (just under pi/2), such as 0.785 for 45 degrees`;
  if (typeof received === 'number' && Number.isFinite(received) && received > Math.PI) {
    return `${range}; ${received} looks like degrees, and ${received} degrees is ${shortNumber(received * RADIANS_PER_DEGREE)} radians`;
  }
  return range;
}
