import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate,
  daysBetween,
  fractionForDate,
  milestoneStatus,
  slotStatus,
  summarizePaper,
} from '../js/timeline-model.js';

const today = parseDate('2026-08-07');

test('parseDate parses as UTC midnight, immune to local timezone', () => {
  const d = parseDate('2027-01-01');
  assert.equal(d.getUTCFullYear(), 2027);
  assert.equal(d.getUTCMonth(), 0);
  assert.equal(d.getUTCDate(), 1);
});

test('daysBetween counts whole days', () => {
  assert.equal(daysBetween(parseDate('2027-01-01'), parseDate('2027-01-11')), 10);
  assert.equal(daysBetween(parseDate('2027-01-01'), parseDate('2027-01-01')), 0);
});

test('fractionForDate clamps to [0, 1] and interpolates linearly', () => {
  assert.equal(fractionForDate('2027-01-01', '2027-01-01', '2027-01-31'), 0);
  assert.equal(fractionForDate('2027-01-31', '2027-01-01', '2027-01-31'), 1);
  assert.equal(fractionForDate('2026-12-01', '2027-01-01', '2027-01-31'), 0); // clamped below range
  assert.equal(fractionForDate('2027-06-01', '2027-01-01', '2027-01-31'), 1); // clamped above range
  assert.equal(fractionForDate('2027-01-16', '2027-01-01', '2027-01-31'), 0.5);
});

test('milestoneStatus: a deadline in the past without an explicit status becomes overdue', () => {
  const m = { date: '2026-08-01', type: 'deadline' };
  assert.equal(milestoneStatus(m, today), 'overdue');
});

test('milestoneStatus: a deadline in the future without an explicit status is pending', () => {
  const m = { date: '2026-09-01', type: 'deadline' };
  assert.equal(milestoneStatus(m, today), 'pending');
});

test('milestoneStatus: an explicit status always wins over the computed one', () => {
  const m = { date: '2026-01-01', type: 'deadline', status: 'done' };
  assert.equal(milestoneStatus(m, today), 'done');
});

test('milestoneStatus: an "event" in the past is done, not overdue (events are a record, not a promise)', () => {
  const m = { date: '2026-08-01', type: 'event' };
  assert.equal(milestoneStatus(m, today), 'done');
});

test('slotStatus: before start is upcoming, inside range is active, after end is done', () => {
  assert.equal(slotStatus({ start: '2026-09-01', end: '2026-09-10' }, today), 'upcoming');
  assert.equal(slotStatus({ start: '2026-08-01', end: '2026-08-10' }, today), 'active');
  assert.equal(slotStatus({ start: '2026-07-01', end: '2026-07-10' }, today), 'done');
});

test('slotStatus: an explicit status overrides the computed one', () => {
  assert.equal(slotStatus({ start: '2026-01-01', end: '2026-01-10', status: 'cancelled' }, today), 'cancelled');
});

test('summarizePaper only returns processes flagged active, and sorts events newest-first', () => {
  const paper = {
    milestones: [],
    slots: [],
    events: [
      { id: 'e1', label: 'first', date: '2026-01-01' },
      { id: 'e2', label: 'second', date: '2026-06-01' },
    ],
    processes: [
      { id: 'p1', label: 'running', active: true },
      { id: 'p2', label: 'finished', active: false },
    ],
  };
  const { activeProcesses, events } = summarizePaper(paper, today);
  assert.equal(activeProcesses.length, 1);
  assert.equal(activeProcesses[0].id, 'p1');
  assert.equal(events[0].id, 'e2'); // newest first
});
