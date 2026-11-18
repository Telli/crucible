// The view model of /tiers.html: turns the data that bench/tiers/make-tier-page-data.mjs writes into the rows the page draws.
// Pure functions, no DOM, so a test can check every figure the page would print.

const METRICS = [
  { id: 'time', name: 'Time', lowerIsBetter: true },
  { id: 'memory', name: 'Card memory', lowerIsBetter: true },
  { id: 'flip', name: 'Error against Cycles, 4,096 samples', lowerIsBetter: true },
];

function grouped(value, digits) {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Times keep three significant figures at most: 0.68 ms, 57.4 ms, 363 ms, 1.32 s.
function digitsFor(figure, metricId) {
  if (metricId !== 'time') return figure.digits;
  if (figure.median >= 100) return 0;
  return figure.median >= 10 ? 1 : 2;
}

function formatSpread(figure, unit, digits) {
  const middle = `${grouped(figure.median, digits)}${unit}`;
  if (figure.runs < 2 || figure.low === figure.high) return { value: middle, range: null };
  return { value: middle, range: `${grouped(figure.low, digits)} to ${grouped(figure.high, digits)}` };
}

function metricFigure(part, metricId) {
  if (metricId === 'time') return { figure: part.time, unit: ` ${part.time.unit}`, note: part.time.means };
  if (metricId === 'memory') return { figure: part.memoryMebibytes, unit: ' MiB', note: 'added on the card' };
  return { figure: part.flip, unit: '', note: 'FLIP, lower is better' };
}

function describePart(part, metricId, largest) {
  const { figure, unit, note } = metricFigure(part, metricId);
  return { label: part.label, ...formatSpread(figure, unit, digitsFor(figure, metricId)), note, share: largest > 0 ? figure.median / largest : 0 };
}

export function describeTier(data, tierId) {
  const tier = data.tiers.find(candidate => candidate.id === tierId);
  if (!tier) throw new Error(`Unknown tier "${tierId}"; pass one of ${data.tiers.map(candidate => candidate.id).join(', ')}`);
  if (tier.status === 'planned') return { id: tier.id, status: 'planned', issues: tier.issues, rows: [] };
  const rows = METRICS.map(metric => {
    const { crucible, blender } = tier;
    const largest = Math.max(metricFigure(crucible, metric.id).figure.median, metricFigure(blender, metric.id).figure.median);
    return { id: metric.id, name: metric.name, crucible: describePart(crucible, metric.id, largest), blender: describePart(blender, metric.id, largest) };
  });
  return { id: tier.id, status: 'measured', rows };
}

export function describeConditions(data) {
  const { card, blender, node, platform, date } = data.conditions;
  return {
    hardware: card,
    software: `${blender}, Node ${node.replace(/^v/, '')}, ${platform}`,
    size: `${data.width} by ${data.height}`,
    date,
    scene: data.scene,
  };
}
