// paper-switcher.js
// Deliberately DOM-free: these are the small decisions the dashboard's
// "Viewing" and "Style" dropdowns need to make, pulled out of dashboard.js so
// they can be unit tested in plain Node instead of requiring a browser test
// runner.
//
// Both selections live in the URL hash, e.g. "#paper=my-paper&view=hig", so a
// filtered and/or restyled view is bookmarkable. Either part may be absent.

/** Visualization styles the dashboard can render. The first one is the default. */
export const VIEWS = ['classic', 'hig'];
export const DEFAULT_VIEW = VIEWS[0];

/**
 * Extract a paper id from a URL hash like "#paper=my-paper-id".
 * Returns '' if the hash doesn't contain a paper id.
 */
export function parsePaperIdFromHash(hash) {
  const match = String(hash || '').match(/(?:^#?|&)paper=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Extract the visualization style from a URL hash like "#view=hig".
 * Anything missing or unknown falls back to DEFAULT_VIEW, so old bookmarks
 * (which only ever contained "#paper=...") keep showing the classic view.
 */
export function parseViewFromHash(hash) {
  const match = String(hash || '').match(/(?:^#?|&)view=([^&]+)/);
  const view = match ? decodeURIComponent(match[1]) : '';
  return VIEWS.includes(view) ? view : DEFAULT_VIEW;
}

/**
 * Build the URL hash (including the leading #) for a selection. The default
 * view is left out so the classic URLs stay exactly as they were. Returns ''
 * when there is nothing to encode.
 */
export function buildHash({ paper = '', view = DEFAULT_VIEW } = {}) {
  const parts = [];
  if (paper) parts.push(`paper=${encodeURIComponent(paper)}`);
  if (view && view !== DEFAULT_VIEW && VIEWS.includes(view)) parts.push(`view=${encodeURIComponent(view)}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

/**
 * Build the URL hash string (including the leading #) for a given paper id.
 */
export function buildHashForPaper(id) {
  return buildHash({ paper: id });
}

/**
 * Whether a card with the given id should be visible for the current
 * selection. An empty/falsy selectedId means "show everything".
 */
export function shouldShowCard(cardId, selectedId) {
  return !selectedId || cardId === selectedId;
}
