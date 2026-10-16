import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPaperHIG } from '../js/timeline-render-hig.js';
import { parseDate } from '../js/timeline-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const example = () => readJson(path.join(ROOT, 'data/papers/example-paper.json'));
const heightOf = (svg) => Number(svg.match(/viewBox="0 0 \d+ (\d+)"/)[1]);

/** Every element that is opened must be closed (self-closing tags count as both). */
function assertBalanced(svg, tag) {
  const opens = (svg.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
  const selfClosing = (svg.match(new RegExp(`<${tag}[^>]*/>`, 'g')) || []).length;
  const closes = (svg.match(new RegExp(`</${tag}>`, 'g')) || []).length;
  assert.equal(opens - selfClosing, closes, `unbalanced <${tag}>`);
}

test('renderPaperHIG produces a single well-formed <svg> root with a viewBox', () => {
  const svg = renderPaperHIG(example(), parseDate('2026-10-07')).trim();
  assert.match(svg, /^<svg viewBox="0 0 1200 \d+" class="hig-svg"/);
  assert.match(svg, /<\/svg>$/);
  for (const tag of ['g', 'text', 'title', 'clipPath']) assertBalanced(svg, tag);
});

test('renderPaperHIG every row names its status in text, not only in color', () => {
  const svg = renderPaperHIG(example(), parseDate('2026-10-07'));
  for (const label of ['Done', 'In progress', 'Overdue', 'Upcoming']) {
    assert.match(svg, new RegExp(`>${label}</text>`));
  }
});

test('renderPaperHIG summarizes the main message up front', () => {
  const svg = renderPaperHIG(example(), parseDate('2026-10-07'));
  assert.match(svg, /Final polish is under way\. 1 deadline is overdue\. Journal submission deadline in 8 days\./);
  assert.match(svg, /<desc id="hig-desc-example-paper">/);
});

test('renderPaperHIG shows a today marker only when today falls within the timeline window', () => {
  assert.match(renderPaperHIG(example(), parseDate('2026-08-07')), /class="hig-today"/);
  assert.doesNotMatch(renderPaperHIG(example(), parseDate('2030-01-01')), /class="hig-today"/);
});

test('renderPaperHIG escapes special characters in labels to avoid breaking the markup', () => {
  const paper = {
    id: 'xss-check',
    title: 'A & B <script>alert(1)</script>',
    authors: ['A'],
    status: 'planning',
    timeline: { start: '2027-01-01', end: '2027-02-01' },
    milestones: [{ id: 'm1', label: '<b>bold</b> & "quoted"', date: '2027-01-15', type: 'deadline' }],
    slots: [],
  };
  const svg = renderPaperHIG(paper, parseDate('2027-01-01'));
  assert.doesNotMatch(svg, /<script>/);
  assert.doesNotMatch(svg, /<b>bold<\/b>/);
  assert.match(svg, /&lt;b&gt;bold&lt;\/b&gt;/);
});

test('renderPaperHIG grows taller as more rows are added, so rows never overlap', () => {
  const base = example();
  const more = {
    ...base,
    slots: [...base.slots, { id: 's-extra', label: 'Extra', start: '2026-09-01', end: '2026-09-15' }],
  };
  assert.ok(heightOf(renderPaperHIG(more, parseDate('2026-08-07'))) > heightOf(renderPaperHIG(base, parseDate('2026-08-07'))));
});

test('renderPaperHIG scopes clip-path ids to the paper so several papers can share a page', () => {
  const a = renderPaperHIG(example(), parseDate('2026-09-20'));
  const b = renderPaperHIG({ ...example(), id: 'other-paper' }, parseDate('2026-09-20'));
  const ids = (svg) => [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids(a).length, 1);
  assert.notDeepEqual(ids(a), ids(b));
});

test('renderPaperHIG copes with a minimal paper (no slots, milestones, events or processes)', () => {
  const paper = {
    id: 'bare',
    title: 'Bare',
    authors: [],
    status: 'planning',
    timeline: { start: '2027-01-01', end: '2027-03-01' },
    milestones: [],
  };
  const svg = renderPaperHIG(paper, parseDate('2027-01-10'));
  assert.match(svg, /No open deadlines/);
  assert.match(svg, /Nothing currently running\./);
  assert.match(svg, /No logged events yet\./);
  assert.doesNotMatch(svg, /NaN|undefined/);
});

test('renderPaperHIG thins out month labels on long timelines', () => {
  const paper = { ...example(), timeline: { start: '2026-01-01', end: '2028-12-31' } };
  const svg = renderPaperHIG(paper, parseDate('2026-10-07'));
  const monthLabels = svg.match(/class="hig-t2" font-size="13" font-weight="500">[A-Z][a-z]{2}/g) || [];
  assert.ok(monthLabels.length <= 8, `expected at most 8 month labels, got ${monthLabels.length}`);
});

test('renderPaperHIG never emits NaN or undefined for the bundled papers', () => {
  const index = readJson(path.join(ROOT, 'data/papers/index.json'));
  for (const name of index.papers) {
    const svg = renderPaperHIG(readJson(path.join(ROOT, `data/papers/${name}.json`)), parseDate('2026-10-15'));
    assert.doesNotMatch(svg, /NaN|undefined/, name);
  }
});
