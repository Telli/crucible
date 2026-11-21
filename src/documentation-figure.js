const FIGURE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/;

/** The one pattern that decides whether a docs paragraph is an image or video figure. */
export function figureMatch(paragraph) {
  return typeof paragraph === 'string' ? paragraph.match(FIGURE) : null;
}
