// Wide screens (ACCEPTANCE "Built for the screen it's on"). The width matches
// the CSS breakpoint in app.css; at the accessibility Text Sizes
// (html.big-text) everything keeps one column.
export const WIDE_QUERY = '(min-width: 1100px)';

// Records shows the list and the open entry side by side, like iPad Mail.
export const splitRecords = ({ wide, bigText }) => Boolean(wide) && !bigText;

// Which entry the right side shows: the one picked, while it's still in the
// list; otherwise the newest (the list is newest first). Null when the list
// is empty.
export function openEntry(shown, picked) {
  if (picked && shown.some((record) => record.id === picked.id)) return shown.find((record) => record.id === picked.id);
  return shown[0] ?? null;
}
