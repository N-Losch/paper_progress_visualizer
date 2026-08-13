// schema-validate.js
// A small, purpose-built validator, NOT a general JSON Schema engine.
// It checks the same constraints as data/schema/paper.schema.json but is
// hand-written so the browser doesn't need to load a schema library.
// The authoritative check is the Node test suite in tests/, which
// validates every file in data/papers/ against the real schema with ajv.
// If you change the schema, update this file to match -- that duplication
// is the trade-off made here to keep the site dependency-free.
//
// It also checks two things plain JSON Schema cannot express at all:
// date ranges where end < start, and ids that repeat within a paper.
// See tests/schema.test.mjs for both validators exercised side by side.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const STATUS_ENUM = ['planning', 'in_progress', 'submitted', 'under_review', 'revision', 'accepted', 'rejected', 'published'];
const MILESTONE_TYPE_ENUM = ['deadline', 'event'];
const MILESTONE_STATUS_ENUM = ['pending', 'done', 'overdue'];
const SLOT_STATUS_ENUM = ['upcoming', 'active', 'done', 'cancelled'];

// ---------------------------------------------------------------------
// Field-level checks
//
// Each of these appends to `errors` in place and returns nothing; callers
// don't need a return value because a missing/invalid field is recorded
// as a message, not thrown, so validation can continue and collect every
// problem in one pass instead of stopping at the first one.
// ---------------------------------------------------------------------

function isString(v) { return typeof v === 'string'; }
function isNonEmptyString(v) { return isString(v) && v.length > 0; }

function checkDate(value, path, errors) {
  if (!isString(value) || !DATE_RE.test(value)) {
    errors.push(`${path}: expected a "YYYY-MM-DD" date string, got ${JSON.stringify(value)}`);
    return;
  }
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    errors.push(`${path}: "${value}" is not a real calendar date`);
  }
}

/**
 * Checks that `startValue` is not later than `endValue`, given both are
 * already-confirmed valid date strings. Silently no-ops otherwise -- the
 * individual `checkDate` calls at the caller are what report a malformed
 * date, so this only adds the ordering error on top of two dates that are
 * each independently well-formed.
 */
function checkDateRange(startValue, endValue, path, errors) {
  if (isString(startValue) && isString(endValue) && DATE_RE.test(startValue) && DATE_RE.test(endValue) && startValue > endValue) {
    errors.push(`${path}: start (${startValue}) is after end (${endValue})`);
  }
}

function checkRequiredDate(value, path, errors) {
  if (value === undefined) errors.push(`${path}: required`);
  else checkDate(value, path, errors);
}

function checkEnum(value, allowed, path, errors, { required = true } = {}) {
  if (value === undefined) {
    if (required) errors.push(`${path}: required`);
    return;
  }
  if (!allowed.includes(value)) errors.push(`${path}: must be one of ${allowed.join(', ')}`);
}

// ---------------------------------------------------------------------
// Per-item validators for the four repeating list types
// ---------------------------------------------------------------------

function checkArrayOf(array, path, errors, itemValidator) {
  if (!Array.isArray(array)) {
    errors.push(`${path}: expected an array`);
    return;
  }
  array.forEach((item, i) => itemValidator(item, `${path}[${i}]`, errors));
}

function validateMilestone(m, path, errors) {
  if (typeof m !== 'object' || m === null) { errors.push(`${path}: expected an object`); return; }
  if (!isNonEmptyString(m.id)) errors.push(`${path}.id: required non-empty string`);
  if (!isNonEmptyString(m.label)) errors.push(`${path}.label: required non-empty string`);
  checkRequiredDate(m.date, `${path}.date`, errors);
  checkEnum(m.type, MILESTONE_TYPE_ENUM, `${path}.type`, errors);
  checkEnum(m.status, MILESTONE_STATUS_ENUM, `${path}.status`, errors, { required: false });
}

function validateSlot(s, path, errors) {
  if (typeof s !== 'object' || s === null) { errors.push(`${path}: expected an object`); return; }
  if (!isNonEmptyString(s.id)) errors.push(`${path}.id: required non-empty string`);
  if (!isNonEmptyString(s.label)) errors.push(`${path}.label: required non-empty string`);
  checkRequiredDate(s.start, `${path}.start`, errors);
  checkRequiredDate(s.end, `${path}.end`, errors);
  checkEnum(s.status, SLOT_STATUS_ENUM, `${path}.status`, errors, { required: false });
  checkDateRange(s.start, s.end, path, errors);
}

function validateEvent(e, path, errors) {
  if (typeof e !== 'object' || e === null) { errors.push(`${path}: expected an object`); return; }
  if (!isNonEmptyString(e.id)) errors.push(`${path}.id: required non-empty string`);
  if (!isNonEmptyString(e.label)) errors.push(`${path}.label: required non-empty string`);
  checkRequiredDate(e.date, `${path}.date`, errors);
}

function validateProcess(p, path, errors) {
  if (typeof p !== 'object' || p === null) { errors.push(`${path}: expected an object`); return; }
  if (!isNonEmptyString(p.id)) errors.push(`${path}.id: required non-empty string`);
  if (!isNonEmptyString(p.label)) errors.push(`${path}.label: required non-empty string`);
  if (typeof p.active !== 'boolean') errors.push(`${path}.active: required boolean`);
  if (p.since !== undefined) checkDate(p.since, `${path}.since`, errors);
}

/**
 * Ids only need to be unique enough to key a DOM element / a future deep
 * link, so this checks uniqueness globally across all four lists rather
 * than per-list -- simpler to reason about, and a stricter rule than the
 * schema technically requires.
 */
function findDuplicateIds(paper) {
  const allIds = [
    ...(paper.milestones || []),
    ...(paper.slots || []),
    ...(paper.events || []),
    ...(paper.processes || []),
  ].map((item) => item && item.id).filter(Boolean);

  const seen = new Set();
  const duplicates = new Set();
  for (const id of allIds) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return Array.from(duplicates);
}

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

/**
 * Validates a parsed paper object against the same rules as
 * data/schema/paper.schema.json, plus date-range and duplicate-id checks
 * that plain JSON Schema can't express.
 * @param {unknown} paper
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePaper(paper) {
  const errors = [];
  if (typeof paper !== 'object' || paper === null) {
    return { valid: false, errors: ['Root: expected a JSON object'] };
  }

  if (!isNonEmptyString(paper.id) || !ID_RE.test(paper.id)) {
    errors.push('id: required, lowercase letters/digits/hyphens only, e.g. "my-paper-2027"');
  }
  if (!isNonEmptyString(paper.title)) errors.push('title: required non-empty string');
  if (!Array.isArray(paper.authors) || paper.authors.length === 0 || !paper.authors.every(isNonEmptyString)) {
    errors.push('authors: required non-empty array of non-empty strings');
  }
  checkEnum(paper.status, STATUS_ENUM, 'status', errors);

  if (typeof paper.timeline !== 'object' || paper.timeline === null) {
    errors.push('timeline: required object with start/end');
  } else {
    checkRequiredDate(paper.timeline.start, 'timeline.start', errors);
    checkRequiredDate(paper.timeline.end, 'timeline.end', errors);
    checkDateRange(paper.timeline.start, paper.timeline.end, 'timeline', errors);
  }

  if (!Array.isArray(paper.milestones) || paper.milestones.length === 0) {
    errors.push('milestones: required non-empty array');
  } else {
    checkArrayOf(paper.milestones, 'milestones', errors, validateMilestone);
  }

  if (paper.slots !== undefined) checkArrayOf(paper.slots, 'slots', errors, validateSlot);
  if (paper.events !== undefined) checkArrayOf(paper.events, 'events', errors, validateEvent);
  if (paper.processes !== undefined) checkArrayOf(paper.processes, 'processes', errors, validateProcess);

  const duplicateIds = findDuplicateIds(paper);
  if (duplicateIds.length > 0) {
    errors.push(`duplicate id(s) across milestones/slots/events/processes: ${duplicateIds.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}
