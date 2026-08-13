import { renderTimelineSVG } from './timeline-render.js';
import { validatePaper } from './schema-validate.js';

// ===========================================================================
// State
//
// `state` is the single source of truth: a plain object matching the paper
// schema. Every form control reads its initial value from `state` and writes
// changes straight back into it (see the DOM helpers below) -- there is no
// separate "form model", to keep this file's data flow in one direction:
// state -> DOM on render, DOM -> state on input.
// ===========================================================================

function emptyPaper() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: '',
    title: '',
    authors: [],
    venue: '',
    status: 'planning',
    createdAt: today,
    updatedAt: today,
    timeline: { start: '', end: '' },
    milestones: [],
    slots: [],
    events: [],
    processes: [],
  };
}

let state = emptyPaper();

/**
 * Generates an id that cannot collide with any id already present in the
 * currently loaded paper. A plain "m1, m2, ..." counter would repeat ids
 * that already exist when adding rows to an imported/loaded paper rather
 * than a fresh one, so uniqueness is checked against the live state instead.
 */
function nextLocalId(prefix) {
  const existingIds = new Set([
    ...state.milestones.map((m) => m.id),
    ...state.slots.map((s) => s.id),
    ...state.events.map((e) => e.id),
    ...state.processes.map((p) => p.id),
  ]);
  let n = 1;
  while (existingIds.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/**
 * Fills in any array fields missing from a freshly loaded/imported paper
 * (e.g. a hand-written file that omits an empty `events: []`) so the rest
 * of the editor can assume all four list fields always exist.
 */
function normalizeLoadedPaper(paper) {
  paper.milestones ||= [];
  paper.slots ||= [];
  paper.events ||= [];
  paper.processes ||= [];
  return paper;
}

// ===========================================================================
// Generic DOM helpers
// ===========================================================================

/** Wraps an input/select with its <label> in a labeled field block. */
function field(labelText, inputEl) {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.append(label, inputEl);
  return wrap;
}

/** A two-column grid row, used to pair related fields (e.g. start/end). */
function row(...children) {
  const el = document.createElement('div');
  el.className = 'row';
  el.append(...children);
  return el;
}

function textInput(value, onChange, type = 'text') {
  const input = document.createElement('input');
  input.type = type;
  input.value = value ?? '';
  input.addEventListener('input', () => { onChange(input.value); schedulePreview(); });
  return input;
}

function selectInput(value, options, onChange) {
  const select = document.createElement('select');
  options.forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    opt.selected = val === value;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => { onChange(select.value); schedulePreview(); });
  return select;
}

function checkboxField(labelText, checked, onChange) {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.className = 'inline-label';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.addEventListener('change', () => { onChange(checkbox.checked); schedulePreview(); });
  label.append(checkbox, document.createTextNode(labelText));
  wrap.appendChild(label);
  return wrap;
}

function removeButton(onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'danger remove-btn';
  btn.textContent = 'Remove';
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Renders one "repeating section" (milestones, slots, events, processes):
 * clears the container, then for each item creates a `.repeat-item` card
 * with a remove button plus whatever fields `buildItemBody` appends. This
 * is the one piece of layout shared by all four sections; the field lists
 * themselves differ per section and stay in their own render function
 * below, rather than being flattened into a single generic config object --
 * that would save a few more lines but make each section's actual fields
 * harder to scan at a glance.
 */
function renderRepeatingSection(containerId, items, buildItemBody, onRemove) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  items.forEach((item, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'repeat-item';
    wrap.appendChild(removeButton(() => onRemove(index)));
    buildItemBody(wrap, item);
    container.appendChild(wrap);
  });
}

// ===========================================================================
// Repeating sections: milestones, slots, events, processes
// ===========================================================================

function renderMilestones() {
  renderRepeatingSection('milestones-list', state.milestones, (wrap, m) => {
    wrap.append(
      row(
        field('Label', textInput(m.label, (v) => (m.label = v))),
        field('Date', textInput(m.date, (v) => (m.date = v), 'date')),
      ),
      row(
        field('Type', selectInput(m.type, [
          ['deadline', 'Deadline'],
          ['event', 'Event'],
        ], (v) => (m.type = v))),
        field('Status (blank = auto)', selectInput(m.status || '', [
          ['', 'Auto'],
          ['pending', 'Pending'],
          ['done', 'Done'],
          ['overdue', 'Overdue'],
        ], (v) => (m.status = v || undefined))),
      ),
      field('Note', textInput(m.note || '', (v) => (m.note = v || undefined))),
    );
  }, (index) => {
    state.milestones.splice(index, 1);
    renderMilestones();
    schedulePreview();
  });
}

function renderSlots() {
  renderRepeatingSection('slots-list', state.slots, (wrap, s) => {
    wrap.append(
      field('Label', textInput(s.label, (v) => (s.label = v))),
      row(
        field('Start', textInput(s.start, (v) => (s.start = v), 'date')),
        field('End', textInput(s.end, (v) => (s.end = v), 'date')),
      ),
      field('Status (blank = auto)', selectInput(s.status || '', [
        ['', 'Auto'],
        ['upcoming', 'Upcoming'],
        ['active', 'Active'],
        ['done', 'Done'],
        ['cancelled', 'Cancelled'],
      ], (v) => (s.status = v || undefined))),
      field('Note', textInput(s.note || '', (v) => (s.note = v || undefined))),
    );
  }, (index) => {
    state.slots.splice(index, 1);
    renderSlots();
    schedulePreview();
  });
}

function renderEvents() {
  renderRepeatingSection('events-list', state.events, (wrap, e) => {
    wrap.append(
      row(
        field('Label', textInput(e.label, (v) => (e.label = v))),
        field('Date', textInput(e.date, (v) => (e.date = v), 'date')),
      ),
      field('Note', textInput(e.note || '', (v) => (e.note = v || undefined))),
    );
  }, (index) => {
    state.events.splice(index, 1);
    renderEvents();
    schedulePreview();
  });
}

function renderProcesses() {
  renderRepeatingSection('processes-list', state.processes, (wrap, p) => {
    wrap.append(
      row(
        field('Label', textInput(p.label, (v) => (p.label = v))),
        field('Since', textInput(p.since || '', (v) => (p.since = v || undefined), 'date')),
      ),
      checkboxField('Currently active', p.active !== false, (checked) => (p.active = checked)),
      field('Note', textInput(p.note || '', (v) => (p.note = v || undefined))),
    );
  }, (index) => {
    state.processes.splice(index, 1);
    renderProcesses();
    schedulePreview();
  });
}

function renderAllLists() {
  renderMilestones();
  renderSlots();
  renderEvents();
  renderProcesses();
}

// ===========================================================================
// Top-level form <-> state
// ===========================================================================

const TOP_LEVEL_FIELD_IDS = ['f-id', 'f-title', 'f-authors', 'f-venue', 'f-status', 'f-start', 'f-end'];

function bindTopLevelForm() {
  TOP_LEVEL_FIELD_IDS.forEach((id) => document.getElementById(id).addEventListener('input', syncTopLevelFromForm));
  document.getElementById('f-status').addEventListener('change', syncTopLevelFromForm);
}

function syncTopLevelFromForm() {
  state.id = document.getElementById('f-id').value.trim();
  state.title = document.getElementById('f-title').value;
  state.authors = document.getElementById('f-authors').value.split(',').map((s) => s.trim()).filter(Boolean);
  state.venue = document.getElementById('f-venue').value;
  state.status = document.getElementById('f-status').value;
  state.timeline.start = document.getElementById('f-start').value;
  state.timeline.end = document.getElementById('f-end').value;
  state.updatedAt = new Date().toISOString().slice(0, 10);
  schedulePreview();
}

/** Pushes `state` into every form control and re-renders the four sections. Called after any full state replacement (load / template / import). */
function populateFormFromState() {
  document.getElementById('f-id').value = state.id || '';
  document.getElementById('f-title').value = state.title || '';
  document.getElementById('f-authors').value = (state.authors || []).join(', ');
  document.getElementById('f-venue').value = state.venue || '';
  document.getElementById('f-status').value = state.status || 'planning';
  document.getElementById('f-start').value = state.timeline?.start || '';
  document.getElementById('f-end').value = state.timeline?.end || '';
  renderAllLists();
  schedulePreview();
}

// ===========================================================================
// Live preview + validation
// ===========================================================================

const PREVIEW_DEBOUNCE_MS = 150;
let previewTimer = null;

/** Debounced so a fast typist doesn't re-render the SVG on every keystroke. */
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, PREVIEW_DEBOUNCE_MS);
}

function renderPreview() {
  const card = document.getElementById('preview-card');
  const { valid } = validatePaper(state);
  const hasMinimumForPreview = valid && state.timeline.start && state.timeline.end && state.milestones.length > 0;
  if (!hasMinimumForPreview) {
    card.innerHTML = '<p class="empty-note">Add a title, timeline start/end, and at least one milestone to see the preview.</p>';
    return;
  }
  try {
    card.innerHTML = renderTimelineSVG(state);
  } catch (err) {
    card.innerHTML = `<p class="empty-note">Preview error: ${err.message}</p>`;
  }
}

/** Runs full schema validation and reports it in the validation box. Returns whether the paper is valid, so callers (e.g. download) can bail out. */
function runValidation() {
  const { valid, errors } = validatePaper(state);
  const out = document.getElementById('validation-output');
  out.innerHTML = valid
    ? '<div class="validation-box ok">Valid — matches the paper schema.</div>'
    : `<div class="validation-box error">${errors.length} issue(s) found:<ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`;
  return valid;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// ===========================================================================
// Export (download / copy)
// ===========================================================================

/**
 * Plain deep clone via JSON round-trip. `JSON.stringify` already drops any
 * key whose value is `undefined`, which is how optional fields (note,
 * status, venue, ...) get cleared throughout this editor -- see the
 * `|| undefined` pattern in the field handlers above -- so no extra
 * stripping logic is needed here.
 */
function cleanForExport(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ===========================================================================
// Loading an existing paper / template / imported file
//
// All three paths funnel through `loadPaper`, which is the one place that
// replaces `state` wholesale and re-renders the form -- keeping the
// normalization step (default empty arrays) in a single spot instead of
// repeated at each call site.
// ===========================================================================

function loadPaper(paper) {
  state = normalizeLoadedPaper(paper);
  populateFormFromState();
}

async function populateLoadSelect() {
  const select = document.getElementById('load-select');
  try {
    const res = await fetch('data/papers/index.json');
    const index = await res.json();
    (index.papers || []).forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
  } catch {
    // No index reachable (e.g. opened via file://) -- silently skip; the
    // "start from template" and "import" paths still work without it.
  }
  select.addEventListener('change', async () => {
    if (!select.value) return;
    const res = await fetch(`data/papers/${select.value}.json`);
    loadPaper(await res.json());
  });
}

async function loadTemplate() {
  const res = await fetch('data/template.json');
  loadPaper(await res.json());
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadPaper(JSON.parse(reader.result));
    } catch (err) {
      alert(`Could not parse that file as JSON: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

// ===========================================================================
// Wire up
// ===========================================================================

/** id prefix, default-values factory, and the render function for each "+ Add ..." button. */
const ADD_ITEM_CONFIG = {
  'add-milestone': {
    render: renderMilestones,
    create: () => ({ id: nextLocalId('m'), label: '', date: state.timeline.start || '', type: 'deadline' }),
    push: (item) => state.milestones.push(item),
  },
  'add-slot': {
    render: renderSlots,
    create: () => ({ id: nextLocalId('s'), label: '', start: state.timeline.start || '', end: state.timeline.end || '' }),
    push: (item) => state.slots.push(item),
  },
  'add-event': {
    render: renderEvents,
    create: () => ({ id: nextLocalId('e'), label: '', date: state.timeline.start || '' }),
    push: (item) => state.events.push(item),
  },
  'add-process': {
    render: renderProcesses,
    create: () => ({ id: nextLocalId('p'), label: '', active: true }),
    push: (item) => state.processes.push(item),
  },
};

function bindAddButtons() {
  for (const [buttonId, { render, create, push }] of Object.entries(ADD_ITEM_CONFIG)) {
    document.getElementById(buttonId).addEventListener('click', () => {
      push(create());
      render();
      schedulePreview();
    });
  }
}

function bindToolbarButtons() {
  document.getElementById('validate-btn').addEventListener('click', runValidation);

  document.getElementById('download-btn').addEventListener('click', () => {
    if (!state.id) { alert('Set an id first (used as the filename).'); return; }
    if (!runValidation()) return;
    downloadJson(`${state.id}.json`, cleanForExport(state));
  });

  document.getElementById('copy-btn').addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(cleanForExport(state), null, 2));
    const btn = document.getElementById('copy-btn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = original), 1200);
  });

  document.getElementById('download-index-btn').addEventListener('click', async () => {
    if (!state.id) { alert('Set an id first.'); return; }
    let index = { papers: [] };
    try {
      const res = await fetch('data/papers/index.json');
      index = await res.json();
    } catch {
      // No existing index reachable -- start a fresh one containing just this paper.
    }
    const paperIds = new Set(index.papers || []);
    paperIds.add(state.id);
    downloadJson('index.json', {
      _comment: index._comment || 'List every paper JSON filename (without .json) that should appear on the dashboard.',
      papers: Array.from(paperIds),
    });
  });

  document.getElementById('load-template-btn').addEventListener('click', loadTemplate);
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importFile(e.target.files[0]);
  });
}

function init() {
  bindTopLevelForm();
  bindAddButtons();
  bindToolbarButtons();
  populateLoadSelect();
  populateFormFromState();
}

init();
