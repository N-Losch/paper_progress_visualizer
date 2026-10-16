import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePaperIdFromHash, buildHashForPaper, shouldShowCard } from '../js/paper-switcher.js';

test('parsePaperIdFromHash reads the id out of a #paper=... hash', () => {
  assert.equal(parsePaperIdFromHash('#paper=my-paper'), 'my-paper');
  assert.equal(parsePaperIdFromHash('#paper=my-paper-2027'), 'my-paper-2027');
});

test('parsePaperIdFromHash returns empty string for an empty, missing, or unrelated hash', () => {
  assert.equal(parsePaperIdFromHash(''), '');
  assert.equal(parsePaperIdFromHash(undefined), '');
  assert.equal(parsePaperIdFromHash('#'), '');
  assert.equal(parsePaperIdFromHash('#somethingelse'), '');
});

test('parsePaperIdFromHash decodes URL-encoded ids', () => {
  assert.equal(parsePaperIdFromHash('#paper=my%20paper'), 'my paper');
});

test('buildHashForPaper and parsePaperIdFromHash round-trip', () => {
  const id = 'paper-with-dashes-2027';
  assert.equal(parsePaperIdFromHash(buildHashForPaper(id)), id);
});

test('shouldShowCard: empty selection shows every card', () => {
  assert.equal(shouldShowCard('paper-a', ''), true);
  assert.equal(shouldShowCard('paper-b', undefined), true);
});

test('shouldShowCard: a selection only shows the matching card', () => {
  assert.equal(shouldShowCard('paper-a', 'paper-a'), true);
  assert.equal(shouldShowCard('paper-b', 'paper-a'), false);
});

// ---------------------------------------------------------------------------
// Visualization style ("view") in the hash
// ---------------------------------------------------------------------------
import { parseViewFromHash, buildHash, DEFAULT_VIEW, VIEWS } from '../js/paper-switcher.js';

test('classic is the default view', () => {
  assert.equal(DEFAULT_VIEW, 'classic');
  assert.ok(VIEWS.includes('hig'));
});

test('parseViewFromHash falls back to the default for empty, old-style, or unknown hashes', () => {
  assert.equal(parseViewFromHash(''), 'classic');
  assert.equal(parseViewFromHash(undefined), 'classic');
  assert.equal(parseViewFromHash('#paper=my-paper'), 'classic');
  assert.equal(parseViewFromHash('#view=fancy'), 'classic');
});

test('parseViewFromHash reads the view alone or combined with a paper', () => {
  assert.equal(parseViewFromHash('#view=hig'), 'hig');
  assert.equal(parseViewFromHash('#paper=my-paper&view=hig'), 'hig');
  assert.equal(parseViewFromHash('#view=hig&paper=my-paper'), 'hig');
});

test('parsePaperIdFromHash still works when a view is present', () => {
  assert.equal(parsePaperIdFromHash('#paper=my-paper&view=hig'), 'my-paper');
  assert.equal(parsePaperIdFromHash('#view=hig&paper=my-paper'), 'my-paper');
  assert.equal(parsePaperIdFromHash('#view=hig'), '');
});

test('buildHash leaves the default view out so classic URLs are unchanged', () => {
  assert.equal(buildHash({ paper: 'a', view: 'classic' }), '#paper=a');
  assert.equal(buildHash({ paper: 'a' }), buildHashForPaper('a'));
  assert.equal(buildHash({ paper: '', view: 'classic' }), '');
  assert.equal(buildHash({}), '');
});

test('buildHash encodes a non-default view, with or without a paper, and round-trips', () => {
  assert.equal(buildHash({ view: 'hig' }), '#view=hig');
  const hash = buildHash({ paper: 'paper-2027', view: 'hig' });
  assert.equal(hash, '#paper=paper-2027&view=hig');
  assert.equal(parsePaperIdFromHash(hash), 'paper-2027');
  assert.equal(parseViewFromHash(hash), 'hig');
});

test('buildHash ignores unknown views', () => {
  assert.equal(buildHash({ paper: 'a', view: 'nope' }), '#paper=a');
});
