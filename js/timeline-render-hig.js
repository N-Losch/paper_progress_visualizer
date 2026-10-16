// timeline-render-hig.js
// Alternative, Apple-HIG-styled rendering of a paper: headline tiles, a
// one-row-per-item timeline, and grouped lists for running processes and the
// activity log -- all as one self-contained SVG string.
//
// Same input as timeline-render.js (a schema-valid paper record) and the
// same status rules (timeline-model.js), so the two views can never disagree
// about what is done or overdue. Colors and fonts come from css/style.css
// (the `.hig-*` classes and `--hig-*` variables), including a dark variant.
//
// Design rules taken from Apple's Human Interface Guidelines (Charts, Color):
//   * summarize the main message before the detail (tiles + one sentence)
//   * the data is the most prominent layer; grid and axis labels recede
//   * never rely on color alone: every status has a glyph *and* a text label,
//     and milestone type is a shape (diamond = deadline, circle = event)
//   * grid labels sit on the trailing side of their grid line

import { parseDate, todayUTC, daysBetween, summarizePaper } from './timeline-model.js';

// ---------------------------------------------------------------------
// Layout constants (viewBox units; the SVG scales to its container)
// ---------------------------------------------------------------------
const WIDTH = 1200;
const PAD = 24; // inner padding of every card
const RADIUS = 18; // card corner radius
const GAP = 16; // gap between side-by-side cards

const TILE_HEIGHT = 124;
const LABEL_COL_WIDTH = 212; // item names on the left of the timeline
const STATUS_COL_WIDTH = 132; // glyph + status text on the right
const ROW_HEIGHT = 50;
const LIST_ROW_HEIGHT = 62;
const MAX_EVENTS = 6; // same cap as the classic "Recent events" list
const MAX_MONTH_LABELS = 8; // thin out month gridlines on long timelines

const STATUS_TEXT = {
  done: 'Done',
  active: 'In progress',
  upcoming: 'Upcoming',
  pending: 'Upcoming',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

/** Paper-level status (schema enum) -> label + which glyph represents it. */
const PAPER_STATUS = {
  planning: ['Planning', 'upcoming'],
  in_progress: ['In progress', 'active'],
  submitted: ['Submitted', 'done'],
  under_review: ['Under review', 'active'],
  revision: ['Revision', 'active'],
  accepted: ['Accepted', 'done'],
  rejected: ['Rejected', 'cancelled'],
  published: ['Published', 'done'],
};

// ---------------------------------------------------------------------
// Text measurement
//
// Labels are truncated and some elements are placed after a piece of text,
// so the renderer needs text widths. In the browser the dashboard passes a
// canvas-based measurer (see canvasTextMeasurer); Node tests fall back to a
// per-character estimate.
// ---------------------------------------------------------------------

export const HIG_FONT_TEXT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif";
export const HIG_FONT_DISPLAY = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif";
const DISPLAY_TRACKING = -0.02; // em; must match .hig-disp in style.css

/** @typedef {(text: string, size: number, weight?: number, display?: boolean) => number} Measure */

/** @type {Measure} */
export function estimateTextWidth(text, size, weight = 400) {
  return String(text).length * size * (weight >= 600 ? 0.56 : 0.53);
}

/**
 * A measurer backed by a canvas 2D context, using the same font stacks the
 * SVG renders with. Call it after `document.fonts.ready` so web fonts count.
 * @returns {Measure}
 */
export function canvasTextMeasurer(doc = globalThis.document) {
  const ctx = doc && doc.createElement('canvas').getContext('2d');
  if (!ctx) return estimateTextWidth;
  return (text, size, weight = 400, display = false) => {
    const s = String(text);
    ctx.font = `${weight} ${size}px ${display ? HIG_FONT_DISPLAY : HIG_FONT_TEXT}`;
    return ctx.measureText(s).width + (display ? DISPLAY_TRACKING * size * s.length : 0);
  };
}

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

/** Round to 0.1 so the markup stays short and diff-friendly. */
const r = (n) => Math.round(n * 10) / 10;

/** "Oct 15" / "Oct 15, 2026" in the reader's locale, always in UTC. */
function shortDate(d, withYear = false) {
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (withYear) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

function monthLabel(d) {
  const opts = { month: 'short', timeZone: 'UTC' };
  if (d.getUTCMonth() === 0) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isOpen = (status) => status === 'pending' || status === 'upcoming';
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_');

function text(x, y, content, cls, size, weight = 400, anchor = 'start') {
  const a = anchor === 'start' ? '' : ` text-anchor="${anchor}"`;
  return `<text x="${r(x)}" y="${r(y)}" class="${cls}" font-size="${size}" font-weight="${weight}"${a}>${escapeXml(content)}</text>`;
}

/** Shortens `s` with an ellipsis until it fits `maxWidth`. */
function truncate(measure, s, maxWidth, size, weight = 400) {
  s = String(s);
  if (measure(s, size, weight) <= maxWidth) return s;
  while (s.length > 1 && measure(`${s}…`, size, weight) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Status class used for fills: pending/upcoming share one look. */
const fillClass = (status) => (isOpen(status) ? 'upcoming' : status);

// ---------------------------------------------------------------------
// Glyphs and marks
// ---------------------------------------------------------------------

/** SF-Symbols-like status glyphs: the shape carries the meaning, not only the color. */
function statusGlyph(cx, cy, status, radius = 9, pulse = false) {
  const k = radius;
  if (status === 'done') { // checkmark.circle.fill
    return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${k}" class="hig-fill-done"/>`
      + `<path d="M${r(cx - k * 0.42)} ${r(cy + k * 0.02)} l${r(k * 0.3)} ${r(k * 0.3)} l${r(k * 0.55)} ${r(-k * 0.62)}" `
      + `class="hig-glyph-mark" stroke-width="${r(k * 0.2)}"/>`;
  }
  if (status === 'overdue') { // exclamationmark.circle.fill
    return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${k}" class="hig-fill-overdue"/>`
      + `<rect x="${r(cx - k * 0.11)}" y="${r(cy - k * 0.52)}" width="${r(k * 0.22)}" height="${r(k * 0.62)}" rx="${r(k * 0.11)}" class="hig-glyph-dot"/>`
      + `<circle cx="${r(cx)}" cy="${r(cy + k * 0.45)}" r="${r(k * 0.13)}" class="hig-glyph-dot"/>`;
  }
  if (status === 'active') { // record.circle
    return `<g${pulse ? ' class="hig-pulse"' : ''}>`
      + `<circle cx="${r(cx)}" cy="${r(cy)}" r="${k - 1}" class="hig-line-active" stroke-width="2"/>`
      + `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(k * 0.45)}" class="hig-fill-active"/></g>`;
  }
  if (status === 'cancelled') { // xmark.circle
    const x = k * 0.32;
    return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${k - 1}" class="hig-line-cancelled" stroke-width="1.75"/>`
      + `<path d="M${r(cx - x)} ${r(cy - x)} L${r(cx + x)} ${r(cy + x)} M${r(cx + x)} ${r(cy - x)} L${r(cx - x)} ${r(cy + x)}" `
      + `class="hig-line-cancelled" stroke-width="1.75" stroke-linecap="round"/>`;
  }
  // upcoming / pending: an empty circle
  return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${k - 1}" class="hig-line-upcoming" stroke-width="1.75"/>`;
}

/** Point mark on a row: diamond = deadline, circle = event, with a 2px surface ring. */
function marker(x, cy, type, status, size = 14) {
  const cls = `hig-fill-${fillClass(status)} hig-ring`;
  if (type === 'event') return `<circle cx="${r(x)}" cy="${r(cy)}" r="${r(size / 2)}" class="${cls}" stroke-width="2"/>`;
  const h = size / 2;
  return `<rect x="${r(x - h)}" y="${r(cy - h)}" width="${size}" height="${size}" rx="2.5" `
    + `transform="rotate(45 ${r(x)} ${r(cy)})" class="${cls}" stroke-width="2"/>`;
}

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

/**
 * Renders the HIG-style overview of one paper record.
 * @param {object} paper - a paper record that has already passed schema validation.
 * @param {Date} [today] - defaults to the real current date (UTC midnight); overridable for tests.
 * @param {{ measure?: Measure }} [options]
 * @returns {string} a self-contained `<svg>...</svg>` markup string.
 */
export function renderPaperHIG(paper, today = todayUTC(), { measure = estimateTextWidth } = {}) {
  const start = parseDate(paper.timeline.start);
  const end = parseDate(paper.timeline.end);
  const span = Math.max(1, daysBetween(start, end));
  const pid = safeId(paper.id || 'paper');

  const summary = summarizePaper(paper, today);
  const milestones = summary.milestones.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const slots = summary.slots.slice().sort((a, b) => (a.start < b.start ? -1 : 1));
  const overdue = milestones.filter((m) => m.computedStatus === 'overdue');
  const openDeadlines = milestones.filter((m) => m.type !== 'event' && isOpen(m.computedStatus));
  const activeSlots = slots.filter((s) => s.computedStatus === 'active');

  const out = [];

  // ---- Header ------------------------------------------------------------
  const [pillText, pillGlyph] = PAPER_STATUS[paper.status] || [String(paper.status || 'Draft'), 'upcoming'];
  const pillW = measure(pillText, 13, 600) + 44;
  const pillX = WIDTH - pillW;
  out.push(`<rect x="${r(pillX)}" y="6" width="${r(pillW)}" height="30" rx="15" class="hig-card"/>`);
  out.push(statusGlyph(pillX + 19, 21, pillGlyph, 7));
  out.push(text(pillX + 32, 25.5, pillText, 'hig-t1', 13, 600));

  const title = truncate(measure, paper.title, pillX - 24, 34, 700);
  out.push(text(0, 34, title, 'hig-t1 hig-disp', 34, 700));
  const meta = [
    (paper.authors || []).join(', '),
    paper.venue,
    paper.updatedAt ? `Updated ${shortDate(parseDate(paper.updatedAt), true)}` : '',
  ].filter(Boolean).join(' · ');
  out.push(text(0, 64, truncate(measure, meta, WIDTH, 15), 'hig-t2', 15));

  // ---- Headline tiles ------------------------------------------------------
  let y = 92;
  const tileW = (WIDTH - 2 * GAP) / 3;
  const detailLine = (label, suffix) => {
    const room = tileW - 40 - measure(suffix, 14);
    return truncate(measure, label, room, 14) + suffix;
  };
  const tiles = [];

  if (openDeadlines.length) {
    const next = openDeadlines[0];
    const days = daysBetween(today, parseDate(next.date));
    tiles.push({
      status: 'upcoming', caption: 'Next deadline', big: String(days), unit: days === 1 ? 'day' : 'days',
      detail: detailLine(next.label, ` · ${shortDate(parseDate(next.date))}`),
    });
  } else {
    tiles.push({ status: 'done', caption: 'Next deadline', big: 'None', unit: '', detail: 'No open deadlines' });
  }

  if (overdue.length) {
    const late = daysBetween(parseDate(overdue[0].date), today);
    tiles.push({
      status: 'overdue', caption: 'Overdue', big: String(overdue.length),
      unit: overdue.length === 1 ? 'deadline' : 'deadlines',
      detail: detailLine(overdue[0].label, late > 0 ? ` · ${plural(late, 'day')} late` : ' · due today'),
    });
  } else {
    tiles.push({ status: 'done', caption: 'Overdue', big: '0', unit: 'deadlines', detail: 'Everything is on track' });
  }

  const elapsed = Math.min(span, Math.max(0, daysBetween(start, today)));
  const fraction = elapsed / span;
  tiles.push({
    status: 'active', caption: 'Timeline', big: `${Math.round(fraction * 100)}%`, unit: 'elapsed',
    detail: `Day ${elapsed} of ${span} · ${shortDate(start)} – ${shortDate(end)}`, progress: fraction,
  });

  tiles.forEach((tile, i) => {
    const tx = i * (tileW + GAP);
    out.push(`<rect x="${r(tx)}" y="${y}" width="${r(tileW)}" height="${TILE_HEIGHT}" rx="${RADIUS}" class="hig-card"/>`);
    out.push(statusGlyph(tx + 27, y + 29, tile.status, 7));
    out.push(text(tx + 42, y + 34, tile.caption, 'hig-t2 hig-caps', 12, 600));
    out.push(text(tx + 20, y + 80, tile.big, 'hig-t1 hig-disp', 38, 700));
    const bigW = measure(tile.big, 38, 700, true);
    if (tile.unit) out.push(text(tx + 20 + bigW + 6, y + 80, tile.unit, 'hig-t2', 17, 500));
    if (tile.progress !== undefined) {
      const bx = tx + 20 + bigW + 6 + measure(tile.unit, 17, 500) + 16;
      const bw = tx + tileW - 20 - bx;
      if (bw > 24) {
        out.push(`<rect x="${r(bx)}" y="${y + 68}" width="${r(bw)}" height="8" rx="4" class="hig-track"/>`);
        out.push(`<rect x="${r(bx)}" y="${y + 68}" width="${r(Math.max(8, bw * tile.progress))}" height="8" rx="4" class="hig-fill-active"/>`);
      }
    }
    out.push(text(tx + 20, y + 106, tile.detail, 'hig-t2', 14));
  });
  y += TILE_HEIGHT + 24;

  // ---- Timeline card -------------------------------------------------------
  const cardY = y;
  const lx = PAD;
  const x0 = lx + LABEL_COL_WIDTH + 16;
  const x1 = WIDTH - PAD - STATUS_COL_WIDTH;
  const sx = x1 + 28;
  const xFor = (d) => x0 + Math.min(1, Math.max(0, daysBetween(start, d) / span)) * (x1 - x0);

  const body = [];
  body.push(text(lx, cardY + 44, 'Timeline', 'hig-t1 hig-disp', 22, 600));

  const sentence = [];
  if (activeSlots.length) {
    sentence.push(`${activeSlots.map((s) => s.label).join(' and ')} ${activeSlots.length === 1 ? 'is' : 'are'} under way.`);
  }
  if (overdue.length) sentence.push(`${plural(overdue.length, 'deadline')} ${overdue.length === 1 ? 'is' : 'are'} overdue.`);
  if (openDeadlines.length) {
    const next = openDeadlines[0];
    sentence.push(`${next.label} in ${plural(daysBetween(today, parseDate(next.date)), 'day')}.`);
  }
  const summaryText = sentence.join(' ') || 'Nothing scheduled right now.';
  body.push(text(lx, cardY + 70, truncate(measure, summaryText, WIDTH - 2 * PAD, 15), 'hig-t2', 15));

  // Legend: shape encodes the item type; status is labelled on every row.
  let lgx = WIDTH - PAD;
  for (const [kind, label] of [['phase', 'Phase'], ['event', 'Event'], ['deadline', 'Deadline']]) {
    lgx -= measure(label, 13);
    body.push(text(lgx, cardY + 44, label, 'hig-t2', 13));
    if (kind === 'phase') {
      lgx -= 26;
      body.push(`<rect x="${r(lgx)}" y="${cardY + 34}" width="20" height="10" rx="5" class="hig-fill-upcoming"/>`);
    } else {
      lgx -= 18;
      body.push(marker(lgx + 6, cardY + 39.5, kind, 'upcoming', 10));
    }
    lgx -= 18;
  }

  const plotTop = cardY + 100;
  const gridTop = plotTop + 26;
  const rows = [];
  let cursor = plotTop + 40; // baseline of the next section label
  let lastCenter = plotTop + 20;

  const rowOpen = (cy, tooltip) => rows.push(
    `<g class="hig-row"><title>${escapeXml(tooltip)}</title>`
    + `<rect x="${lx - 12}" y="${r(cy - ROW_HEIGHT / 2 + 2)}" width="${WIDTH - 2 * PAD + 24}" height="${ROW_HEIGHT - 4}" rx="10" class="hig-hit"/>`,
  );
  const statusCell = (cy, status) => {
    const strong = status === 'overdue' || status === 'active';
    rows.push(statusGlyph(sx + 9, cy, status, 9));
    rows.push(text(sx + 26, cy + 5, STATUS_TEXT[status] || status, strong ? 'hig-t1' : 'hig-t2', 14, strong ? 600 : 400));
  };
  const section = (title, items, drawRow) => {
    if (!items.length) return;
    rows.push(text(lx, cursor + 4, title, 'hig-t2 hig-caps', 12, 600));
    let cy = cursor + 43;
    items.forEach((item) => { drawRow(item, cy); cy += ROW_HEIGHT; });
    lastCenter = cy - ROW_HEIGHT;
    cursor = lastCenter + 53;
  };

  section('Phases', slots, (s, cy) => {
    const status = s.computedStatus;
    const a = parseDate(s.start);
    const b = parseDate(s.end);
    const range = `${shortDate(a)} – ${shortDate(b)}`;
    rowOpen(cy, [s.label, range, STATUS_TEXT[status] || status, s.note].filter(Boolean).join(' — '));
    rows.push(text(lx, cy - 3, truncate(measure, s.label, LABEL_COL_WIDTH, 15, 500), 'hig-t1', 15, 500));
    rows.push(text(lx, cy + 15, `${range} · ${plural(daysBetween(a, b), 'day')}`, 'hig-t2 hig-num', 13));
    rows.push(`<rect x="${r(x0)}" y="${r(cy - 8)}" width="${r(x1 - x0)}" height="16" rx="8" class="hig-track"/>`);
    const xa = xFor(a);
    const w = Math.max(16, xFor(b) - xa);
    if (status === 'active') {
      // Whole phase as a tint, the part already behind us in solid color.
      const clip = `hig-clip-${pid}-${safeId(s.id)}`;
      rows.push(`<clipPath id="${clip}"><rect x="${r(xa)}" y="${r(cy - 8)}" width="${r(w)}" height="16" rx="8"/></clipPath>`);
      rows.push(`<rect x="${r(xa)}" y="${r(cy - 8)}" width="${r(w)}" height="16" rx="8" class="hig-fill-active hig-tint"/>`);
      rows.push(`<rect clip-path="url(#${clip})" x="${r(xa)}" y="${r(cy - 8)}" width="${r(Math.max(0, xFor(today) - xa))}" height="16" class="hig-fill-active"/>`);
    } else {
      rows.push(`<rect x="${r(xa)}" y="${r(cy - 8)}" width="${r(w)}" height="16" rx="8" class="hig-fill-${fillClass(status)}"/>`);
    }
    statusCell(cy, status);
    rows.push('</g>');
  });

  section('Milestones', milestones, (m, cy) => {
    const status = m.computedStatus;
    const d = parseDate(m.date);
    const kind = m.type === 'event' ? 'Event' : 'Deadline';
    rowOpen(cy, [m.label, shortDate(d, true), STATUS_TEXT[status] || status, m.note].filter(Boolean).join(' — '));
    rows.push(text(lx, cy - 3, truncate(measure, m.label, LABEL_COL_WIDTH, 15, 500), 'hig-t1', 15, 500));
    let sub = `${kind} · ${shortDate(d)}`;
    const delta = daysBetween(today, d);
    if (status === 'overdue') sub += delta === 0 ? ' · today' : ` · ${plural(-delta, 'day')} ago`;
    else if (isOpen(status) && delta >= 0) sub += ` · in ${plural(delta, 'day')}`;
    rows.push(text(lx, cy + 15, sub, 'hig-t2 hig-num', 13));
    rows.push(`<line x1="${r(x0)}" y1="${r(cy)}" x2="${r(x1)}" y2="${r(cy)}" class="hig-sep" stroke-width="1"/>`);
    const xm = xFor(d);
    if (status === 'overdue' && today > d) {
      // Faint trail from the missed date up to today: how late it is, at a glance.
      rows.push(`<line x1="${r(xm)}" y1="${r(cy)}" x2="${r(xFor(today))}" y2="${r(cy)}" class="hig-line-overdue hig-trail" stroke-width="4" stroke-linecap="round"/>`);
    }
    rows.push(marker(xm, cy, m.type, status));
    statusCell(cy, status);
    rows.push('</g>');
  });

  const rowsEnd = lastCenter + 35;

  // Grid: month starts, labels on the trailing side of each line.
  const grid = [];
  const months = [];
  for (let mo = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); mo <= end;
    mo = new Date(Date.UTC(mo.getUTCFullYear(), mo.getUTCMonth() + 1, 1))) {
    if (mo >= start) months.push(mo);
  }
  const stride = Math.max(1, Math.ceil(months.length / MAX_MONTH_LABELS));
  months.filter((_, i) => i % stride === 0).forEach((mo) => {
    const xg = xFor(mo);
    grid.push(`<line x1="${r(xg)}" y1="${gridTop}" x2="${r(xg)}" y2="${r(rowsEnd)}" class="hig-sep" stroke-width="1"/>`);
    if (xg < x1 - 20) grid.push(text(xg + 5, rowsEnd + 20, monthLabel(mo), 'hig-t2', 13, 500));
  });
  grid.push(`<line x1="${r(x1)}" y1="${gridTop}" x2="${r(x1)}" y2="${r(rowsEnd)}" class="hig-sep" stroke-width="1"/>`);

  // Today marker in neutral ink, so it never competes with a status color.
  let todayMarker = '';
  if (today >= start && today <= end) {
    const xt = xFor(today);
    const label = `Today · ${shortDate(today)}`;
    const lw = measure(label, 12, 600) + 20;
    const capX = Math.min(Math.max(xt - lw / 2, x0), x1 - lw);
    todayMarker = `<g class="hig-today">`
      + `<line x1="${r(xt)}" y1="${plotTop + 22}" x2="${r(xt)}" y2="${r(rowsEnd)}" class="hig-line-ink" stroke-width="1.5"/>`
      + `<rect x="${r(capX)}" y="${plotTop}" width="${r(lw)}" height="22" rx="11" class="hig-fill-ink"/>`
      + text(capX + lw / 2, plotTop + 15, label, 'hig-inv', 12, 600, 'middle')
      + '</g>';
  }

  const cardH = rowsEnd + 44 - cardY;
  out.push(`<rect x="0" y="${cardY}" width="${WIDTH}" height="${r(cardH)}" rx="${RADIUS}" class="hig-card"/>`);
  out.push(...body, ...grid, ...rows, todayMarker);
  y = cardY + cardH + 36;

  // ---- Grouped lists: running processes + activity log ----------------------
  const colW = (WIDTH - GAP) / 2;
  const listTop = y;

  function groupedList(x, title, items, emptyText, drawRow) {
    out.push(text(x + 20, listTop, title, 'hig-t2 hig-caps', 12, 600));
    const top = listTop + 12;
    const h = Math.max(1, items.length) * LIST_ROW_HEIGHT;
    out.push(`<rect x="${r(x)}" y="${top}" width="${r(colW)}" height="${h}" rx="${RADIUS}" class="hig-card"/>`);
    if (!items.length) out.push(text(x + 20, top + LIST_ROW_HEIGHT / 2 + 5, emptyText, 'hig-t2', 15));
    items.forEach((item, i) => {
      const cy = top + i * LIST_ROW_HEIGHT + LIST_ROW_HEIGHT / 2;
      const inset = drawRow(x, cy, item);
      if (i < items.length - 1) {
        const ly = cy + LIST_ROW_HEIGHT / 2;
        out.push(`<line x1="${r(x + inset)}" y1="${r(ly)}" x2="${r(x + colW)}" y2="${r(ly)}" class="hig-sep" stroke-width="1"/>`);
      }
    });
    return top + h;
  }

  const twoLines = (x, cy, avail, main, note, mainWeight) => {
    if (note) {
      out.push(text(x, cy - 3, truncate(measure, main, avail, 15, mainWeight), 'hig-t1', 15, mainWeight));
      out.push(text(x, cy + 15, truncate(measure, note, avail, 13), 'hig-t2', 13));
    } else {
      out.push(text(x, cy + 5, truncate(measure, main, avail, 15, mainWeight), 'hig-t1', 15, mainWeight));
    }
  };

  const procBottom = groupedList(0, 'In progress', summary.activeProcesses, 'Nothing currently running.', (x, cy, p) => {
    out.push(statusGlyph(x + 29, cy, 'active', 9, true));
    twoLines(x + 52, cy, colW - 52 - 20 - 100, p.label, p.note, 500);
    if (p.since) {
      const since = parseDate(p.since);
      out.push(text(x + colW - 20, cy - 3, plural(Math.max(0, daysBetween(since, today)), 'day'), 'hig-t1 hig-num', 15, 500, 'end'));
      out.push(text(x + colW - 20, cy + 15, `since ${shortDate(since)}`, 'hig-t2', 13, 400, 'end'));
    }
    return 52;
  });

  const eventBottom = groupedList(colW + GAP, 'Activity', summary.events.slice(0, MAX_EVENTS), 'No logged events yet.', (x, cy, e) => {
    out.push(text(x + 20, cy + 5, shortDate(parseDate(e.date)), 'hig-t2 hig-num', 15, 500));
    twoLines(x + 92, cy, colW - 92 - 20, e.label, e.note, 400);
    return 92;
  });

  const height = Math.ceil(Math.max(procBottom, eventBottom) + 4);
  const description = `${paper.title}. ${summaryText}`;

  return `<svg viewBox="0 0 ${WIDTH} ${height}" class="hig-svg" role="img" `
    + `aria-labelledby="hig-title-${pid} hig-desc-${pid}" xmlns="http://www.w3.org/2000/svg">`
    + `<title id="hig-title-${pid}">Progress of ${escapeXml(paper.title)}</title>`
    + `<desc id="hig-desc-${pid}">${escapeXml(description)}</desc>\n`
    + `${out.join('\n')}\n</svg>`;
}
