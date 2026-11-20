import { directionToSunAngles, hexToLinearRgb, linearRgbToHex, roundValue } from './studio-controller.js';
import { motionPropertyOf, propertyIsVisible, propertySectionsFor } from './studio-properties.js';

const DISPLAY_PRECISION = 10000;
const DRIVEN_LABEL = 'Animated by a motion track';

/**
 * Draws the property rows of one scene object from the table in studio-properties.js and keeps them in step with the recipe.
 * The panel shows whatever object `resolveKey` names; `sync` re-reads the recipe, so an edit an agent makes shows up there.
 * `builders` are the control builders of studio.js, handed in so both draw the same controls.
 */
export function createPropertyPanel({ documentReference, controller, announce, builders, resolveKey }) {
  const { createElement, createIcon, createSliderField, createVectorRow, createSunPad } = builders;
  const element = createElement(documentReference, 'div', { className: 'crucible-studio-properties' });
  let shownKind = null;
  let controls = new Map();

  function currentContext() {
    return { aspect: controller.viewportWidth / controller.viewportHeight };
  }

  function writePatch(key, kind, patch) {
    if (kind === 'camera') {
      controller.updateSceneCamera(patch);
    } else if (kind === 'sun') {
      controller.updateLook({ environment: patch });
    } else {
      controller.updateSceneLight(key, patch);
    }
  }

  // An edit the recipe refuses (a far plane behind the near one) is told to the person and the controls go back to the recipe.
  function commit(field, value) {
    const key = resolveKey();
    try {
      const description = controller.describeSceneObject(key);
      writePatch(key, description.kind, field.write(value, description.source, currentContext()));
    } catch (error) {
      announce(error.message);
      sync();
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
    return container.querySelector('.crucible-studio-field-head') ?? container;
  }

  function numberControl(field) {
    const input = createElement(documentReference, 'input', {
      type: 'number',
      min: String(field.min),
      max: String(field.max),
      step: String(field.step),
      placeholder: field.clearable ? 'Off' : '',
      attributes: { 'aria-label': field.label },
    });
    input.addEventListener('change', () => {
      if (input.value === '' && field.clearable) {
        commit(field, null);
        return;
      }
      const numeric = Number(input.value);
      if (input.value !== '' && Number.isFinite(numeric)) {
        commit(field, numeric);
      }
    });
    const container = createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'div', { className: 'crucible-studio-field-head' }, createElement(documentReference, 'span', { textContent: field.label })), input);
    return {
      container,
      setValue: value => {
        input.value = value === null ? '' : String(roundValue(value, DISPLAY_PRECISION));
      },
      setDisabled: disabled => {
        input.disabled = disabled;
      },
    };
  }

  function sliderControl(field) {
    const slider = createSliderField(documentReference, field.label, { min: field.min, max: field.max, step: field.step, value: field.min }, value => commit(field, value));
    return { container: slider.container, setValue: slider.setValue, setDisabled: disabled => { slider.input.disabled = disabled; } };
  }

  function colourControl(field) {
    const input = createElement(documentReference, 'input', { type: 'color', value: '#ffffff', attributes: { 'aria-label': field.label } });
    input.addEventListener('input', () => commit(field, hexToLinearRgb(input.value)));
    const container = createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: field.label }), input);
    return {
      container,
      setValue: value => {
        input.value = linearRgbToHex(value);
      },
      setDisabled: disabled => {
        input.disabled = disabled;
      },
    };
  }

  function toggleControl(field) {
    const button = createElement(documentReference, 'button', { type: 'button', textContent: field.label, attributes: { 'aria-pressed': 'false' } });
    button.addEventListener('click', () => commit(field, button.getAttribute('aria-pressed') !== 'true'));
    const container = createElement(documentReference, 'div', { className: 'crucible-studio-chips' }, button);
    return {
      container,
      setValue: value => button.setAttribute('aria-pressed', value ? 'true' : 'false'),
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
      onGestureStart: () => controller.beginUndoGroup(),
      onGestureEnd: () => controller.endUndoGroup(),
    });
    return { container: row.container, setValue: row.setValues, setDisabled: row.setDisabled };
  }

  function sunPadControl(field) {
    const pad = createSunPad(documentReference, angles => controller.setSunAngles(angles), {
      onDragStart: () => controller.beginUndoGroup(),
      onDragEnd: () => controller.endUndoGroup(),
    });
    const container = createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: field.label }), pad.element);
    return {
      container,
      setValue: direction => {
        const angles = directionToSunAngles(direction);
        pad.setAngles(angles.azimuthDegrees, angles.elevationDegrees);
      },
      setDisabled: pad.setDisabled,
    };
  }

  const CONTROL_BUILDERS = { number: numberControl, slider: sliderControl, colour: colourControl, toggle: toggleControl, vector: vectorControl, sunpad: sunPadControl };

  function buildRow(field) {
    const control = CONTROL_BUILDERS[field.control](field);
    const mark = createDrivenMark();
    headOf(control.container).append(mark);
    control.container.dataset.property = field.id;
    return { ...control, mark };
  }

  function rebuild(kind) {
    shownKind = kind;
    controls = new Map();
    element.replaceChildren(...propertySectionsFor(kind).map(section => createElement(
      documentReference,
      'div',
      { className: 'crucible-studio-property-section' },
      createElement(documentReference, 'span', { className: 'crucible-studio-property-title', textContent: section.title }),
      ...section.fields.map(field => {
        const row = buildRow(field);
        controls.set(field.id, { field, ...row });
        return row.container;
      }),
    )));
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
