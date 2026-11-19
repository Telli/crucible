import './site.css';
import './brand.js';
import './tiers.css';
import data from '../bench/tiers/results/tier-page-lit-interior.json';
import { describeConditions, describeTier } from './tiers-model.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const TIER_ICONS = {
  draft: 'M13 3 5 13.5h6L10 21l8-10.5h-6z',
  realtime: 'M8 5.5v13l11-6.5z',
  'realtime-high': 'M8 5.5v13l11-6.5z',
  final: 'M12 3.5l2.4 5.6 6.1.5-4.6 4 1.4 6-5.3-3.2-5.3 3.2 1.4-6-4.6-4 6.1-.5z',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(pathData, className) {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  return svg;
}

function barRow(part, kind) {
  const row = element('div', `tiers-bar is-${kind}`);
  const label = element('span', 'tiers-bar-label');
  label.append(element('span', '', part.label), element('strong', '', part.value));
  const track = element('span', 'tiers-track');
  const fill = element('span', 'tiers-fill');
  fill.style.setProperty('--share', `${Math.max(part.share * 100, 1.5)}%`);
  track.append(fill);
  row.append(label, track);
  row.append(element('span', 'tiers-bar-note', part.range ? `${part.range} over runs` : part.note));
  return row;
}

function metricBlock(row) {
  const block = element('section', 'tiers-metric');
  block.append(element('h2', '', row.name), barRow(row.crucible, 'crucible'), barRow(row.blender, 'blender'));
  return block;
}

function plannedBlock(description) {
  const block = element('div', 'tiers-planned');
  block.append(icon('M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'tiers-planned-icon'));
  block.append(element('p', '', `Planned, not measured yet (#${description.issues.join(', #')})`));
  return block;
}

function renderPanel(panel, tierId) {
  const description = describeTier(data, tierId);
  panel.replaceChildren(...(description.status === 'planned' ? [plannedBlock(description)] : description.rows.map(metricBlock)));
}

function renderSwitch(container, panel) {
  const buttons = data.tiers.map(tier => {
    const button = element('button', `tiers-tab${tier.status === 'planned' ? ' is-planned' : ''}`);
    button.type = 'button';
    button.dataset.tier = tier.id;
    button.append(icon(TIER_ICONS[tier.id], 'tiers-tab-icon'), element('span', '', tier.id));
    button.addEventListener('click', () => select(tier.id));
    return button;
  });
  container.replaceChildren(...buttons);
  function select(tierId) {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.tier === tierId));
    renderPanel(panel, tierId);
    history.replaceState(null, '', `#${tierId}`);
  }
  return select;
}

function renderConditions(container) {
  const conditions = describeConditions(data);
  container.replaceChildren(element('span', '', conditions.hardware), element('span', '', conditions.software), element('span', '', `${conditions.scene}, ${conditions.size}`), element('span', '', `measured ${conditions.date}`));
}

const panel = document.getElementById('tiers-panel');
renderConditions(document.getElementById('tiers-conditions'));
const select = renderSwitch(document.getElementById('tiers-switch'), panel);
const requested = location.hash.slice(1);
select(data.tiers.some(tier => tier.id === requested) ? requested : data.tiers[0].id);
