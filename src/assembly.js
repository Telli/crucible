// Components spread in their section's mounting plane, then lift off in ordered rows.
// The base matrices and shared geometry remain assembled and never change.
function sectionLayout(section) {
  const side = section.startsWith('Left ') ? -1 : 1;
  const family = section.replace(/^(Left|Right) /, '');
  const layouts = {
    'Structural frame': { axis: 1, sign: 1, spread: 0.9, tier: 0.14, lift: 0 },
    'Battery cassette': { axis: 1, sign: 1, spread: 1.6, tier: 0.14, lift: 0 },
    'Control electronics': { axis: 1, sign: 1, spread: 1.7, tier: 0.14, lift: 0.1 },
    'Differential drive': { axis: 2, sign: -1, spread: 1.2, tier: 0.14, lift: 0.55 },
    'Front compactor panel': { axis: 2, sign: 1, spread: 1, tier: 0.05, lift: 0.2 },
    'Rear service panel': { axis: 2, sign: -1, spread: 1, tier: 0.08, lift: 0.2 },
    'Roof panel': { axis: 1, sign: 1, spread: 1, tier: 0.18, lift: 0 },
    'body panel': { axis: 0, sign: side, spread: 1, tier: 0.12, lift: 0.4 },
    'track assembly': { axis: 0, sign: side, spread: 1.7, tier: 0.1, lift: 0.72 },
    'arm and claw': { axis: 0, sign: side, spread: 1.3, tier: 0.1, lift: 0.5 },
    'Neck linkage': { axis: 1, sign: 1, spread: 1.4, tier: 0.14, lift: 0 },
    'eye housing': { axis: 2, sign: -1, spread: 1.4, tier: 0.14, lift: 0.08 },
    'optical mechanism': { axis: 2, sign: 1, spread: 1.4, tier: 0.14, lift: 0.15 },
    'lens assembly': { axis: 2, sign: 1, spread: 1.8, tier: 0.14, lift: 0.1 },
  };
  const layout = layouts[family];
  if (!layout?.spread) throw new Error(`No detail layout for assembly section: ${section}`);
  return layout;
}

// Steel shoes and wide rubber pads need separate axial lanes; the wheel stack stays nearby.
const trackLanes = {
  'Caterpillar steel shoe': 0.18,
  'Caterpillar rubber traction pad': 0.65,
  'Track sprocket drum': 0.12,
  'Track exposed wheel disc': 0.49,
  'Track wheel rim': 0.58,
  'Track wheel hub': 0.72,
  'Track hub retaining bolt': 0.86,
  'Track wheel bolt': 1,
  'Track tension beam': 1.2,
};

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

/**
 * The axis-aligned world bounds of the parts at an assembly amount, as { minimum, maximum }: each part's matrix, then its
 * assemblyOffset. Used to frame the camera on the pose that is on screen.
 */
export function assemblyBounds(parts, amount = 0) {
  if (!Array.isArray(parts) || parts.length === 0) throw new TypeError('assemblyBounds expects a non-empty array of parts with geometry.positions and a matrix.');
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const positions = part.geometry?.positions;
    if (!positions || !part.matrix) throw new TypeError(`Part "${part.name}" needs geometry.positions and a matrix to be measured.`);
    const matrix = part.matrix;
    const offset = assemblyOffset(part, amount);
    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index];
      const y = positions[index + 1];
      const z = positions[index + 2];
      for (let axis = 0; axis < 3; axis++) {
        const value = matrix[axis] * x + matrix[axis + 4] * y + matrix[axis + 8] * z + matrix[axis + 12] + offset[axis];
        minimum[axis] = Math.min(minimum[axis], value);
        maximum[axis] = Math.max(maximum[axis], value);
      }
    }
  }
  return { minimum, maximum };
}

/**
 * The camera distance at which a box of `size` ([width, height], in view-plane units) fills `fill` of the shorter side of the
 * visible area, for a perspective camera with the given vertical field of view in radians and aspect ratio (width / height).
 */
export function distanceToFill(size, { verticalFov, aspect, fill = 0.8 }) {
  if (![verticalFov, aspect, fill, ...size].every(Number.isFinite) || verticalFov <= 0 || verticalFov >= Math.PI || aspect <= 0 || fill <= 0 || fill > 1) {
    throw new RangeError('distanceToFill needs a finite size, a verticalFov between 0 and PI, a positive aspect and a fill between 0 and 1.');
  }
  const halfHeight = Math.tan(verticalFov / 2);
  const halfWidth = halfHeight * aspect;
  return Math.max(size[0] / 2 / halfWidth, size[1] / 2 / halfHeight) / fill;
}

export function addDetailOffsets(parts) {
  const sections = new Map();
  for (const part of parts) {
    const section = part.assembly.section;
    if (!sections.has(section)) {
      sections.set(section, { minimum: [Infinity, Infinity, Infinity], maximum: [-Infinity, -Infinity, -Infinity], families: new Map(), layout: sectionLayout(section) });
    }
    const state = sections.get(section);
    for (let axis = 0; axis < 3; axis++) {
      state.minimum[axis] = Math.min(state.minimum[axis], part.matrix[12 + axis]);
      state.maximum[axis] = Math.max(state.maximum[axis], part.matrix[12 + axis]);
    }
  }
  return parts.map(part => {
    const state = sections.get(part.assembly.section);
    const { layout } = state;
    if (!state.families.has(part.name)) {
      state.families.set(part.name, { tier: state.families.size, count: 0 });
    }
    const family = state.families.get(part.name);
    const detailOffset = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      if (axis !== layout.axis) {
        const center = (state.minimum[axis] + state.maximum[axis]) / 2;
        detailOffset[axis] = (part.matrix[12 + axis] - center) * layout.spread;
      }
    }
    const lane = part.assembly.section.endsWith('track assembly') ? trackLanes[part.name] : undefined;
    detailOffset[layout.axis] = layout.sign * ((Number.isFinite(lane) ? lane : 0.12 + family.tier * layout.tier) + family.count * 0.018);
    detailOffset[1] += layout.lift;
    family.count++;
    return { ...part, assembly: { ...part.assembly, detailOffset } };
  });
}
