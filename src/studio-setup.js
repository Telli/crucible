// The first-run setup dialog: four groups of choice cards (theme, performance, modelling, working with an agent) that
// change the live Studio behind it. It is built from the preferences Studio already keeps, so nothing here is saved
// anywhere new. `open({ layout })` shows the groups one page at a time ('steps') or all on one sheet ('sheet').
import { STUDIO_PIXEL_RATIO_CAPS } from './studio-hardware.js';
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

let setupInstanceCount = 0;

function capitalize(word) {
  return word[0].toUpperCase() + word.slice(1);
}

function formatPixelRatio(tier) {
  return `${STUDIO_PIXEL_RATIO_CAPS[tier]}x`;
}

/** A few rectangles in one theme's tokens: the bar, the rail, the viewport and the side panel. */
function createThemeSketch(documentReference, createElement, theme) {
  return createElement(
    documentReference,
    'span',
    { className: 'crucible-studio-setup-sketch', dataset: { theme } },
    ...['bar', 'rail', 'viewport', 'side'].map(part => createElement(documentReference, 'span', { className: 'crucible-studio-setup-sketch-part', dataset: { part } })),
  );
}

function createThemePreview(documentReference, createElement, theme) {
  if (theme !== 'system') {
    return createElement(documentReference, 'span', { className: 'crucible-studio-setup-preview' }, createThemeSketch(documentReference, createElement, theme));
  }
  const darkHalf = createThemeSketch(documentReference, createElement, 'dark');
  darkHalf.dataset.half = 'true';
  return createElement(documentReference, 'span', { className: 'crucible-studio-setup-preview' }, createThemeSketch(documentReference, createElement, 'light'), darkHalf);
}

export function createStudioSetup({ documentReference, createElement, createIcon, readPreferences, changePreferences, describeHardware, copyAgentPrompt, onClose }) {
  setupInstanceCount += 1;
  const instanceId = setupInstanceCount;
  const radios = [];
  let layout = 'steps';
  let stepIndex = 0;

  // One radio per card, so the arrow keys, Tab and a screen reader work without any script. The radio sits invisibly
  // over the card; the card shows a check mark when chosen, so the choice is never shown by colour alone.
  function createChoiceCard({ groupName, preferenceName, value, preview, label, detail }) {
    const radio = createElement(documentReference, 'input', { type: 'radio', name: `crucible-studio-setup-${instanceId}-${groupName}`, value: String(value) });
    radio.dataset.setup = preferenceName;
    radio.addEventListener('change', () => {
      if (radio.checked) {
        changePreferences({ [preferenceName]: STUDIO_PREFERENCE_CHOICES[preferenceName].find(choice => String(choice) === radio.value) });
      }
    });
    radios.push(radio);
    const card = createElement(
      documentReference,
      'label',
      { className: 'crucible-studio-setup-card' },
      radio,
      ...(preview ? [preview] : []),
      createElement(documentReference, 'span', { className: 'crucible-studio-setup-card-label', textContent: label }),
      ...(detail ? [detail] : []),
      createElement(documentReference, 'span', { className: 'crucible-studio-setup-check' }, createIcon(documentReference, 'check')),
    );
    return card;
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

  const hardwareDetail = createElement(documentReference, 'span', { className: 'crucible-studio-setup-card-detail' });
  const automaticRatio = createElement(documentReference, 'span', { className: 'crucible-studio-setup-ratio' });
  const performanceCards = PERFORMANCE_CHOICES.map(({ value, label }) => {
    const automatic = value === 'automatic';
    return createChoiceCard({
      groupName: 'performance',
      preferenceName: 'performance',
      value,
      label,
      preview: automatic ? automaticRatio : createElement(documentReference, 'span', { className: 'crucible-studio-setup-ratio', textContent: formatPixelRatio(value) }),
      detail: automatic ? hardwareDetail : null,
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
      createCardGroup(label, cards, 'crucible-studio-setup-cards-compact'),
    );
  });

  const copyPromptButton = createElement(
    documentReference,
    'button',
    { type: 'button', className: 'crucible-studio-setup-action' },
    createIcon(documentReference, 'agent'),
    createElement(documentReference, 'span', { textContent: 'Copy an agent prompt' }),
  );
  copyPromptButton.addEventListener('click', () => copyAgentPrompt());

  const groups = [
    { title: 'Theme', content: [createCardGroup('Theme', themeCards)] },
    { title: 'Performance', content: [createCardGroup('Performance', performanceCards)] },
    { title: 'Modelling', content: modellingRows },
    { title: 'Work with an AI agent', content: [copyPromptButton] },
  ];
  const sections = groups.map(({ title, content }, index) => createElement(
    documentReference,
    'section',
    { className: 'crucible-studio-setup-group', attributes: { 'aria-labelledby': `crucible-studio-setup-${instanceId}-title-${index}` } },
    createElement(documentReference, 'h3', { id: `crucible-studio-setup-${instanceId}-title-${index}`, textContent: title }),
    ...content,
  ));

  const stepMarks = groups.map(() => createElement(documentReference, 'span', { className: 'crucible-studio-setup-step-mark' }));
  const stepIndicator = createElement(documentReference, 'div', { className: 'crucible-studio-setup-steps' }, ...stepMarks);
  const skipButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Skip' });
  const backButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Back' });
  const nextButton = createElement(documentReference, 'button', { type: 'button', className: 'crucible-studio-setup-primary', textContent: 'Next' });
  const doneButton = createElement(documentReference, 'button', { type: 'button', className: 'crucible-studio-setup-primary', textContent: 'Done' });

  const dialog = createElement(
    documentReference,
    'dialog',
    { className: 'crucible-studio-setup-dialog', attributes: { 'aria-labelledby': `crucible-studio-setup-${instanceId}-heading` } },
    createElement(documentReference, 'h2', { id: `crucible-studio-setup-${instanceId}-heading`, textContent: 'Set up Studio' }),
    createElement(documentReference, 'div', { className: 'crucible-studio-setup-body' }, ...sections),
    createElement(
      documentReference,
      'div',
      { className: 'crucible-studio-dialog-actions crucible-studio-setup-actions' },
      stepIndicator,
      skipButton,
      backButton,
      nextButton,
      doneButton,
    ),
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
      section.hidden = stepped && index !== stepIndex;
    });
    stepMarks.forEach((mark, index) => {
      mark.dataset.current = String(index === stepIndex);
    });
    stepIndicator.hidden = !stepped;
    stepIndicator.setAttribute('aria-label', `Step ${stepIndex + 1} of ${groups.length}`);
    backButton.hidden = !stepped || stepIndex === 0;
    nextButton.hidden = !stepped || lastStep;
    doneButton.hidden = stepped && !lastStep;
  }

  skipButton.addEventListener('click', () => dialog.close());
  doneButton.addEventListener('click', () => dialog.close());
  backButton.addEventListener('click', () => {
    stepIndex = Math.max(0, stepIndex - 1);
    showStep();
  });
  nextButton.addEventListener('click', () => {
    stepIndex = Math.min(groups.length - 1, stepIndex + 1);
    showStep();
  });

  /** Shows the chosen preferences in the cards and the detected hardware in the Automatic card. */
  function refresh() {
    const preferences = readPreferences();
    for (const radio of radios) {
      const chosen = String(preferences[radio.dataset.setup]) === radio.value;
      radio.checked = chosen;
      radio.parentNode.dataset.selected = String(chosen);
    }
    const { tier, summary } = describeHardware();
    hardwareDetail.textContent = summary;
    automaticRatio.textContent = formatPixelRatio(tier);
    automaticRatio.title = `Picks ${capitalize(tier)}`;
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
  }

  return { dialog, open, refresh };
}
