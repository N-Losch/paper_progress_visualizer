// timeline-model.js
// Pure functions for turning a paper record into positions and statuses.
// No DOM access here, which is what lets this same file be imported by the
// dashboard, the editor's live preview, and the Node test suite unchanged --
// Node 22+ runs ES modules natively, so the test files import this directly.

export function parseDate(value) {
  // Dates in the schema are plain "YYYY-MM-DD" strings. Parsing them as
  // UTC avoids the classic off-by-one-day bug caused by local timezones.
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function daysBetween(a, b) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

export function formatDate(value) {
  const d = parseDate(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Map a date onto a 0..1 fraction of the [start, end] timeline window.
 * Clamped, so items that fall outside the declared window still render
 * at the edge instead of disappearing.
 */
export function fractionForDate(dateStr, startStr, endStr) {
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  const d = parseDate(dateStr);
  const total = daysBetween(start, end);
  if (total <= 0) return 0;
  const offset = daysBetween(start, d);
  return Math.min(1, Math.max(0, offset / total));
}

/**
 * A milestone's effective status. An explicit `status` in the data always
 * wins. Otherwise: events are always "done" once their date has passed
 * (they are a record of something happening), and deadlines are "pending"
 * until the date passes, at which point they become "overdue" -- a
 * deadline is never automatically "done"; someone has to say so.
 */
export function milestoneStatus(milestone, today = todayUTC()) {
  if (milestone.status) return milestone.status;
  const date = parseDate(milestone.date);
  if (milestone.type === 'event') {
    return date <= today ? 'done' : 'pending';
  }
  return date <= today ? 'overdue' : 'pending';
}

/**
 * A slot's effective status, derived from today's position relative to
 * [start, end] unless overridden explicitly in the data.
 */
export function slotStatus(slot, today = todayUTC()) {
  if (slot.status) return slot.status;
  const start = parseDate(slot.start);
  const end = parseDate(slot.end);
  if (today < start) return 'upcoming';
  if (today > end) return 'done';
  return 'active';
}

/**
 * Summarize a paper record into the pieces the renderer needs, with
 * statuses pre-computed.
 */
export function summarizePaper(paper, today = todayUTC()) {
  const milestones = (paper.milestones || []).map((m) => ({
    ...m,
    computedStatus: milestoneStatus(m, today),
  }));
  const slots = (paper.slots || []).map((s) => ({
    ...s,
    computedStatus: slotStatus(s, today),
  }));
  const activeProcesses = (paper.processes || []).filter((p) => p.active);
  const events = [...(paper.events || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  return { milestones, slots, activeProcesses, events };
}
