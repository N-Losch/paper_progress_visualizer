import { renderTimelineSVG } from './timeline-render.js';
import { summarizePaper, todayUTC, formatDate } from './timeline-model.js';
import { validatePaper } from './schema-validate.js';
import { parsePaperIdFromHash, buildHashForPaper, shouldShowCard } from './paper-switcher.js';

const STATUS_TEXT = {
  planning: 'Planning',
  in_progress: 'In progress',
  submitted: 'Submitted',
  under_review: 'Under review',
  revision: 'Revision',
  accepted: 'Accepted',
  rejected: 'Rejected',
  published: 'Published',
};

const LEGEND = [
  ['done', 'Done'],
  ['active', 'Active'],
  ['upcoming', 'Upcoming'],
  ['overdue', 'Overdue'],
];

// ===========================================================================
// Small DOM helper
// ===========================================================================

/** Creates an element, applies attrs (special-cased `html` for innerHTML), and appends children. Keeps the render functions below free of repeated createElement/setAttribute boilerplate. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

// ===========================================================================
// Card sub-sections
// ===========================================================================

function renderLegend() {
  const container = document.getElementById('legend');
  container.innerHTML = LEGEND.map(([key, label]) =>
    `<span><span class="swatch" style="background:var(--${key})"></span>${label}</span>`
  ).join('');
}

function renderProcesses(processes) {
  if (!processes.length) {
    return el('p', { class: 'empty-note' }, [document.createTextNode('Nothing currently running.')]);
  }
  const list = el('div');
  processes.forEach((p) => {
    const item = el('div', { class: 'process-item' });
    item.appendChild(el('span', { class: 'dot' }));
    const label = document.createElement('span');
    label.textContent = p.label;
    item.appendChild(label);
    if (p.since) {
      const since = document.createElement('span');
      since.className = 'since';
      since.textContent = `since ${formatDate(p.since)}`;
      item.appendChild(since);
    }
    list.appendChild(item);
  });
  return list;
}

function renderEvents(events) {
  if (!events.length) {
    return el('p', { class: 'empty-note' }, [document.createTextNode('No logged events yet.')]);
  }
  const list = el('div');
  events.slice(0, 6).forEach((e) => {
    const item = el('div', { class: 'event-item' });
    const date = document.createElement('span');
    date.className = 'event-date';
    date.textContent = formatDate(e.date);
    item.appendChild(date);
    item.appendChild(document.createTextNode(e.label));
    list.appendChild(item);
  });
  return list;
}

// ===========================================================================
// Paper cards
// ===========================================================================

/** Full card for a paper that passed schema validation: header, SVG timeline, processes, and recent events. */
function renderPaperCard(paper) {
  const today = todayUTC();
  const { activeProcesses, events } = summarizePaper(paper, today);

  const card = el('article', { class: 'paper-card', 'data-paper-id': paper.id });

  const header = el('div', { class: 'paper-card-header' });
  const titleBlock = el('div');
  titleBlock.appendChild(el('h2', {}, [document.createTextNode(paper.title)]));
  const meta = el('p', { class: 'paper-meta' });
  meta.textContent = `${(paper.authors || []).join(', ')}${paper.venue ? ' · ' + paper.venue : ''}`;
  titleBlock.appendChild(meta);
  header.appendChild(titleBlock);
  header.appendChild(el('span', { class: 'status-pill' }, [document.createTextNode(STATUS_TEXT[paper.status] || paper.status)]));
  card.appendChild(header);

  const svgWrap = document.createElement('div');
  svgWrap.innerHTML = renderTimelineSVG(paper, today);
  card.appendChild(svgWrap);

  const twoCol = el('div', { class: 'two-col' });
  const procCol = el('div');
  procCol.appendChild(el('h3', {}, [document.createTextNode('Currently running')]));
  procCol.appendChild(renderProcesses(activeProcesses));
  const eventCol = el('div');
  eventCol.appendChild(el('h3', {}, [document.createTextNode('Recent events')]));
  eventCol.appendChild(renderEvents(events));
  twoCol.append(procCol, eventCol);
  card.appendChild(twoCol);

  return card;
}

/** Fallback card for a paper file that failed schema validation or failed to load, so one bad file can't take down the rest of the dashboard. */
function renderInvalidCard(filename, errors) {
  const card = el('article', { class: 'paper-card', 'data-paper-id': filename });
  card.style.borderLeftColor = 'var(--overdue)';
  card.appendChild(el('h2', {}, [document.createTextNode(`${filename}.json failed validation`)]));

  const box = el('div', { class: 'validation-box error quiet' });
  const list = document.createElement('ul');
  errors.forEach((message) => {
    const li = document.createElement('li');
    li.textContent = message;
    list.appendChild(li);
  });
  box.appendChild(document.createTextNode('This file was skipped:'));
  box.appendChild(list);
  card.appendChild(box);

  return card;
}

// ===========================================================================
// "Viewing: <paper>" switcher
//
// Filters the already-rendered cards by data-paper-id rather than
// re-fetching/re-rendering, and mirrors the selection into the URL hash
// (#paper=<id>) so a filtered view is bookmarkable/shareable even though
// this is a static site with nowhere else to persist UI state. The actual
// hash parsing/building and the show/hide decision are pure functions in
// paper-switcher.js so they have unit test coverage without needing a
// browser test runner.
// ===========================================================================

/** @param {{ id: string, title: string, valid: boolean }[]} papers */
function setupPaperSwitcher(papers) {
  const wrap = document.getElementById('paper-switcher');
  const select = document.getElementById('paper-select');

  if (papers.length === 0) {
    wrap.style.display = 'none';
    return;
  }

  select.innerHTML = '<option value="">All papers</option>' + papers
    .map((p) => `<option value="${p.id}">${p.valid ? p.title : `${p.id} (invalid)`}</option>`)
    .join('');
  wrap.style.display = 'flex';

  function applyFilter(selectedId) {
    document.querySelectorAll('#papers .paper-card').forEach((card) => {
      card.style.display = shouldShowCard(card.dataset.paperId, selectedId) ? '' : 'none';
    });
    select.value = selectedId || '';
  }

  select.addEventListener('change', () => {
    const selectedId = select.value;
    if (selectedId) location.hash = buildHashForPaper(selectedId);
    else history.replaceState(null, '', location.pathname + location.search);
    applyFilter(selectedId);
  });

  // Preselect from the URL on load, if it names a paper that's actually present.
  const initialId = parsePaperIdFromHash(location.hash);
  if (initialId && papers.some((p) => p.id === initialId)) {
    applyFilter(initialId);
  }
}

// ===========================================================================
// Entry point
// ===========================================================================

function renderTodayTag() {
  const tag = el('span', { class: 'today-tag' }, [document.createTextNode(`today: ${todayUTC().toISOString().slice(0, 10)}`)]);
  document.querySelector('.site-header').insertBefore(tag, document.querySelector('.site-nav'));
}

async function main() {
  renderLegend();
  renderTodayTag();

  const container = document.getElementById('papers');
  container.innerHTML = '';

  let index;
  try {
    const res = await fetch('data/papers/index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = await res.json();
  } catch (err) {
    container.appendChild(el('p', { class: 'empty-note' }, [document.createTextNode(`Could not load data/papers/index.json (${err.message}).`)]));
    return;
  }

  const filenames = index.papers || [];
  if (!filenames.length) {
    container.appendChild(el('p', { class: 'empty-note' }, [document.createTextNode('No papers yet. Use "Add / edit a paper" to create one.')]));
    return;
  }

  // Collected alongside the cards so the switcher's dropdown options can be
  // built once, after every file has been fetched and validated.
  const switcherEntries = [];

  for (const name of filenames) {
    try {
      const res = await fetch(`data/papers/${name}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const paper = await res.json();

      const { valid, errors } = validatePaper(paper);
      if (!valid) {
        container.appendChild(renderInvalidCard(name, errors));
        switcherEntries.push({ id: name, title: name, valid: false });
        continue;
      }

      container.appendChild(renderPaperCard(paper));
      switcherEntries.push({ id: paper.id, title: paper.title, valid: true });
    } catch (err) {
      container.appendChild(renderInvalidCard(name, [err.message]));
      switcherEntries.push({ id: name, title: name, valid: false });
    }
  }

  setupPaperSwitcher(switcherEntries);
}

main();
