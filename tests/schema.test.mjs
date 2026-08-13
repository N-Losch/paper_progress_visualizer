import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { validatePaper } from '../js/schema-validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const schemaPath = path.join(ROOT, 'data/schema/paper.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateAjv = ajv.compile(schema);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('the schema file itself is a valid, compilable JSON Schema (draft-07)', () => {
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(typeof validateAjv, 'function');
});

test('data/template.json is itself a complete, schema-valid record (a safe copy-paste starting point)', () => {
  const template = readJson(path.join(ROOT, 'data/template.json'));
  const valid = validateAjv(template);
  assert.equal(valid, true, JSON.stringify(validateAjv.errors, null, 2));
  // Its id is a placeholder, not "example-paper" -- confirm it's not
  // accidentally aliasing the real example file.
  assert.equal(template.id, 'my-paper-id');
});

test('data/papers/example-paper.json validates against the JSON Schema (ajv)', () => {
  const example = readJson(path.join(ROOT, 'data/papers/example-paper.json'));
  const valid = validateAjv(example);
  assert.equal(valid, true, JSON.stringify(validateAjv.errors, null, 2));
});

test('data/papers/example-paper.json validates against the browser validator too', () => {
  const example = readJson(path.join(ROOT, 'data/papers/example-paper.json'));
  const { valid, errors } = validatePaper(example);
  assert.equal(valid, true, errors.join('\n'));
});

test('every file listed in data/papers/index.json exists and validates against the schema', () => {
  const index = readJson(path.join(ROOT, 'data/papers/index.json'));
  assert.ok(Array.isArray(index.papers) && index.papers.length > 0, 'index.json should list at least one paper');

  for (const name of index.papers) {
    const filePath = path.join(ROOT, 'data/papers', `${name}.json`);
    assert.ok(fs.existsSync(filePath), `${name}.json referenced in index.json does not exist`);
    const paper = readJson(filePath);
    const valid = validateAjv(paper);
    assert.equal(valid, true, `${name}.json: ${JSON.stringify(validateAjv.errors, null, 2)}`);
    assert.equal(paper.id, name, `${name}.json: "id" field (${paper.id}) should match its filename`);
  }
});

test('every *.json file physically present in data/papers/ is either indexed or a deliberate exception', () => {
  const index = readJson(path.join(ROOT, 'data/papers/index.json'));
  const indexed = new Set(index.papers || []);
  const files = fs.readdirSync(path.join(ROOT, 'data/papers'))
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.replace(/\.json$/, ''));

  const unindexed = files.filter((f) => !indexed.has(f));
  assert.deepEqual(unindexed, [], `These files exist but are not listed in index.json, so they will not appear on the dashboard: ${unindexed.join(', ')}`);
});

test('the schema rejects an obviously broken record (missing required fields)', () => {
  const broken = { title: 'No id, no timeline, no milestones' };
  const valid = validateAjv(broken);
  assert.equal(valid, false);
  assert.ok(validateAjv.errors.length > 0);
});

test('the schema rejects a slot with an end date before its start date only via validatePaper (ajv has no cross-field check here)', () => {
  // ajv's plain JSON Schema (without a $data or custom keyword) cannot express
  // "end >= start" -- that's exactly why the hand-rolled validatePaper() adds
  // an explicit check on top. This test documents and locks in that gap.
  const paper = {
    id: 'broken-range',
    title: 'Broken range',
    authors: ['A'],
    status: 'planning',
    timeline: { start: '2027-01-01', end: '2027-02-01' },
    milestones: [{ id: 'm1', label: 'x', date: '2027-01-01', type: 'deadline' }],
    slots: [{ id: 's1', label: 'bad', start: '2027-02-01', end: '2027-01-01' }],
  };
  assert.equal(validateAjv(paper), true, 'ajv has no notion of date ordering, so this passes at the schema level');
  const { valid, errors } = validatePaper(paper);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('start') && e.includes('after')));
});

test('validatePaper additionally rejects duplicate ids across milestones/slots/events/processes (ajv/JSON Schema cannot express this either)', () => {
  const paper = {
    id: 'dup-ids',
    title: 'Dup ids',
    authors: ['A'],
    status: 'planning',
    timeline: { start: '2027-01-01', end: '2027-02-01' },
    milestones: [{ id: 'x1', label: 'm', date: '2027-01-01', type: 'deadline' }],
    slots: [{ id: 'x1', label: 's', start: '2027-01-01', end: '2027-01-10' }],
  };
  assert.equal(validateAjv(paper), true, 'ajv has no cross-array uniqueness check either');
  const { valid, errors } = validatePaper(paper);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('duplicate id')));
});
