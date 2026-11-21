// The first-run setup dialog: four groups of choice cards (theme, performance, modelling, working with an agent) that
// change the live Studio behind it. It is built from the preferences Studio already keeps, so nothing here is saved
// anywhere new. `open({ layout })` shows the groups one page at a time ('steps') or all on one sheet ('sheet').
import { STUDIO_PREFERENCE_CHOICES } from './studio-preferences.js';

export const STUDIO_SETUP_LAYOUTS = Object.freeze(['steps', 'sheet']);

const THEME_CHOICES = Object.freeze([
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]);

const PERFORMANCE_CHOICES = Object.freeze([
  { value: 'automatic', label: 'Automatic' },
  { value: 'light', label: 'Light' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'sharp', label: 'Sharp' },
]);

const MODELLING_ROWS = Object.freeze([
  { name: 'moveSnapStep', label: 'Move snap step', describe: value => `${value} m` },
  { name: 'rotateSnapDegrees', label: 'Rotate snap angle', describe: value => `${value}°` },
  { name: 'gizmoSize', label: 'Handle size', describe: capitalize },
  { name: 'startWorkspace', label: 'Open in', describe: capitalize },
]);

// The sketch's parts, drawn in the tokens of the theme the sketch shows.
const SKETCH_PARTS = Object.freeze(['bar', 'rail', 'viewport', 'ground', 'solid', 'card-top', 'card-bottom']);

let setupInstanceCount = 0;

function capitalize(word) {
  return word[0].toUpperCase() + word.slice(1);
}

function formatRatio(pixelRatio) {
  return `${Number(pixelRatio.toFixed(2))}x`;
}

/** A miniature of Studio in one theme: top bar, tool rail, a viewport with a ground line and a solid, and two cards. */
function createThemeSketch(documentReference, createElement, theme, half = null) {
  const frame = createElement(
    documentReference,
    'span',
    { className: 'crucible-studio-setup-sketch-frame' },
    ...SKETCH_PARTS.map(part => createElement(documentReference, 'span', { className: 'crucible-studio-setup-sketch-part', dataset: { part } })),
  );
  const sketch = createElement(documentReference, 'span', { className: 'crucible-studio-setup-sketch', dataset: { theme } }, frame);
  if (half) {
    sketch.dataset.half = half;
  }
  return sketch;
}

function createThemePreview(documentReference, createElement, theme) {
  const sketches = theme === 'system'
    ? [createThemeSketch(documentReference, createElement, 'light', 'left'), createThemeSketch(documentReference, createElement, 'dark', 'right')]
    : [createThemeSketch(documentReference, createElement, theme)];
  return createElement(documentReference, 'span', { className: 'crucible-studio-setup-preview' }, ...sketches);
}

export function createStudioSetup({
  documentReference,
  createElement,
  createIcon,
  readPreferences,
  changePreferences,
  describeHardware,
  viewportSettingsForTier,
  agentPromptText,
  copyAgentPrompt,
  onClose,
}) {
  setupInstanceCount += 1;
  const instanceId = setupInstanceCount;
  const radios = [];
  let layout = 'steps';
  let stepIndex = 0;

  // One radio per card, so the arrow keys, Tab and a screen reader work without any script. The radio sits invisibly
  // over the card; the card shows a check mark when chosen, so the choice is never shown by colour alone.
  function createChoiceCard({ groupName, preferenceName, value, preview, label, details = [] }) {
    const radio = createElement(documentReference, 'input', { type: 'radio', name: `crucible-studio-setup-${instanceId}-${groupName}`, value: String(value) });
    radio.dataset.setup = preferenceName;
    radio.addEventListener('change', () => {
      if (radio.checked) {
        changePreferences({ [preferenceName]: STUDIO_PREFERENCE_CHOICES[preferenceName].find(choice => String(choice) === radio.value) });
      }
    });
    radios.push(radio);
    const labelRow = createElement(
      documentReference,
      'span',
      { className: 'crucible-studio-setup-card-name' },
      createElement(documentReference, 'span', { className: 'crucible-studio-setup-card-label', textContent: label }),
    );
    return createElement(
      documentReference,
      'label',
      { className: 'crucible-studio-setup-card' },
      radio,
      ...(preview ? [preview] : []),
      labelRow,
      ...details,
      createElement(documentReference, 'span', { className: 'crucible-studio-setup-check' }, createIcon(documentReference, 'check')),
    );
  }

  function createCardGroup(groupLabel, cards, className = '') {
    return createElement(
      documentReference,
      'div',
      { className: `crucible-studio-setup-cards ${className}`.trim(), attributes: { role: 'radiogroup', 'aria-label': groupLabel } },
      ...cards,
    );
  }

  const themeCards = THEME_CHOICES.map(({ value, label }) => createChoiceCard({
    groupName: 'theme',
    preferenceName: 'theme',
    value,
    label,
    preview: createThemePreview(documentReference, createElement, value),
  }));

  // Each tier card shows what the tier gives on this screen: the pixel ratio and the anti-aliasing samples.
  const performanceFacts = [];
  function createFacts(tier) {
    const ratio = createElement(documentReference, 'span', { className: 'crucible-studio-setup-fact' });
    const antiAliasing = createElement(documentReference, 'span', { className: 'crucible-studio-setup-fact' });
    performanceFacts.push({ tier, ratio, antiAliasing });
    return createElement(documentReference, 'span', { className: 'crucible-studio-setup-facts' }, ratio, antiAliasing);
  }
  // Automatic gives no numbers of its own: it names the tier it picks here and the hardware that decided it.
  const automaticPick = createElement(documentReference, 'span', { className: 'crucible-studio-setup-facts' });
  const hardwareLine = createElement(documentReference, 'span', { className: 'crucible-studio-setup-card-detail' });
  const performanceCards = PERFORMANCE_CHOICES.map(({ value, label }) => {
    const automatic = value === 'automatic';
    return createChoiceCard({
      groupName: 'performance',
      preferenceName: 'performance',
      value,
      label,
      details: automatic ? [automaticPick, hardwareLine] : [createFacts(value)],
    });
  });

  const modellingRows = MODELLING_ROWS.map(({ name, label, describe }) => {
    const cards = STUDIO_PREFERENCE_CHOICES[name].map(value => createChoiceCard({
      groupName: name,
      preferenceName: name,
      value,
      label: describe(value),
      preview: name === 'gizmoSize' ? createElement(documentReference, 'span', { className: 'crucible-studio-setup-handle', dataset: { size: value } }) : null,
    }));
    return createElement(
      documentReference,
      'div',
      { className: 'crucible-studio-setup-row' },
      createElement(documentReference, 'span', { className: 'crucible-studio-setup-row-label', textContent: label }),
      createCardGroup(label, cards, 'crucible-studio-setup-chips'),
    );
  });

  // The agent step shows the prompt itself, and the button copies it.
  const promptBlock = createElement(documentReference, 'textarea', {
    className: 'crucible-studio-setup-prompt',
    readOnly: true,
    rows: 5,
    attributes: { 'aria-label': 'Prompt for the agent' },
  });
  const copyPromptButton = createElement(documentReference, 'button', { type: 'button', className: 'crucible-studio-setup-action' });
  function showCopied(copied) {
    copyPromptButton.replaceChildren(
      createIcon(documentReference, copied ? 'check' : 'agent'),
      createElement(documentReference, 'span', { textContent: copied ? 'Copied' : 'Copy an agent prompt' }),
    );
  }
  showCopied(false);
  copyPromptButton.addEventListener('click', async () => {
    showCopied(await copyAgentPrompt());
  });

  const groups = [
    { title: 'Theme', stepName: 'Theme', content: [createCardGroup('Theme', themeCards, 'crucible-studio-setup-cards-theme')] },
    { title: 'Performance', stepName: 'Performance', content: [createCardGroup('Performance', performanceCards, 'crucible-studio-setup-cards-wide')] },
    { title: 'Modelling', stepName: 'Modelling', content: modellingRows },
    { title: 'Work with an AI agent', stepName: 'AI agent', content: [createElement(documentReference, 'div', { className: 'crucible-studio-setup-agent' }, promptBlock, copyPromptButton)] },
  ];
  const sections = groups.map(({ title, content }, index) => createElement(
    documentReference,
    'section',
    { className: 'crucible-studio-setup-group', attributes: { 'aria-labelledby': `crucible-studio-setup-${instanceId}-title-${index}` } },
    createElement(documentReference, 'h3', { id: `crucible-studio-setup-${instanceId}-title-${index}`, textContent: title }),
    ...content,
  ));

  const stepButtons = groups.map(({ stepName }, index) => {
    const button = createElement(documentReference, 'button', { type: 'button', className: 'crucible-studio-setup-step', textContent: stepName });
    button.addEventListener('click', () => {
      stepIndex = index;
      showStep();
      focusDialog();
    });
    return button;
  });
  const stepRow = createElement(documentReference, 'div', { className: 'crucible-studio-setup-steps' }, ...stepButtons);
  const skipButton = createElement(documentReference, 'button', { type: 'button', className: 'crucible-studio-setup-skip', textContent: 'Skip' });
  const backButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Back' });
  const nextButton = createElement(documentReference, 'button', { type: 'button', className: 'crucible-studio-setup-primary', textContent: 'Next' });
  const doneButton = createElement(documentReference, 'button', { type: 'button', className: 'crucible-studio-setup-primary', textContent: 'Done' });

  const dialog = createElement(
    documentReference,
    'dialog',
    { className: 'crucible-studio-setup-dialog', tabIndex: -1, attributes: { 'aria-labelledby': `crucible-studio-setup-${instanceId}-heading` } },
    createElement(documentReference, 'h2', { id: `crucible-studio-setup-${instanceId}-heading`, textContent: 'Set up Studio' }),
    stepRow,
    createElement(documentReference, 'div', { className: 'crucible-studio-setup-body' }, ...sections),
    createElement(documentReference, 'div', { className: 'crucible-studio-dialog-actions crucible-studio-setup-actions' }, skipButton, backButton, nextButton, doneButton),
  );
  dialog.addEventListener('close', () => {
    dialog.returnValue = '';
    onClose();
  });

  function showStep() {
    const stepped = layout === 'steps';
    const lastStep = stepIndex === groups.length - 1;
    dialog.dataset.layout = layout;
    sections.forEach((section, index) => {
      // Every step sits in one grid cell, so the dialog is as tall as the tallest and never jumps; a step that is not shown is invisible and inert.
      section.inert = stepped && index !== stepIndex;
    });
    stepButtons.forEach((button, index) => {
      button.dataset.current = String(index === stepIndex);
      if (index === stepIndex) {
        button.setAttribute('aria-current', 'step');
      } else {
        button.removeAttribute('aria-current');
      }
    });
    stepRow.hidden = !stepped;
    backButton.hidden = !stepped || stepIndex === 0;
    nextButton.hidden = !stepped || lastStep;
    doneButton.hidden = stepped && !lastStep;
  }

  // Focus rests on the dialog itself, so no control opens with a focus ring and the first Tab lands on the first control.
  function focusDialog() {
    dialog.focus();
  }

  skipButton.addEventListener('click', () => dialog.close());
  doneButton.addEventListener('click', () => dialog.close());
  backButton.addEventListener('click', () => {
    stepIndex = Math.max(0, stepIndex - 1);
    showStep();
    focusDialog();
  });
  nextButton.addEventListener('click', () => {
    stepIndex = Math.min(groups.length - 1, stepIndex + 1);
    showStep();
    focusDialog();
  });

  /** Shows the chosen preferences in the cards, what each tier gives on this screen and the hardware found. */
  function refresh() {
    const preferences = readPreferences();
    for (const radio of radios) {
      const chosen = String(preferences[radio.dataset.setup]) === radio.value;
      radio.checked = chosen;
      radio.parentNode.dataset.selected = String(chosen);
    }
    const { tier: detectedTier, summary } = describeHardware();
    for (const { tier, ratio, antiAliasing } of performanceFacts) {
      const { pixelRatio, samples } = viewportSettingsForTier(tier);
      ratio.textContent = formatRatio(pixelRatio);
      antiAliasing.textContent = `AA ${samples}x`;
    }
    automaticPick.textContent = `${capitalize(detectedTier)} on this machine`;
    hardwareLine.textContent = summary;
    hardwareLine.title = summary;
    promptBlock.value = agentPromptText();
    showCopied(false);
  }

  function open({ layout: requestedLayout = 'steps' } = {}) {
    if (!STUDIO_SETUP_LAYOUTS.includes(requestedLayout)) {
      throw new RangeError(`Unknown setup layout "${String(requestedLayout)}". Use one of ${STUDIO_SETUP_LAYOUTS.join(', ')}.`);
    }
    layout = requestedLayout;
    stepIndex = 0;
    refresh();
    showStep();
    if (!dialog.open) {
      dialog.showModal();
    }
    focusDialog();
  }

  return { dialog, open, refresh };
}
