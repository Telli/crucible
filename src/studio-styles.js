export const STUDIO_CSS = `
.crucible-studio {
  position: relative;
  display: grid;
  grid-template-rows: 42px minmax(0, 1fr) 46px;
  width: 100%;
  height: 100%;
  min-height: 540px;
  overflow: hidden;
  --studio-bg: var(--site-bg, #17161a);
  --studio-panel: var(--site-sidebar, #201f24);
  --studio-surface: var(--site-surface, #2a282d);
  --studio-text: var(--site-text, #f1f0ec);
  --studio-muted: var(--site-muted, #a09ea6);
  --studio-border: var(--site-border, #fefefd1f);
  --studio-accent: var(--site-focus, #fc9132);
  --studio-font: Inter, system-ui, sans-serif;
  --studio-font-heading: 'Plus Jakarta Sans', Inter, system-ui, sans-serif;
  --studio-font-mono: 'JetBrains Mono', ui-monospace, monospace;
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
  gap: 5px;
  min-inline-size: 28px;
  min-block-size: 28px;
  padding: 4px 9px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: color-mix(in srgb, var(--studio-text) 4%, transparent);
  cursor: pointer;
  white-space: nowrap;
}
.crucible-studio button[aria-pressed="true"] {
  background: color-mix(in srgb, var(--studio-accent) 13%, transparent);
  border-color: color-mix(in srgb, var(--studio-accent) 40%, transparent);
  color: var(--studio-accent);
}
.crucible-studio button[aria-disabled="true"] {
  opacity: 0.38;
  cursor: not-allowed;
}
.crucible-studio :focus-visible {
  outline: 2px solid var(--studio-accent);
  outline-offset: 2px;
}
@media (hover: hover) {
  .crucible-studio button:not([aria-disabled="true"]):hover {
    background: color-mix(in srgb, var(--studio-text) 9%, transparent);
  }
}
@media (prefers-reduced-motion: no-preference) {
  .crucible-studio button {
    transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
  }
}
@media (pointer: coarse) {
  .crucible-studio button {
    min-inline-size: 40px;
    min-block-size: 40px;
  }
}

.crucible-studio-menubar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  background: var(--studio-bg);
  z-index: 6;
}
.crucible-studio[data-desktop="true"] .crucible-studio-menubar {
  -webkit-app-region: drag;
  padding-inline-end: 146px;
}
.crucible-studio[data-desktop="true"] .crucible-studio-menubar button,
.crucible-studio[data-desktop="true"] .crucible-studio-menubar [popover],
.crucible-studio[data-desktop="true"] .crucible-studio-menubar input {
  -webkit-app-region: no-drag;
}
.crucible-studio-brand {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: -0.02em;
  color: var(--studio-text);
  padding-inline-end: 4px;
}
.crucible-studio-brand svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.crucible-studio-filepill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 210px;
  padding: 4px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--studio-text) 4%, transparent);
  font-size: 12px;
  color: var(--studio-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.crucible-studio-watch-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--studio-surface);
  color: var(--studio-accent);
  font-size: 11px;
  font-weight: 600;
}
.crucible-studio-watch-pill[hidden] { display: none; }
.crucible-studio-menu-cluster {
  display: flex;
  align-items: center;
  gap: 4px;
}
.crucible-studio-spacer { flex: 1 1 auto; }
.crucible-studio-primary-btn {
  background: color-mix(in srgb, var(--studio-accent) 15%, transparent);
  border-color: color-mix(in srgb, var(--studio-accent) 33%, transparent);
  color: var(--studio-accent);
  font-weight: 600;
}

.crucible-studio-popover {
  margin: 0;
  inset: auto;
  top: 44px;
  padding: 8px;
  min-width: 224px;
  border: 1px solid color-mix(in srgb, var(--studio-text) 11%, transparent);
  border-radius: 12px;
  background: var(--studio-panel);
  color: var(--studio-text);
  box-shadow: 0 18px 40px #00000066;
}
.crucible-studio-popover:popover-open {
  display: grid;
  gap: 6px;
}
.crucible-studio-popover-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.crucible-studio-popover button {
  justify-content: flex-start;
  width: 100%;
  padding: 6px 10px;
  text-align: left;
}
.crucible-studio-popover-note {
  margin: 2px 4px;
  font-size: 11.5px;
  color: var(--studio-muted);
  line-height: 1.4;
  word-break: break-word;
}

.crucible-studio-workspace {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr) 296px;
  gap: 8px;
  padding: 8px;
  min-height: 0;
}
.crucible-studio[data-outliner-collapsed="true"] .crucible-studio-workspace {
  grid-template-columns: 0px minmax(0, 1fr) 296px;
}
.crucible-studio[data-inspector-collapsed="true"] .crucible-studio-workspace {
  grid-template-columns: 236px minmax(0, 1fr) 0px;
}
.crucible-studio[data-outliner-collapsed="true"][data-inspector-collapsed="true"] .crucible-studio-workspace {
  grid-template-columns: 0px minmax(0, 1fr) 0px;
}

.crucible-studio-dock {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid color-mix(in srgb, var(--studio-text) 7%, transparent);
  border-radius: 12px;
  background: var(--studio-panel);
  overflow: hidden;
}
.crucible-studio[data-outliner-collapsed="true"] .crucible-studio-outliner,
.crucible-studio[data-inspector-collapsed="true"] .crucible-studio-inspector {
  visibility: hidden;
  pointer-events: none;
  border-width: 0;
}
.crucible-studio-dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: var(--studio-panel);
  font-weight: 600;
  font-size: 12px;
  color: var(--studio-text);
}
.crucible-studio-search {
  padding: 8px 10px 4px;
}
.crucible-studio-tree {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 4px 8px 8px;
  display: grid;
  align-content: start;
  gap: 3px;
}
.crucible-studio-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
}
.crucible-studio-tree-row[data-selected="true"] {
  background: color-mix(in srgb, var(--studio-accent) 11%, transparent);
  border-color: color-mix(in srgb, var(--studio-accent) 28%, transparent);
}
.crucible-studio-tree-select {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-start;
  padding: 2px 4px;
  background: transparent;
  border: none;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crucible-studio-tree-select:hover { background: transparent !important; }
.crucible-studio-tree-badge {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.crucible-studio-tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.crucible-studio-tree-eye {
  min-inline-size: 26px;
  min-block-size: 26px;
  padding: 2px 6px;
  font-size: 11px;
}
.crucible-studio-palette-section {
  padding: 10px;
  background: var(--studio-bg);
  display: grid;
  gap: 8px;
}
.crucible-studio-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.crucible-studio-swatch-btn {
  min-inline-size: 26px;
  min-block-size: 26px;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--studio-text) 19%, transparent);
}
.crucible-studio-swatch-btn[aria-pressed="true"] {
  border-color: var(--studio-accent);
  box-shadow: 0 0 0 2px var(--studio-bg);
}

.crucible-studio-viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--studio-text) 7%, transparent);
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
.crucible-studio-drop-overlay {
  position: absolute;
  inset: 12px;
  display: none;
  place-items: center;
  border: 2px dashed color-mix(in srgb, var(--studio-accent) 60%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--studio-bg) 85%, transparent);
  color: var(--studio-accent);
  font-weight: 600;
  font-size: 14px;
  pointer-events: none;
  z-index: 8;
}
.crucible-studio-viewport[data-drop-active="true"] .crucible-studio-drop-overlay {
  display: grid;
}

.crucible-studio-surface {
  background: color-mix(in srgb, var(--studio-panel) 88%, transparent);
  backdrop-filter: blur(14px);
  border: 1px solid color-mix(in srgb, var(--studio-text) 9%, transparent);
  border-radius: 11px;
}
.crucible-studio-toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  padding: 5px;
  max-width: calc(100% - 210px);
  z-index: 4;
}
.crucible-studio-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.crucible-studio-separator {
  inline-size: 1px;
  block-size: 18px;
  margin-inline: 3px;
  border-inline-start: 1px solid color-mix(in srgb, var(--studio-text) 13%, transparent);
}
.crucible-studio-viewcube {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  gap: 5px;
  padding: 6px;
  z-index: 4;
}
.crucible-studio-viewcube-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}
.crucible-studio-viewcube button {
  min-inline-size: 32px;
  min-block-size: 26px;
  padding: 3px 6px;
  font-size: 11px;
}
.crucible-studio-hintbar {
  position: absolute;
  left: 12px;
  bottom: 12px;
  padding: 5px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--studio-bg) 72%, transparent);
  color: var(--studio-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  z-index: 3;
}
.crucible-studio-status {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  margin: 0;
  padding: 6px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--studio-bg) 95%, transparent);
  border: 1px solid color-mix(in srgb, var(--studio-accent) 27%, transparent);
  font-size: 12px;
  color: var(--studio-accent);
  pointer-events: none;
  z-index: 6;
}
.crucible-studio-status:empty { display: none; }

.crucible-studio-tablist {
  display: flex;
  gap: 2px;
  padding: 6px 8px 0;
  background: var(--studio-panel);
  overflow-x: auto;
  scrollbar-width: none;
}
.crucible-studio-tablist button {
  position: relative;
  flex: 1 0 auto;
  background: transparent;
  border-radius: 7px 7px 0 0;
  color: var(--studio-muted);
  font-size: 12px;
}
.crucible-studio-tablist button[aria-selected="true"] {
  color: var(--studio-text);
}
.crucible-studio-tablist button[aria-selected="true"]::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--studio-accent);
}
.crucible-studio-panels {
  flex: 1 1 auto;
  overflow-y: auto;
}
.crucible-studio-panel-body {
  display: grid;
  gap: 12px;
  padding: 12px;
}
.crucible-studio-field {
  display: grid;
  gap: 5px;
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
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--studio-text) 10%, transparent);
  border-radius: 7px;
  background: var(--studio-bg);
  color: var(--studio-text);
  font-variant-numeric: tabular-nums;
}
.crucible-studio input[type="range"] {
  width: 100%;
  accent-color: var(--studio-accent);
  cursor: pointer;
}
.crucible-studio input[type="color"] {
  width: 100%;
  height: 30px;
  padding: 2px;
  border: 1px solid color-mix(in srgb, var(--studio-text) 10%, transparent);
  border-radius: 7px;
  background: var(--studio-bg);
  cursor: pointer;
}
.crucible-studio-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.crucible-studio-sunpad {
  width: 120px;
  height: 120px;
  justify-self: center;
  border-radius: 999px;
  background: radial-gradient(circle at 50% 50%, var(--studio-surface), var(--studio-bg));
  border: 1px solid color-mix(in srgb, var(--studio-text) 12%, transparent);
  cursor: crosshair;
  touch-action: none;
}
.crucible-studio-bookmark-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.crucible-studio-bookmark-row button:first-child {
  flex: 1;
  justify-content: flex-start;
}

.crucible-studio-bottombar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: var(--studio-bg);
  z-index: 4;
}
.crucible-studio-scrub {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 240px;
}
.crucible-studio-scrub output {
  white-space: nowrap;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--studio-text);
}
.crucible-studio-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--studio-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.crucible-studio-gpu-badge {
  padding: 3px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--studio-text) 4%, transparent);
  color: var(--studio-accent);
  font-size: 11px;
}

.crucible-studio dialog {
  width: min(560px, calc(100vw - 32px));
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--studio-text) 13%, transparent);
  border-radius: 14px;
  background: var(--studio-panel);
  color: var(--studio-text);
}
.crucible-studio dialog h2 {
  margin: 0 0 10px;
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
.crucible-studio-shortcuts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  font-size: 12.5px;
}
.crucible-studio-shortcut-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--studio-text) 3%, transparent);
}
.crucible-studio kbd {
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--studio-bg);
  border: 1px solid color-mix(in srgb, var(--studio-text) 13%, transparent);
  font-family: var(--studio-font-mono);
  font-size: 11px;
  color: var(--studio-accent);
}
@media (max-width: 960px) {
  .crucible-studio-workspace {
    grid-template-columns: 0px minmax(0, 1fr) 264px;
  }
}
@media (forced-colors: active) {
  .crucible-studio button[aria-pressed="true"] {
    outline: 2px solid Highlight;
  }
}
`;
