// Least-squares fit of look parameters to reference colour measurements (scene_fit_look).
//
// Labelled regions of a render are paired with the OKLab means of the same regions in reference frames, and the solver finds
// the parameters that bring them together. Rendering is injected (`render(values) -> { shotName: image }`), so the solver knows
// nothing about the engine: the MCP runtime renders through the preview, a test renders a formula.
//
// Solver: bounded Levenberg-Marquardt on parameters normalised to 0..1 by their bounds, a forward-difference Jacobian (one
// render per free parameter), Huber loss on each residual, and a Tikhonov prior that pulls a parameter toward its neutral value.
// Parameters fit in stages (physical first, grade after); the parameters of the other stages stay where the last stage left them.

import { measureRegion } from './look-fit-color.js';

export const LAB_CHANNEL_WEIGHTS = Object.freeze([1, 2, 2]);
const DEFAULT_HUBER = 0.08;
const DEFAULT_STEP = 0.05;
const STEP_ATTEMPTS = 4;
const MINIMUM_DAMPING = 1e-4;

/** Huber loss written as a residual transform: squares match r^2 below `huber` and grow linearly above it. */
function robustResidual(value, huber) {
  const size = Math.abs(value);
  if (size <= huber) return value;
  return Math.sign(value) * Math.sqrt(2 * huber * size - huber * huber);
}

function sumOfSquares(rows) {
  return rows.reduce((sum, row) => sum + row.value * row.value, 0);
}

/** Solve (JtJ + damping * diag(JtJ)) step = -Jt r by Gaussian elimination with partial pivoting. */
function solveDampedStep(jacobian, residuals, damping) {
  const size = jacobian[0].length;
  const matrix = Array.from({ length: size }, () => new Array(size + 1).fill(0));
  for (let row = 0; row < jacobian.length; row++) {
    for (let first = 0; first < size; first++) {
      matrix[first][size] -= jacobian[row][first] * residuals[row];
      for (let second = 0; second < size; second++) matrix[first][second] += jacobian[row][first] * jacobian[row][second];
    }
  }
  for (let index = 0; index < size; index++) matrix[index][index] += damping * Math.max(matrix[index][index], 1e-6);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    for (let row = column + 1; row < size; row++) {
      const factor = matrix[row][column] / matrix[column][column];
      for (let entry = column; entry <= size; entry++) matrix[row][entry] -= factor * matrix[column][entry];
    }
  }
  const step = new Array(size).fill(0);
  for (let row = size - 1; row >= 0; row--) {
    let sum = matrix[row][size];
    for (let column = row + 1; column < size; column++) sum -= matrix[row][column] * step[column];
    step[row] = sum / matrix[row][row];
  }
  return step;
}

/** Error per region as OKLab delta E (unweighted), lightness delta and chroma delta, for a set of measured regions. */
export function regionErrors(regions, measured) {
  return regions.map(region => {
    const rendered = measured[region.label].lab;
    const delta = rendered.map((value, channel) => value - region.lab[channel]);
    return {
      label: region.label,
      shot: region.shot,
      holdout: Boolean(region.holdout),
      target: region.lab,
      rendered,
      deltaE: Math.hypot(...delta),
      deltaLightness: delta[0],
      deltaChroma: Math.hypot(rendered[1], rendered[2]) - Math.hypot(region.lab[1], region.lab[2]),
    };
  });
}

/** Mean OKLab delta E of a list of region errors, or null for an empty list. */
export function meanDeltaE(errors) {
  return errors.length ? errors.reduce((sum, row) => sum + row.deltaE, 0) / errors.length : null;
}

/**
 * parameters: [{ name, stage, start, min, max, step?, prior?: { value, weight } }]
 * regions: [{ label, shot, rect, exclude?, lab, holdout? }]; holdout regions are reported but never fitted.
 * render(values, { expired }) may return null when expired() turns true between shots: the evaluation is dropped and the fit
 * stops with stoppedBy 'deadline'. The first evaluation never expires, so a result always exists.
 * Returns { values, history, before, after, evaluations, stoppedBy }.
 */
export async function fitLook({
  parameters, regions, render, huber = DEFAULT_HUBER, maximumIterations = 6, minimumGain = 0.01,
  maximumEvaluations = Infinity, deadlineAt = Infinity, now = Date.now,
}) {
  const training = regions.filter(region => !region.holdout);
  const shotNames = [...new Set(regions.map(region => region.shot))];
  let evaluations = 0;
  let stoppedBy = null;

  function budgetLeft() {
    if (evaluations >= maximumEvaluations) stoppedBy ??= 'maximumEvaluations';
    else if (now() >= deadlineAt) stoppedBy ??= 'deadline';
    return stoppedBy === null;
  }

  const toValues = vector => Object.fromEntries(parameters.map((parameter, index) => [parameter.name, parameter.min + vector[index] * (parameter.max - parameter.min)]));
  const toVector = values => parameters.map(parameter => (values[parameter.name] - parameter.min) / (parameter.max - parameter.min));

  async function measureAll(values) {
    const images = await render(values, { expired: () => evaluations > 1 && now() >= deadlineAt });
    if (images === null) return null;
    const measured = {};
    for (const shot of shotNames) {
      if (!images[shot]) throw new Error(`render() returned no image for shot ${shot}`);
    }
    for (const region of regions) measured[region.label] = measureRegion(images[region.shot], region);
    return measured;
  }

  function priorRows(vector) {
    return parameters.flatMap((parameter, index) => {
      if (!parameter.prior) return [];
      const target = (parameter.prior.value - parameter.min) / (parameter.max - parameter.min);
      return [{ value: parameter.prior.weight * (vector[index] - target) }];
    });
  }

  async function evaluate(vector) {
    evaluations += 1;
    const values = toValues(vector);
    const measured = await measureAll(values);
    if (measured === null) {
      evaluations -= 1;
      stoppedBy ??= 'deadline';
      return null;
    }
    const data = [];
    for (const region of training) {
      for (let channel = 0; channel < 3; channel++) {
        data.push({ value: robustResidual(LAB_CHANNEL_WEIGHTS[channel] * (measured[region.label].lab[channel] - region.lab[channel]), huber) });
      }
    }
    const prior = priorRows(vector);
    return { vector, values, measured, rows: [...data, ...prior], cost: sumOfSquares(data) + sumOfSquares(prior) };
  }

  async function probeColumn(current, index) {
    const step = parameters[index].step ?? DEFAULT_STEP;
    const direction = current.vector[index] + step <= 1 ? 1 : -1;
    const probe = [...current.vector];
    probe[index] += direction * step;
    const probed = await evaluate(probe);
    if (probed === null) return null;
    return probed.rows.map((row, rowIndex) => (row.value - current.rows[rowIndex].value) / (direction * step));
  }

  async function fitStage(startEvaluation, freeIndices, history, stage) {
    let current = startEvaluation;
    let damping = 1e-2;
    for (let iteration = 1; iteration <= maximumIterations; iteration++) {
      const columns = [];
      for (const index of freeIndices) {
        if (!budgetLeft()) return current;
        const column = await probeColumn(current, index);
        if (column === null) return current;
        columns.push(column);
      }
      const jacobian = current.rows.map((_, row) => columns.map(column => column[row]));
      const residuals = current.rows.map(row => row.value);
      let accepted = null;
      for (let attempt = 0; attempt < STEP_ATTEMPTS && !accepted; attempt++) {
        if (!budgetLeft()) return current;
        const delta = solveDampedStep(jacobian, residuals, damping);
        const candidate = [...current.vector];
        freeIndices.forEach((index, column) => {
          candidate[index] = Math.min(1, Math.max(0, candidate[index] + delta[column]));
        });
        const trial = await evaluate(candidate);
        if (trial === null) return current;
        if (trial.cost < current.cost) {
          accepted = trial;
          damping = Math.max(MINIMUM_DAMPING, damping / 3);
        } else {
          damping *= 4;
        }
      }
      if (!accepted) break;
      const gain = (current.cost - accepted.cost) / current.cost;
      current = accepted;
      history.push({ stage, iteration, cost: current.cost, values: current.values });
      if (gain < minimumGain) break;
    }
    return current;
  }

  const startVector = toVector(Object.fromEntries(parameters.map(parameter => [parameter.name, parameter.start])));
  const first = await evaluate(startVector);
  const history = [{ stage: 'start', iteration: 0, cost: first.cost, values: first.values }];
  let current = first;
  for (const stage of ['physical', 'grade']) {
    const freeIndices = parameters.flatMap((parameter, index) => (parameter.stage === stage ? [index] : []));
    if (freeIndices.length === 0 || !budgetLeft()) continue;
    current = await fitStage(current, freeIndices, history, stage);
  }
  return {
    values: current.values,
    startValues: first.values,
    before: regionErrors(regions, first.measured),
    after: regionErrors(regions, current.measured),
    history,
    evaluations,
    stoppedBy,
  };
}
