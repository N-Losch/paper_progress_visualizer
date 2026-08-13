import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTimelineSVG } from '../js/timeline-render.js';
import { parseDate } from '../js/timeline-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('renderTimelineSVG produces a single well-formed <svg> root with a viewBox', () => {
  const paper = readJson(path.join(ROOT, 'data/papers/example-paper.json'));
  const svg = renderTimelineSVG(paper, parseDate('2026-08-07')).trim();
  assert.match(svg, /^<svg viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<\/svg>$/);
  // Every opened <g> must be closed -- a cheap tag-balance check.
  const opens = (svg.match(/<g[ >]/g) || []).length;
  const closes = (svg.match(/<\/g>/g) || []).length;
  assert.equal(opens, closes);
});

test('renderTimelineSVG includes a today marker only when today falls within the timeline window', () => {
  const paper = readJson(path.join(ROOT, 'data/papers/example-paper.json'));
  const inRange = renderTimelineSVG(paper, parseDate('2026-08-07'));
  assert.match(inRange, /today-marker/);
  const outOfRange = renderTimelineSVG(paper, parseDate('2030-01-01'));
  assert.doesNotMatch(outOfRange, /today-marker/);
});

test('renderTimelineSVG escapes special characters in labels to avoid breaking the markup', () => {
  const paper = {
    id: 'xss-check',
    title: 'A & B <script>alert(1)</script>',
    authors: ['A'],
    status: 'planning',
    timeline: { start: '2027-01-01', end: '2027-02-01' },
    milestones: [{ id: 'm1', label: '<b>bold</b> & "quoted"', date: '2027-01-15', type: 'deadline' }],
    slots: [],
  };
  const svg = renderTimelineSVG(paper, parseDate('2027-01-01'));
  assert.doesNotMatch(svg, /<b>bold<\/b>/);
  assert.match(svg, /&lt;b&gt;bold&lt;\/b&gt;/);
});

test('renderTimelineSVG grows taller as more slots are added, so bars never overlap', () => {
  const base = readJson(path.join(ROOT, 'data/papers/example-paper.json'));
  const withMoreSlots = {
    ...base,
    slots: [...base.slots, { id: 's-extra', label: 'Extra', start: '2026-09-01', end: '2026-09-15' }],
  };
  const heightOf = (svg) => Number(svg.match(/viewBox="0 0 \d+ (\d+)"/)[1]);
  const h1 = heightOf(renderTimelineSVG(base, parseDate('2026-08-07')));
  const h2 = heightOf(renderTimelineSVG(withMoreSlots, parseDate('2026-08-07')));
  assert.ok(h2 > h1);
});
