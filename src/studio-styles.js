export const STUDIO_CSS = `
.crucible-studio {
  position: relative;
  display: grid;
  grid-template-rows: 42px minmax(0, 1fr) 46px;
  width: 100%;
  height: 100%;
  min-height: 540px;
  overflow: hidden;
  background: #13171b;
  color: #edf0ef;
  font-family: 'DM Sans', system-ui, sans-serif;
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
  background: #ffffff0a;
  cursor: pointer;
  white-space: nowrap;
}
.crucible-studio button[aria-pressed="true"] {
  background: #b7eddf22;
  border-color: #b7eddf66;
  color: #b7eddf;
}
.crucible-studio button[aria-disabled="true"] {
  opacity: 0.38;
  cursor: not-allowed;
}
.crucible-studio :focus-visible {
  outline: 2px solid #b7eddf;
  outline-offset: 2px;
}
@media (hover: hover) {
  .crucible-studio button:not([aria-disabled="true"]):hover {
    background: #ffffff18;
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
  background: #161a1f;
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
  color: #f4f7f6;
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
  background: #ffffff09;
  font-size: 12px;
  color: #cdd6d9;
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
  background: #23473e;
  color: #9bf0d8;
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
  background: #b7eddf26;
  border-color: #b7eddf55;
  color: #d6fff4;
  font-weight: 600;
}

.crucible-studio-popover {
  margin: 0;
  inset: auto;
  top: 44px;
  padding: 8px;
  min-width: 224px;
  border: 1px solid #ffffff1c;
  border-radius: 12px;
  background: #1d2228;
  color: #edf0ef;
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
  color: #9daab0;
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
  border: 1px solid #ffffff12;
  border-radius: 12px;
  background: #1b2025;
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
  background: #20262c;
  font-weight: 600;
  font-size: 12px;
  color: #dce4e6;
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
  background: #b7eddf1c;
  border-color: #b7eddf48;
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
  background: #171b20;
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
  border: 2px solid #ffffff30;
}
.crucible-studio-swatch-btn[aria-pressed="true"] {
  border-color: #b7eddf;
  box-shadow: 0 0 0 2px #171b20;
}

.crucible-studio-viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  border-radius: 12px;
  border: 1px solid #ffffff12;
  background: #121519;
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
  border: 2px dashed #b7eddf99;
  border-radius: 12px;
  background: #141a1fd9;
  color: #d8fff5;
  font-weight: 600;
  font-size: 14px;
  pointer-events: none;
  z-index: 8;
}
.crucible-studio-viewport[data-drop-active="true"] .crucible-studio-drop-overlay {
  display: grid;
}

.crucible-studio-surface {
  background: #1d2228e0;
  backdrop-filter: blur(14px);
  border: 1px solid #ffffff16;
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
  border-inline-start: 1px solid #ffffff22;
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
  background: #14181cb8;
  color: #9ba8ae;
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
  background: #161c21f2;
  border: 1px solid #b7eddf44;
  font-size: 12px;
  color: #b7eddf;
  pointer-events: none;
  z-index: 6;
}
.crucible-studio-status:empty { display: none; }

.crucible-studio-tablist {
  display: flex;
  gap: 2px;
  padding: 6px 8px 0;
  background: #20262c;
  overflow-x: auto;
  scrollbar-width: none;
}
.crucible-studio-tablist button {
  position: relative;
  flex: 1 0 auto;
  background: transparent;
  border-radius: 7px 7px 0 0;
  color: #9ca9af;
  font-size: 12px;
}
.crucible-studio-tablist button[aria-selected="true"] {
  color: #edf0ef;
}
.crucible-studio-tablist button[aria-selected="true"]::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: #b7eddf;
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
  color: #b4c0c5;
}
.crucible-studio-field output {
  font-variant-numeric: tabular-nums;
  color: #edf0ef;
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
  color: #96a4ac;
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
  border: 1px solid #ffffff1a;
  border-radius: 7px;
  background: #13171b;
  color: #edf0ef;
  font-variant-numeric: tabular-nums;
}
.crucible-studio input[type="range"] {
  width: 100%;
  accent-color: #b7eddf;
  cursor: pointer;
}
.crucible-studio input[type="color"] {
  width: 100%;
  height: 30px;
  padding: 2px;
  border: 1px solid #ffffff1a;
  border-radius: 7px;
  background: #13171b;
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
  background: radial-gradient(circle at 50% 50%, #24303a, #14191e);
  border: 1px solid #ffffff1e;
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
  background: #161a1f;
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
  color: #d6e0de;
}
.crucible-studio-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #9ba8ae;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.crucible-studio-gpu-badge {
  padding: 3px 8px;
  border-radius: 999px;
  background: #ffffff0a;
  color: #b7eddf;
  font-size: 11px;
}

.crucible-studio dialog {
  width: min(560px, calc(100vw - 32px));
  padding: 18px;
  border: 1px solid #ffffff20;
  border-radius: 14px;
  background: #1e242a;
  color: #edf0ef;
}
.crucible-studio dialog h2 {
  margin: 0 0 10px;
  font-size: 15px;
}
.crucible-studio dialog:modal {
  overscroll-behavior: contain;
}
.crucible-studio dialog::backdrop {
  background: #0b0e12bd;
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
  background: #ffffff07;
}
.crucible-studio kbd {
  padding: 2px 6px;
  border-radius: 5px;
  background: #111519;
  border: 1px solid #ffffff20;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #b7eddf;
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
