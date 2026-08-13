// paper-switcher.js
// Deliberately DOM-free: these are the three small decisions the dropdown
// filter needs to make, pulled out of dashboard.js so they can be unit
// tested in plain Node instead of requiring a browser test runner.

/**
 * Extract a paper id from a URL hash like "#paper=my-paper-id".
 * Returns '' if the hash doesn't contain a paper id.
 */
export function parsePaperIdFromHash(hash) {
  const match = String(hash || '').match(/paper=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Build the URL hash string (including the leading #) for a given paper id.
 */
export function buildHashForPaper(id) {
  return `#paper=${encodeURIComponent(id)}`;
}

/**
 * Whether a card with the given id should be visible for the current
 * selection. An empty/falsy selectedId means "show everything".
 */
export function shouldShowCard(cardId, selectedId) {
  return !selectedId || cardId === selectedId;
}
