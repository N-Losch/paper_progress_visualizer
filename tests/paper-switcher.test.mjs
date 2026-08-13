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
