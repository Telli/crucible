// Studio is one full-bleed viewport with floating islands on top: the scene keeps the screen.
export const STUDIO_CSS = `
.crucible-studio {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  min-height: 480px;
  overflow: hidden;
  --studio-bg: var(--site-bg, #17161a);
  --studio-panel: var(--site-sidebar, #201f24);
  --studio-surface: var(--site-surface, #2a282d);
  --studio-text: var(--site-text, #f1f0ec);
  --studio-muted: var(--site-muted, #a09ea6);
  --studio-border: var(--site-border, #fefefd1f);
  --studio-accent: var(--site-focus, #fc9132);
  --studio-ok: #5fc48a;
  --studio-font: Inter, system-ui, sans-serif;
  --studio-font-heading: 'Plus Jakarta Sans', Inter, system-ui, sans-serif;
  --studio-font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --studio-edge: 12px;
  --studio-top: 68px;
  --studio-rail: 44px;
  --studio-bar-clear: 54px;
  --studio-shadow: 0 10px 28px rgb(0 0 0 / 0.26);
  background: var(--studio-bg);
  color: var(--studio-text);
  font-family: var(--studio-font);
  font-size: 12.5px;
  user-select: none;
}
.crucible-studio * { box-sizing: border-box; }
.crucible-studio input,
.crucible-studio textarea { user-select: text; }

.crucible-studio button,
.crucible-studio select,
.crucible-studio input,
.crucible-studio textarea {
  font: inherit;
  color: inherit;
}

.crucible-studio button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-inline-size: 32px;
  min-block-size: 32px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}
.crucible-studio button[data-icon] {
  inline-size: 32px;
  padding: 0;
  flex-shrink: 0;
}
.crucible-studio-icon {
  inline-size: 17px;
  block-size: 17px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.crucible-studio button[aria-pressed="true"] {
  background: color-mix(in srgb, var(--studio-text) 14%, transparent);
}
.crucible-studio button[aria-disabled="true"] {
  opacity: 0.35;
  cursor: not-allowed;
}
.crucible-studio :focus-visible {
  outline: 2px solid var(--studio-accent);
  outline-offset: 2px;
}
@media (hover: hover) {
  .crucible-studio button:not([aria-disabled="true"]):not([aria-pressed="true"]):hover {
    background: color-mix(in srgb, var(--studio-text) 8%, transparent);
  }
}
@media (prefers-reduced-motion: no-preference) {
  .crucible-studio button {
    transition: background 140ms ease, color 140ms ease, opacity 140ms ease;
  }
}
@media (pointer: coarse) {
  .crucible-studio button {
    min-inline-size: 40px;
    min-block-size: 40px;
  }
  .crucible-studio button[data-icon] { inline-size: 40px; }
  .crucible-studio { --studio-rail: 52px; }
}

.crucible-studio-island {
  display: flex;
  align-items: center;
  /* The gap equals the inset the eye sees: 5px of padding plus the 1px border. */
  gap: 6px;
  padding: 5px;
  border: 1px solid var(--studio-border);
  border-radius: 13px;
  background: var(--studio-panel);
  box-shadow: var(--studio-shadow);
  pointer-events: auto;
}

.crucible-studio-viewport {
  position: absolute;
  inset: 0;
  background: var(--studio-bg);
  overflow: hidden;
}
.crucible-studio-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
}
.crucible-studio-canvas:active { cursor: grabbing; }
.crucible-studio-gizmo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.crucible-studio-gizmo [data-gizmo-axis] {
  pointer-events: all;
  cursor: pointer;
}
.crucible-studio-selection-outline {
  fill: none;
  stroke: var(--studio-accent);
  stroke-width: 1.5;
  stroke-linejoin: round;
  pointer-events: none;
}
.crucible-studio-view-widget {
  position: absolute;
  inset-inline-end: var(--studio-edge);
  inset-block-end: var(--studio-edge);
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--studio-panel) 70%, transparent);
  user-select: none;
}
.crucible-studio-view-widget [data-view] { cursor: pointer; }
.crucible-studio-view-letter {
  fill: #17161a;
  font: 700 9.5px var(--studio-font);
  pointer-events: none;
}
.crucible-studio-readout {
  position: absolute;
  inset-inline-start: var(--studio-edge);
  inset-block-end: var(--studio-edge);
  display: flex;
  flex-direction: column;
  gap: 1px;
  color: var(--studio-muted);
  font: 500 11.5px/1.45 var(--studio-font-mono);
  font-variant-numeric: tabular-nums;
  padding: 5px 9px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--studio-panel) 72%, transparent);
  pointer-events: none;
  user-select: none;
}
.crucible-studio-readout-selection { color: var(--studio-text); }
.crucible-studio-readout-selection:empty { display: none; }
.crucible-studio[data-compact="true"] .crucible-studio-readout { display: none; }
.crucible-studio[data-compact="true"] .crucible-studio-view-widget {
  inset-block: var(--studio-top) auto;
}
.crucible-studio-agent-outline {
  fill: none;
  stroke-width: 2;
  stroke-dasharray: 5 4;
  stroke-linejoin: round;
  pointer-events: none;
}
.crucible-studio-agent-cursor {
  position: absolute;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  pointer-events: none;
  color: var(--studio-accent);
}
.crucible-studio-agent-cursor[hidden] { display: none; }
.crucible-studio-agent-cursor svg {
  flex: none;
  width: 28px;
  height: 28px;
  fill: currentColor;
  stroke: var(--studio-bg);
  stroke-width: 1.2;
  stroke-linejoin: round;
}
.crucible-studio-agent-name {
  margin: 22px 0 0 -8px;
  padding: 4px 11px;
  border-radius: 5px 11px 11px 11px;
  color: #17161a;
  font: 700 12.5px/1.5 var(--studio-font);
  white-space: nowrap;
}
@media (prefers-reduced-motion: no-preference) {
  .crucible-studio-agent-cursor {
    transition: left 520ms cubic-bezier(0.2, 0, 0, 1), top 520ms cubic-bezier(0.2, 0, 0, 1);
  }
}
.crucible-studio-drop-overlay {
  position: absolute;
  inset: var(--studio-edge);
  display: none;
  place-items: center;
  border: 2px dashed color-mix(in srgb, var(--studio-text) 45%, transparent);
  border-radius: 13px;
  background: color-mix(in srgb, var(--studio-bg) 85%, transparent);
  color: var(--studio-text);
  font-family: var(--studio-font-heading);
  font-weight: 600;
  font-size: 15px;
  pointer-events: none;
  z-index: 8;
}
.crucible-studio-viewport[data-drop-active="true"] .crucible-studio-drop-overlay {
  display: grid;
}

.crucible-studio-menubar {
  position: absolute;
  inset: var(--studio-edge) var(--studio-edge) auto;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  z-index: 6;
}
.crucible-studio[data-desktop="true"] .crucible-studio-menubar {
  -webkit-app-region: drag;
  pointer-events: auto;
  padding-inline-end: 146px;
}
.crucible-studio[data-desktop="true"] .crucible-studio-menubar button,
.crucible-studio[data-desktop="true"] .crucible-studio-menubar a,
.crucible-studio[data-desktop="true"] .crucible-studio-menubar [popover],
.crucible-studio[data-desktop="true"] .crucible-studio-menubar input {
  -webkit-app-region: no-drag;
}
.crucible-studio-brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 32px;
  block-size: 32px;
  border-radius: 8px;
  color: var(--studio-text);
}
.crucible-studio-brand svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.crucible-studio button.crucible-studio-filepill {
  display: inline-block;
  max-inline-size: 220px;
  padding: 4px 8px;
  font-family: var(--studio-font-heading);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: -0.01em;
  line-height: 22px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crucible-studio-filepill[data-dirty="true"]::after {
  content: "";
  display: inline-block;
  inline-size: 6px;
  block-size: 6px;
  margin-inline-start: 7px;
  border-radius: 999px;
  background: var(--studio-accent);
  vertical-align: middle;
}
.crucible-studio-watch-pill {
  inline-size: 8px;
  block-size: 8px;
  margin-inline: 2px 8px;
  border-radius: 999px;
  background: var(--studio-ok);
  flex-shrink: 0;
}
.crucible-studio-watch-pill[hidden] { display: none; }
.crucible-studio-spacer { flex: 1 1 auto; }
.crucible-studio button.crucible-studio-primary-btn {
  padding-inline: 12px 14px;
  background: var(--studio-text);
  color: var(--studio-bg);
  font-weight: 600;
}
@media (hover: hover) {
  .crucible-studio button.crucible-studio-primary-btn:not([aria-disabled="true"]):hover {
    background: color-mix(in srgb, var(--studio-text) 86%, var(--studio-bg));
  }
}

.crucible-studio-popover {
  margin: 0;
  inset: auto;
  padding: 6px;
  min-width: 224px;
  max-width: 280px;
  border: 1px solid var(--studio-border);
  border-radius: 13px;
  background: var(--studio-panel);
  color: var(--studio-text);
  box-shadow: var(--studio-shadow);
  pointer-events: auto;
  -webkit-app-region: no-drag;
}
.crucible-studio-popover:popover-open {
  display: grid;
  gap: 2px;
}
.crucible-studio-popover-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
}
.crucible-studio-popover button {
  justify-content: flex-start;
  width: 100%;
  padding: 6px 10px;
  text-align: left;
}
.crucible-studio-popover-note {
  margin: 8px 10px 2px;
  font-size: 11.5px;
  color: var(--studio-muted);
  line-height: 1.4;
  word-break: break-word;
}

.crucible-studio-toolbar {
  position: absolute;
  inset-block-start: var(--studio-top);
  inset-inline-start: var(--studio-edge);
  flex-direction: column;
  gap: 18px;
  z-index: 5;
}
.crucible-studio-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.crucible-studio-dock {
  position: absolute;
  inset-block-start: var(--studio-top);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--studio-border);
  border-radius: 13px;
  background: var(--studio-panel);
  box-shadow: var(--studio-shadow);
  overflow: hidden;
  z-index: 4;
}
/* Scene above, Properties below, in one column across from the tools. It stops above the view widget in the corner. */
.crucible-studio-side {
  position: absolute;
  inset-block: var(--studio-top) 100px;
  inset-inline-end: var(--studio-edge);
  inline-size: 284px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
  z-index: 4;
}
.crucible-studio-side > .crucible-studio-dock {
  position: static;
  flex: 0 1 auto;
  pointer-events: auto;
}
.crucible-studio-side > .crucible-studio-outliner {
  flex-shrink: 0;
  max-block-size: 42%;
}
.crucible-studio-outliner {
  inset-inline-start: calc(var(--studio-edge) * 2 + var(--studio-rail));
}
.crucible-studio-inspector {
  inset-inline-end: var(--studio-edge);
}
.crucible-studio[data-readout="off"] .crucible-studio-readout,
.crucible-studio[data-view-widget="off"] .crucible-studio-view-widget {
  display: none;
}
.crucible-studio[data-outliner-collapsed="true"] .crucible-studio-outliner,
.crucible-studio[data-inspector-collapsed="true"] .crucible-studio-inspector {
  display: none;
}
.crucible-studio-dock-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 4px 12px;
  font-family: var(--studio-font-heading);
  font-weight: 600;
  font-size: 13px;
}
.crucible-studio-dock-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.crucible-studio-dock-title .crucible-studio-icon {
  inline-size: 15px;
  block-size: 15px;
}
.crucible-studio-filter {
  position: relative;
  flex: 1 1 auto;
  min-inline-size: 0;
  display: flex;
  align-items: center;
}
.crucible-studio-filter .crucible-studio-icon {
  position: absolute;
  inset-inline-start: 8px;
  inline-size: 13px;
  block-size: 13px;
  color: var(--studio-muted);
  pointer-events: none;
}
.crucible-studio .crucible-studio-dock-head .crucible-studio-filter input {
  inline-size: 100%;
  padding-inline-start: 27px;
}
.crucible-studio-dock-head input {
  flex: 1 1 auto;
  min-inline-size: 0;
  font-family: var(--studio-font);
  font-weight: 400;
  font-size: 12px;
}
.crucible-studio-tree {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 4px 6px 8px;
  display: grid;
  align-content: start;
  gap: 1px;
}
.crucible-studio-tree-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 2px 0 6px;
  border-radius: 8px;
}
.crucible-studio-tree-row[data-selected="true"] {
  background: color-mix(in srgb, var(--studio-text) 11%, transparent);
}
@media (hover: hover) {
  .crucible-studio-tree-row:not([data-selected="true"]):hover {
    background: color-mix(in srgb, var(--studio-text) 6%, transparent);
  }
  .crucible-studio .crucible-studio-tree .crucible-studio-tree-row button:hover {
    background: transparent;
  }
  .crucible-studio .crucible-studio-tree .crucible-studio-tree-row button.crucible-studio-tree-eye:hover {
    color: var(--studio-text);
  }
}
.crucible-studio button.crucible-studio-tree-select {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-start;
  padding: 2px 4px;
  background: transparent;
  overflow: hidden;
}
.crucible-studio-tree-select[data-hidden="true"] { color: var(--studio-muted); }
.crucible-studio-tree-badge {
  inline-size: 15px;
  block-size: 15px;
  stroke: var(--studio-text);
  stroke-width: 1.6;
  fill-opacity: 0.45;
}
.crucible-studio-tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.crucible-studio button.crucible-studio-tree-eye {
  min-inline-size: 28px;
  min-block-size: 28px;
  inline-size: 28px;
  color: var(--studio-muted);
  opacity: 0;
}
.crucible-studio-tree-row:hover .crucible-studio-tree-eye,
.crucible-studio-tree-row:focus-within .crucible-studio-tree-eye,
.crucible-studio-tree-row[data-selected="true"] .crucible-studio-tree-eye,
.crucible-studio-tree-eye[data-hidden="true"] { opacity: 1; }
@media (hover: none) {
  .crucible-studio button.crucible-studio-tree-eye { opacity: 1; }
}
.crucible-studio-palette-section {
  padding: 8px 12px 12px;
}
.crucible-studio-swatches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.crucible-studio button.crucible-studio-swatch-btn,
.crucible-studio button.crucible-studio-swatch-add {
  min-inline-size: 24px;
  min-block-size: 24px;
  inline-size: 24px;
  block-size: 24px;
  padding: 0;
  border-radius: 999px;
}
.crucible-studio button.crucible-studio-swatch-btn {
  border: 1px solid var(--studio-border);
}
.crucible-studio button.crucible-studio-swatch-btn[aria-pressed="true"] {
  box-shadow: 0 0 0 2px var(--studio-panel), 0 0 0 3.5px var(--studio-text);
}
.crucible-studio button.crucible-studio-swatch-add {
  color: var(--studio-muted);
  border: 1px dashed color-mix(in srgb, var(--studio-text) 30%, transparent);
}
.crucible-studio-swatch-add .crucible-studio-icon {
  inline-size: 13px;
  block-size: 13px;
}

.crucible-studio-hintbar {
  position: absolute;
  inset-inline-start: 50%;
  inset-block-end: 76px;
  transform: translateX(-50%);
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--studio-panel);
  border: 1px solid var(--studio-border);
  color: var(--studio-text);
  box-shadow: var(--studio-shadow);
  font-family: var(--studio-font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  z-index: 3;
}
.crucible-studio-hintbar:empty { display: none; }
.crucible-studio-status {
  position: absolute;
  inset-inline-start: 50%;
  /* Under the top bar: the workspace tabs hold its centre. */
  inset-block-start: var(--studio-top);
  transform: translateX(-50%);
  max-inline-size: calc(100% - 420px);
  margin: 0;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--studio-panel);
  border: 1px solid var(--studio-border);
  box-shadow: var(--studio-shadow);
  font-size: 12px;
  color: var(--studio-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  z-index: 7;
}
.crucible-studio-status:empty { display: none; }

.crucible-studio-tablist {
  display: flex;
  gap: 2px;
  padding: 5px;
}
.crucible-studio-tablist[hidden],
.crucible-studio .crucible-studio-tablist button[hidden] {
  display: none;
}
/* Centred on the window, between the file name and the export side. Below the compact width there is no room for
   that, so the tabs join the row and only the open one keeps its name. */
.crucible-studio-workspaces {
  position: absolute;
  inset-inline-start: 50%;
  transform: translateX(-50%);
}
.crucible-studio[data-compact="true"] .crucible-studio-workspaces {
  position: static;
  transform: none;
}
.crucible-studio[data-compact="true"] .crucible-studio-workspaces button[aria-selected="false"] .crucible-studio-workspace-label {
  display: none;
}
.crucible-studio[data-compact="true"] .crucible-studio-workspaces button[aria-selected="false"] {
  padding-inline: 8px;
}
.crucible-studio-workspaces .crucible-studio-icon {
  inline-size: 15px;
  block-size: 15px;
}
.crucible-studio-workspaces button {
  position: relative;
  padding-inline: 12px;
  font-family: var(--studio-font-heading);
  font-weight: 600;
  font-size: 13px;
  color: var(--studio-muted);
}
.crucible-studio-workspaces button[aria-selected="true"] {
  color: var(--studio-text);
}
.crucible-studio-workspaces button[aria-selected="true"]::after {
  content: "";
  position: absolute;
  inset-inline-start: calc(50% - 2px);
  inset-block-end: 1px;
  inline-size: 4px;
  block-size: 4px;
  border-radius: 999px;
  background: var(--studio-accent);
}
.crucible-studio-tablist button {
  position: relative;
  flex: 1 1 0;
  inline-size: auto;
  color: var(--studio-muted);
}
.crucible-studio-tablist button[aria-selected="true"] {
  color: var(--studio-text);
  background: color-mix(in srgb, var(--studio-text) 11%, transparent);
}
.crucible-studio-tablist button[aria-selected="true"]::after {
  content: "";
  position: absolute;
  inset-inline-start: calc(50% - 2px);
  inset-block-end: 2px;
  inline-size: 4px;
  block-size: 4px;
  border-radius: 999px;
  background: var(--studio-accent);
}
.crucible-studio-panels {
  flex: 1 1 auto;
  overflow-y: auto;
}
.crucible-studio-panel-body {
  display: grid;
  gap: 14px;
  padding: 8px 12px 14px;
}
.crucible-studio-name-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.crucible-studio-name-row input {
  flex: 1 1 auto;
  min-inline-size: 0;
  margin-inline-end: 4px;
  font-family: var(--studio-font-heading);
  font-weight: 600;
}
.crucible-studio-field {
  display: grid;
  gap: 6px;
}
.crucible-studio-field-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--studio-muted);
}
.crucible-studio-field output {
  font-variant-numeric: tabular-nums;
  color: var(--studio-text);
}
.crucible-studio-vector {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.crucible-studio-vector label {
  display: grid;
  gap: 3px;
  font-size: 11px;
  color: var(--studio-muted);
}
.crucible-studio-axis-scrub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: ew-resize;
  font-weight: 600;
}
.crucible-studio input[type="number"],
.crucible-studio input[type="text"],
.crucible-studio input[type="search"],
.crucible-studio select,
.crucible-studio textarea {
  width: 100%;
  min-block-size: 30px;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: color-mix(in srgb, var(--studio-text) 7%, transparent);
  color: var(--studio-text);
  font-variant-numeric: tabular-nums;
}
.crucible-studio select {
  appearance: none;
  padding-inline-end: 26px;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--studio-muted) 50%),
    linear-gradient(135deg, var(--studio-muted) 50%, transparent 50%);
  background-position: calc(100% - 15px) 13px, calc(100% - 10px) 13px;
  background-size: 5px 5px;
  background-repeat: no-repeat;
}
.crucible-studio select option {
  background: var(--studio-panel);
  color: var(--studio-text);
}
.crucible-studio input[type="range"] {
  width: 100%;
  accent-color: var(--studio-text);
  cursor: pointer;
}
.crucible-studio-field:has(> input[type="color"]) {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.crucible-studio input[type="color"] {
  width: 44px;
  height: 28px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--studio-border);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.crucible-studio-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.crucible-studio-chips button,
.crucible-studio-panel-body > button,
.crucible-studio-bookmark-row button,
.crucible-studio-viewcube button {
  background: color-mix(in srgb, var(--studio-text) 6%, transparent);
}
.crucible-studio-chips button[aria-pressed="true"],
.crucible-studio-viewcube button[aria-pressed="true"] {
  background: var(--studio-text);
  color: var(--studio-bg);
}
.crucible-studio button.crucible-studio-mini-btn {
  min-inline-size: 24px;
  min-block-size: 24px;
  inline-size: 24px;
  color: var(--studio-muted);
}
.crucible-studio button.crucible-studio-mini-btn[aria-pressed="true"] { color: var(--studio-text); }
.crucible-studio-mini-btn .crucible-studio-icon {
  inline-size: 14px;
  block-size: 14px;
}
.crucible-studio-viewcube {
  display: grid;
  gap: 4px;
}
.crucible-studio-viewcube-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}
.crucible-studio-viewcube button {
  min-inline-size: 0;
  padding: 3px 6px;
  font-size: 11.5px;
}
.crucible-studio-sunpad {
  width: 120px;
  height: 120px;
  justify-self: center;
  border-radius: 999px;
  background: radial-gradient(circle at 50% 50%, var(--studio-surface), var(--studio-bg));
  border: 1px solid var(--studio-border);
  cursor: crosshair;
  touch-action: none;
}
.crucible-studio-bookmark-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.crucible-studio-bookmark-row button { flex-shrink: 0; }
.crucible-studio-bookmark-row button:first-child {
  flex: 1;
  justify-content: flex-start;
}

.crucible-studio-bottombar {
  position: absolute;
  inset-inline-start: 50%;
  inset-block-end: var(--studio-edge);
  transform: translateX(-50%);
  inline-size: min(620px, calc(100% - var(--studio-edge) * 2));
  gap: 8px;
  z-index: 5;
}
.crucible-studio:not([data-workspace="animate"]) .crucible-studio-bottombar {
  display: none;
}
.crucible-studio[data-workspace="animate"] .crucible-studio-readout,
.crucible-studio[data-workspace="animate"]:not([data-compact="true"]) .crucible-studio-view-widget {
  inset-block-end: calc(var(--studio-edge) + var(--studio-bar-clear));
}
/* Raised above the timeline, the readout would meet the tool rail in a short window, so there it stands beside it. */
.crucible-studio[data-workspace="animate"] .crucible-studio-readout {
  inset-inline-start: calc(var(--studio-edge) * 2 + var(--studio-rail));
}
.crucible-studio[data-workspace="animate"]:not([data-compact="true"]) .crucible-studio-side {
  inset-block-end: calc(100px + var(--studio-bar-clear));
}
.crucible-studio-scrub {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 240px;
  min-inline-size: 0;
}
.crucible-studio-scrub input[type="range"] {
  flex: 1 1 auto;
  min-inline-size: 60px;
  margin-inline: 6px;
}
.crucible-studio-scrub output {
  white-space: nowrap;
  flex-shrink: 0;
  padding-inline-end: 8px;
  font-family: var(--studio-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
  color: var(--studio-muted);
}
.crucible-studio-shots {
  display: flex;
  gap: 4px;
  max-inline-size: 42%;
  overflow: hidden;
}
.crucible-studio-shots:empty { display: none; }
.crucible-studio-shots button {
  min-block-size: 28px;
  padding: 2px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--studio-text) 7%, transparent);
  font-size: 11.5px;
}

.crucible-studio[data-compact="true"] .crucible-studio-side { display: contents; }
.crucible-studio[data-compact="true"] .crucible-studio-side > .crucible-studio-dock { position: absolute; }
.crucible-studio[data-compact="true"] .crucible-studio-outliner {
  inline-size: min(228px, calc(100% - var(--studio-edge) * 3 - var(--studio-rail)));
  max-block-size: min(300px, calc(100% - var(--studio-top) - 84px));
  z-index: 5;
}
.crucible-studio[data-compact="true"] .crucible-studio-inspector {
  inset-block-start: auto;
  inset-block-end: 72px;
  inset-inline: var(--studio-edge);
  inline-size: auto;
  max-block-size: min(40%, 320px);
}
.crucible-studio[data-compact="true"] .crucible-studio-shots { display: none; }
.crucible-studio[data-compact="true"] .crucible-studio-status {
  inset-block-start: var(--studio-top);
  max-inline-size: calc(100% - 140px);
}
.crucible-studio[data-compact="true"] button.crucible-studio-filepill { max-inline-size: 190px; }

.crucible-studio dialog {
  width: min(560px, calc(100vw - 32px));
  padding: 18px;
  border: 1px solid var(--studio-border);
  border-radius: 14px;
  background: var(--studio-panel);
  color: var(--studio-text);
}
.crucible-studio dialog h2 {
  margin: 0 0 10px;
  font-family: var(--studio-font-heading);
  font-size: 15px;
}
.crucible-studio dialog:modal {
  overscroll-behavior: contain;
}
.crucible-studio dialog::backdrop {
  background: color-mix(in srgb, var(--studio-bg) 74%, transparent);
  overflow: hidden;
  overscroll-behavior: contain;
}
.crucible-studio-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.crucible-studio dialog button {
  background: color-mix(in srgb, var(--studio-text) 7%, transparent);
}
.crucible-studio dialog.crucible-studio-settings-dialog {
  width: min(380px, calc(100vw - 32px));
}
.crucible-studio-settings {
  display: grid;
  gap: 2px;
  font-size: 12.5px;
}
.crucible-studio-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-block-size: 34px;
}
.crucible-studio-setting select {
  inline-size: 132px;
}
.crucible-studio-setting input[type="checkbox"] {
  inline-size: 16px;
  block-size: 16px;
  margin: 0;
  accent-color: var(--studio-text);
}
.crucible-studio-shortcuts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 16px;
  font-size: 12.5px;
}
.crucible-studio-shortcut-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.crucible-studio kbd {
  padding: 2px 6px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--studio-text) 8%, transparent);
  font-family: var(--studio-font-mono);
  font-size: 11px;
  color: var(--studio-text);
  white-space: nowrap;
}
.crucible-studio dialog.crucible-studio-shortcuts-dialog {
  width: min(680px, calc(100vw - 32px));
}
@media (forced-colors: active) {
  .crucible-studio button[aria-pressed="true"] {
    outline: 2px solid Highlight;
  }
}
`;
