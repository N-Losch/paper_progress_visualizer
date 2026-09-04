// timeline-render.js
// Builds the SVG timeline for a single paper. Deliberately framework-free:
// this is a static site, so a string-templated SVG is easier to audit and
// debug than a virtual-DOM layer would be.

import { parseDate, todayUTC, daysBetween, fractionForDate, summarizePaper, formatDate } from './timeline-model.js';

// ---------------------------------------------------------------------
// Layout constants
//
// Every pixel value the renderer uses lives here, named, rather than
// inline in the functions below -- the geometry is simple enough that a
// full layout engine would be overkill, but naming each offset still
// documents *why* it's that size and keeps the drawing functions
// readable as "place X relative to Y" instead of arithmetic on raw
// numbers.
// ---------------------------------------------------------------------
const WIDTH = 1000;
const AXIS_Y_MIN = 90; // shortest the chart top margin ever gets, for timelines with few milestones
const MARGIN_X = 40;

const MARKER_RADIUS = 7; // half-width of a milestone diamond/circle

// Milestone labels stack in rows above the axis, assigned by actual
// horizontal collision (see assignMilestoneRows) rather than a fixed
// even/odd alternation -- a cluster of milestones close together in date
// needs more rows than one spread evenly across the timeline.
const MILESTONE_LABEL_BASE_OFFSET = 18; // row 0's distance above the axis
const MILESTONE_LABEL_ROW_GAP = 28; // vertical step between stacked rows
const MILESTONE_DATE_LABEL_GAP = 13; // gap between a label and its date line above it
const MILESTONE_TOP_PADDING = 30; // clearance above the topmost label row (also keeps it clear of the "today" tag)
const MILESTONE_LABEL_CHAR_WIDTH = 6.1; // rough px/character at the label's 11px size -- just enough to keep same-row labels from overlapping, not real text measurement
const MILESTONE_LABEL_MIN_GAP = 14; // minimum horizontal breathing room enforced between two labels sharing a row

const SLOT_ROW_HEIGHT = 46; // vertical space allotted per slot bar
const SLOT_AREA_GAP = 34; // gap between the axis and the first slot row
const SLOT_BRACKET_HEIGHT = 18; // height of the "[ ... ]" bracket ends
const SLOT_LABEL_GAP = 14; // gap between a slot bar and its label above it
const BOTTOM_PADDING = 30;

const TICK_HALF_HEIGHT = 4;
const TICK_LABEL_GAP = 20;
const TARGET_TICK_COUNT = 7; // approximate number of date ticks along the axis

const TODAY_LINE_TOP = 16;
const TODAY_LINE_BOTTOM_GAP = 10;
const TODAY_LABEL_Y = 24;
const TODAY_LABEL_X_GAP = 6;

// Labels within this fraction of either edge switch text-anchor (start/end
// instead of middle) so they don't run past the SVG's viewBox.
const EDGE_ANCHOR_MARGIN = 0.08;

const STATUS_LABEL = {
  done: 'Done',
  active: 'Active',
  upcoming: 'Upcoming',
  pending: 'Pending',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

/** Maps a date onto its horizontal pixel position along the axis. */
function xFor(dateStr, start, end) {
  const f = fractionForDate(dateStr, start, end);
  return MARGIN_X + f * (WIDTH - 2 * MARGIN_X);
}

/** Picks a text-anchor so labels near either edge don't spill outside the viewBox. */
function anchorFor(x) {
  const f = (x - MARGIN_X) / (WIDTH - 2 * MARGIN_X);
  if (f < EDGE_ANCHOR_MARGIN) return 'start';
  if (f > 1 - EDGE_ANCHOR_MARGIN) return 'end';
  return 'middle';
}

/** Evenly-spaced ISO date ticks spanning [start, end], roughly TARGET_TICK_COUNT of them. */
function buildTickDates(start, end) {
  const startDate = parseDate(start);
  const totalDays = Math.max(1, daysBetween(startDate, parseDate(end)));
  const stepDays = Math.max(1, Math.round(totalDays / TARGET_TICK_COUNT));

  const ticks = [];
  for (let offset = 0; offset <= totalDays; offset += stepDays) {
    const d = new Date(startDate.getTime());
    d.setUTCDate(d.getUTCDate() + offset);
    ticks.push(d.toISOString().slice(0, 10));
  }
  return ticks;
}

// ---------------------------------------------------------------------
// Drawing functions -- each returns a fragment of SVG markup
// ---------------------------------------------------------------------

function drawAxis(axisY) {
  return `<line x1="${MARGIN_X}" y1="${axisY}" x2="${WIDTH - MARGIN_X}" y2="${axisY}" class="axis" />`;
}

function drawTicks(start, end, axisY) {
  return buildTickDates(start, end).map((iso) => {
    const x = xFor(iso, start, end);
    return `
      <line x1="${x}" y1="${axisY - TICK_HALF_HEIGHT}" x2="${x}" y2="${axisY + TICK_HALF_HEIGHT}" class="tick" />
      <text x="${x}" y="${axisY + TICK_LABEL_GAP}" class="tick-label" text-anchor="middle">${escapeXml(formatDate(iso))}</text>`;
  }).join('');
}

/** Dashed vertical line marking today, only drawn when today falls inside [start, end]. */
function drawTodayLine(start, end, today, chartHeight) {
  const inRange = today >= parseDate(start) && today <= parseDate(end);
  if (!inRange) return '';
  const todayIso = today.toISOString().slice(0, 10);
  const x = xFor(todayIso, start, end);
  return `
    <g class="today-marker">
      <line x1="${x}" y1="${TODAY_LINE_TOP}" x2="${x}" y2="${chartHeight - TODAY_LINE_BOTTOM_GAP}" class="today-line" />
      <text x="${x + TODAY_LABEL_X_GAP}" y="${TODAY_LABEL_Y}" class="today-label">today</text>
    </g>`;
}

/** Rough rendered width of a label, just precise enough to keep same-row labels from overlapping. */
function estimateLabelWidth(text) {
  return text.length * MILESTONE_LABEL_CHAR_WIDTH;
}

/** Left/right pixel extent of a label given its anchor point and text-anchor mode. */
function labelExtent(x, width, anchor) {
  if (anchor === 'start') return [x, x + width];
  if (anchor === 'end') return [x - width, x];
  return [x - width / 2, x + width / 2];
}

/**
 * Greedily stacks milestone labels into rows so none overlap horizontally.
 * Processes milestones left-to-right and places each into the lowest row
 * (closest to the axis) whose last-placed label doesn't collide with it,
 * opening a new row otherwise. This replaces a fixed even/odd alternation,
 * which avoided overlap only by coincidence: a cluster of milestones close
 * together in date (e.g. four deadlines within six weeks) would land in
 * just two rows regardless of how wide their labels actually were.
 */
function assignMilestoneRows(milestones, start, end) {
  const rowRightEdge = []; // rowRightEdge[i] = right edge of the last label placed in row i
  return milestones.map((m) => {
    const x = xFor(m.date, start, end);
    const anchor = anchorFor(x);
    const [left, right] = labelExtent(x, estimateLabelWidth(m.label), anchor);
    let row = 0;
    while (row < rowRightEdge.length && left - MILESTONE_LABEL_MIN_GAP < rowRightEdge[row]) row++;
    rowRightEdge[row] = right;
    return { ...m, x, anchor, row };
  });
}

/** A single milestone: a diamond (deadline) or circle (event) on the axis, with a leader line up to its label. */
function drawMilestone(milestone, axisY) {
  const { x, anchor, row } = milestone;
  const labelY = axisY - (MILESTONE_LABEL_BASE_OFFSET + row * MILESTONE_LABEL_ROW_GAP);
  const status = milestone.computedStatus;
  const statusClass = `status-${status}`;

  const shape = milestone.type === 'event'
    ? `<circle cx="${x}" cy="${axisY}" r="${MARKER_RADIUS}" class="marker ${statusClass}" />`
    : `<rect x="${x - MARKER_RADIUS}" y="${axisY - MARKER_RADIUS}" width="${MARKER_RADIUS * 2}" height="${MARKER_RADIUS * 2}" transform="rotate(45 ${x} ${axisY})" class="marker ${statusClass}" />`;

  const tooltip = [
    milestone.label,
    formatDate(milestone.date),
    STATUS_LABEL[status] || status,
    milestone.note,
  ].filter(Boolean).map(escapeXml).join(' — ');

  return `
    <g class="milestone" data-id="${escapeXml(milestone.id)}">
      <line x1="${x}" y1="${axisY}" x2="${x}" y2="${labelY + 6}" class="leader" />
      ${shape}
      <text x="${x}" y="${labelY}" class="milestone-label ${statusClass}" text-anchor="${anchor}">${escapeXml(milestone.label)}</text>
      <text x="${x}" y="${labelY - MILESTONE_DATE_LABEL_GAP}" class="milestone-date" text-anchor="${anchor}">${escapeXml(formatDate(milestone.date))}</text>
      <title>${tooltip}</title>
    </g>`;
}

/** Hand-drawn-style "[ ... ]" bracket path, echoing the sketch's time-slot marks. */
function bracketPath(x1, x2, y, height) {
  const halfHeight = height / 2;
  return `M ${x1} ${y - halfHeight} L ${x1} ${y + halfHeight} M ${x1} ${y} L ${x2} ${y} M ${x2} ${y - halfHeight} L ${x2} ${y + halfHeight}`;
}

/** A single slot: a bracketed bar spanning [start, end] on its own row. */
function drawSlot(slot, start, end, rowIndex, slotAreaTop) {
  const x1 = xFor(slot.start, start, end);
  const x2 = xFor(slot.end, start, end);
  const y = slotAreaTop + rowIndex * SLOT_ROW_HEIGHT + SLOT_ROW_HEIGHT / 2 - 7;
  const status = slot.computedStatus;
  const statusClass = `status-${status}`;
  const labelX = (x1 + x2) / 2;
  const anchor = anchorFor(labelX);

  const tooltip = [
    slot.label,
    `${formatDate(slot.start)} to ${formatDate(slot.end)}`,
    STATUS_LABEL[status] || status,
    slot.note,
  ].filter(Boolean).map(escapeXml).join(' — ');

  return `
    <g class="slot" data-id="${escapeXml(slot.id)}">
      <path d="${bracketPath(x1, x2, y, SLOT_BRACKET_HEIGHT)}" class="bracket ${statusClass}" />
      <rect x="${x1}" y="${y - 5}" width="${Math.max(2, x2 - x1)}" height="10" class="bracket-fill ${statusClass}" />
      <text x="${labelX}" y="${y - SLOT_LABEL_GAP}" class="slot-label" text-anchor="${anchor}">${escapeXml(slot.label)}</text>
      <title>${tooltip}</title>
    </g>`;
}

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

/**
 * Renders the full SVG timeline for one paper record.
 * @param {object} paper - a paper record that has already passed schema validation.
 * @param {Date} [today] - defaults to the real current date (UTC midnight); overridable for tests.
 * @returns {string} a self-contained `<svg>...</svg>` markup string.
 */
export function renderTimelineSVG(paper, today = todayUTC()) {
  const { start, end } = paper.timeline;
  const { milestones, slots } = summarizePaper(paper, today);

  const sortedMilestones = milestones.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const placedMilestones = assignMilestoneRows(sortedMilestones, start, end);

  // The chart's top margin grows to fit however many label rows a cluster
  // of nearby milestones needs, so labels never have to overlap each other.
  const maxRow = placedMilestones.reduce((max, m) => Math.max(max, m.row), 0);
  const axisY = Math.max(
    AXIS_Y_MIN,
    MILESTONE_LABEL_BASE_OFFSET + maxRow * MILESTONE_LABEL_ROW_GAP + MILESTONE_DATE_LABEL_GAP + MILESTONE_TOP_PADDING
  );
  const slotAreaTop = axisY + SLOT_AREA_GAP;

  // Chart also grows to fit however many slot rows this paper has, so bars
  // never have to overlap each other.
  const height = slotAreaTop + Math.max(1, slots.length) * SLOT_ROW_HEIGHT + BOTTOM_PADDING;

  const milestoneMarkup = placedMilestones.map((m) => drawMilestone(m, axisY)).join('');

  const slotMarkup = slots
    .slice()
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .map((s, i) => drawSlot(s, start, end, i, slotAreaTop))
    .join('');

  return `
<svg viewBox="0 0 ${WIDTH} ${height}" class="timeline-svg" role="img" aria-label="Timeline for ${escapeXml(paper.title)}">
  ${drawAxis(axisY)}
  ${drawTicks(start, end, axisY)}
  ${slotMarkup}
  ${milestoneMarkup}
  ${drawTodayLine(start, end, today, height)}
</svg>`;
}
