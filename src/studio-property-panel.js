import { directionToSunAngles, hexToLinearRgb, linearRgbToHex } from './studio-controller.js';
import {
  formatPropertyNumber,
  hdriChoiceLabel,
  motionPropertyOf,
  propertyDisplayRange,
  propertyDisplayValue,
  propertyIsVisible,
  propertyNameOf,
  propertySectionsFor,
  propertyStoredValue,
  propertyValueText,
} from './studio-properties.js';

const DRIVEN_LABEL = 'Animated by a motion track';

/**
 * One line of a property panel: the label on the left and the control in the value column on the right.
 * `controls` are the elements of the value column, in order; the line is a grid of the label and them.
 */
export function createPropertyLine(documentReference, createElement, label, ...controls) {
  const head = createElement(documentReference, 'div', { className: 'crucible-studio-prop-head' }, createElement(documentReference, 'span', { className: 'crucible-studio-prop-label', textContent: label, title: label }));
  return createElement(documentReference, 'div', { className: 'crucible-studio-prop' }, head, ...controls);
}

/**
 * Draws the property rows of one scene object from the table in studio-properties.js and keeps them in step with the recipe.
 * The panel shows whatever object `resolveKey` names; `sync` re-reads the recipe, so an edit an agent makes shows up there.
 * `builders` are the control builders of studio.js, handed in so both draw the same controls.
 * `groups` ({ isOpen(id, openByDefault), setOpen(id, open) }) remembers which section titles a person folded.
 * `opensFirstGroup` starts the panel's first group open; every other group starts folded.
 * `leadingRows` ({ [sectionId]: element }) puts an element as the first row of that section.
 * `catalogNames` ({ [id]: name }) names the catalog HDRIs a scene may use.
 * `prepareRecipe` loads what a choice needs before it is written (the file of an HDRI), for a row that names a `preparation`.
 */
export function createPropertyPanel({ documentReference, controller, announce, builders, resolveKey, groups, prepareRecipe, opensFirstGroup = false, leadingRows = {}, catalogNames = {} }) {
  const { createElement, createIcon, createVectorRow, createSunPad } = builders;
  const element = createElement(documentReference, 'div', { className: 'crucible-studio-properties' });
  let shownKind = null;
  let controls = new Map();

  function currentContext() {
    return { aspect: controller.viewportWidth / controller.viewportHeight };
  }

  // Where the patch of each kind goes; every other kind is a light.
  const PATCH_WRITERS = {
    camera: (key, patch) => controller.updateSceneCamera(patch),
    sun: (key, patch) => controller.updateLook({ environment: patch }),
    world: (key, patch) => controller.updateLook({ environment: patch }),
    quality: (key, patch) => controller.updateLook({ environment: patch }),
    effects: (key, patch) => controller.updateLook({ effects: patch }),
    shadow: (key, patch) => controller.updateSceneShadow(patch),
  };

  function writePatch(key, kind, patch) {
    const write = PATCH_WRITERS[kind] ?? ((lightKey, lightPatch) => controller.updateSceneLight(lightKey, lightPatch));
    write(key, patch);
  }

  function reportRefusal(error) {
    announce(error.message);
    sync();
  }

  function writeField(field, value) {
    const key = resolveKey();
    const description = controller.describeSceneObject(key);
    writePatch(key, description.kind, field.write(value, description.source, currentContext()));
  }

  // An edit the recipe refuses (a far plane behind the near one) is told to the person and the controls go back to the recipe.
  function commit(field, value) {
    if (field.preparation && value !== null && prepareRecipe) {
      prepareRecipe(field.preparation(value)).then(() => writeField(field, value)).catch(reportRefusal);
      return;
    }
    try {
      writeField(field, value);
    } catch (error) {
      reportRefusal(error);
    }
  }

  function createDrivenMark() {
    const mark = createElement(documentReference, 'span', {
      className: 'crucible-studio-driven-mark',
      hidden: true,
      title: DRIVEN_LABEL,
      attributes: { role: 'img', 'aria-label': DRIVEN_LABEL },
    }, createIcon(documentReference, 'keyframe'));
    return mark;
  }

  function headOf(container) {
    return container.querySelector('.crucible-studio-prop-head') ?? container.querySelector('.crucible-studio-field-head') ?? container;
  }

  function createUnitMark(field) {
    return createElement(documentReference, 'span', { className: 'crucible-studio-prop-unit', textContent: field.unit, attributes: { 'aria-hidden': 'true' } });
  }

  function numberControl(field) {
    const range = propertyDisplayRange(field);
    const input = createElement(documentReference, 'input', {
      type: 'number',
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
      placeholder: field.clearable ? 'Off' : '',
      attributes: { 'aria-label': propertyNameOf(field) },
    });
    input.addEventListener('change', () => {
      if (input.value === '' && field.clearable) {
        commit(field, null);
        return;
      }
      const typed = Number(input.value);
      if (input.value !== '' && Number.isFinite(typed)) {
        commit(field, propertyStoredValue(field, typed));
      }
    });
    const valueColumn = field.unit ? [input, createUnitMark(field)] : [input];
    return {
      container: createPropertyLine(documentReference, createElement, field.label, ...valueColumn),
      setValue: value => {
        input.value = value === null ? '' : propertyValueText(field, value);
      },
      setDisabled: disabled => {
        input.disabled = disabled;
      },
    };
  }

  // A bounded number: a slim slider with its value beside it on the same line.
  function sliderControl(field) {
    const range = propertyDisplayRange(field);
    const output = createElement(documentReference, 'output', { dataset: field.unit ? { unit: field.unit } : {} });
    const input = createElement(documentReference, 'input', {
      type: 'range',
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
      value: String(range.min),
      attributes: { 'aria-label': propertyNameOf(field) },
    });
    input.addEventListener('input', () => {
      const shown = Number(input.value);
      output.textContent = formatPropertyNumber(shown);
      commit(field, propertyStoredValue(field, shown));
    });
    return {
      container: createPropertyLine(documentReference, createElement, field.label, input, output),
      setValue: value => {
        input.value = String(propertyDisplayValue(field, value));
        output.textContent = propertyValueText(field, value);
      },
      setDisabled: disabled => {
        input.disabled = disabled;
      },
    };
  }

  function colourControl(field) {
    const input = createElement(documentReference, 'input', { type: 'color', value: '#ffffff', attributes: { 'aria-label': propertyNameOf(field) } });
    input.addEventListener('input', () => commit(field, hexToLinearRgb(input.value)));
    return {
      container: createPropertyLine(documentReference, createElement, field.label, input),
      setValue: value => {
        input.value = linearRgbToHex(value);
      },
      setDisabled: disabled => {
        input.disabled = disabled;
      },
    };
  }

  // A switch: its knob sits at the right and its track is filled when on, at the left and empty when off.
  function toggleControl(field) {
    const knob = createElement(documentReference, 'span', { className: 'crucible-studio-switch-knob', attributes: { 'aria-hidden': 'true' } });
    const button = createElement(documentReference, 'button', {
      type: 'button',
      className: 'crucible-studio-switch',
      attributes: { role: 'switch', 'aria-checked': 'false', 'aria-label': propertyNameOf(field) },
    }, knob);
    button.addEventListener('click', () => commit(field, button.getAttribute('aria-checked') !== 'true'));
    return {
      container: createPropertyLine(documentReference, createElement, field.label, button),
      setValue: value => button.setAttribute('aria-checked', value ? 'true' : 'false'),
      setDisabled: disabled => {
        button.disabled = disabled;
        button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      },
    };
  }

  function vectorControl(field) {
    const axisNames = ['x', 'y', 'z'].slice(0, field.axes ?? 3);
    const row = createVectorRow(documentReference, field.label, values => commit(field, values), {
      axisNames,
      accessibleTitle: propertyNameOf(field),
      onGestureStart: () => controller.beginUndoGroup(),
      onGestureEnd: () => controller.endUndoGroup(),
    });
    return { container: row.container, setValue: row.setValues, setDisabled: row.setDisabled };
  }

  // A choice from a short list. A value the list lacks (a catalog file the scene names) shows as a read-only current choice.
  function selectControl(field) {
    const select = createElement(documentReference, 'select', { attributes: { 'aria-label': propertyNameOf(field) } });
    const optionValue = value => (value === null ? '' : value);
    select.append(...field.choices.map(choice => createElement(documentReference, 'option', { value: optionValue(choice.value), textContent: choice.label })));
    select.addEventListener('change', () => commit(field, select.value === '' ? null : select.value));
    let unlistedOption = null;
    return {
      container: createPropertyLine(documentReference, createElement, field.label, select),
      setValue: value => {
        unlistedOption?.remove();
        unlistedOption = null;
        if (value !== null && !field.choices.some(choice => choice.value === value)) {
          unlistedOption = createElement(documentReference, 'option', { value, textContent: hdriChoiceLabel(value, catalogNames), disabled: true });
          select.append(unlistedOption);
        }
        select.value = optionValue(value);
      },
      setDisabled: disabled => {
        select.disabled = disabled;
      },
    };
  }

  function sunPadControl(field) {
    const pad = createSunPad(documentReference, angles => controller.setSunAngles(angles), {
      onDragStart: () => controller.beginUndoGroup(),
      onDragEnd: () => controller.endUndoGroup(),
    });
    return {
      container: createPropertyLine(documentReference, createElement, field.label, pad.element),
      setValue: direction => {
        const angles = directionToSunAngles(direction);
        pad.setAngles(angles.azimuthDegrees, angles.elevationDegrees);
      },
      setDisabled: pad.setDisabled,
    };
  }

  const CONTROL_BUILDERS = { select: selectControl, number: numberControl, slider: sliderControl, colour: colourControl, toggle: toggleControl, vector: vectorControl, sunpad: sunPadControl };

  function buildRow(field) {
    const control = CONTROL_BUILDERS[field.control](field);
    const mark = createDrivenMark();
    headOf(control.container).append(mark);
    control.container.dataset.property = field.id;
    control.container.dataset.control = field.control;
    return { ...control, mark };
  }

  function rebuild(kind) {
    shownKind = kind;
    controls = new Map();
    element.replaceChildren(...propertySectionsFor(kind).map(buildSection));
  }

  function buildSection(section, index) {
    const leadingRow = leadingRows[section.id] ? [leadingRows[section.id]] : [];
    const rows = createElement(documentReference, 'div', { className: 'crucible-studio-property-rows' }, ...leadingRow, ...section.fields.map(field => {
      const row = buildRow(field);
      controls.set(field.id, { field, ...row });
      return row.container;
    }));
    const title = createElement(documentReference, 'button', {
      type: 'button',
      className: 'crucible-studio-property-title',
      attributes: { 'aria-expanded': 'true' },
    }, createIcon(documentReference, 'chevron'), createElement(documentReference, 'span', { textContent: section.title }));
    const container = createElement(documentReference, 'div', { className: 'crucible-studio-property-section', dataset: { section: section.id } }, title, rows);
    const showOpen = open => {
      container.dataset.open = open ? 'true' : 'false';
      title.setAttribute('aria-expanded', open ? 'true' : 'false');
      rows.hidden = !open;
    };
    showOpen(groups.isOpen(section.id, opensFirstGroup && index === 0));
    title.addEventListener('click', () => {
      const open = container.dataset.open !== 'true';
      groups.setOpen(section.id, open);
      showOpen(open);
    });
    return container;
  }

  function sync() {
    const description = controller.describeSceneObject(resolveKey());
    if (description.kind !== shownKind) {
      rebuild(description.kind);
    }
    const context = currentContext();
    for (const { field, container, mark, setValue, setDisabled } of controls.values()) {
      container.hidden = !propertyIsVisible(field, description.source);
      const driven = description.drivenProperties.has(motionPropertyOf(field));
      container.dataset.driven = driven ? 'true' : 'false';
      mark.hidden = !driven;
      setDisabled(driven);
      if (field.read) {
        setValue(field.read(description.source, context));
      }
    }
  }

  return { element, sync };
}
