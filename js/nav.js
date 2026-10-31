// Browser history for screens (Jason, 10-31: Safari's swipe back didn't
// work). Each history entry holds a screen name and, for one entry, its id and
// store: never record contents, and nothing goes in the URL (SPEC §3).
// Pure functions; main.js does the history calls.
import { storeFor } from './entries.js';

// What a history entry keeps of a screen's params. Transient flags like
// `saved` are dropped: going back to a screen doesn't repeat its message.
export function entryFor(view, params = {}) {
  const kept = {};
  if (params.type) kept.type = params.type;
  if (params.verifyOnly) kept.verifyOnly = true;
  if (params.pickDate) kept.pickDate = true;
  if (params.record) {
    kept.recordId = params.record.id;
    kept.recordStore = storeFor(params.record);
  }
  return { view, params: kept };
}

export const sameEntry = (a, b) =>
  Boolean(a && b) && a.view === b.view && JSON.stringify(a.params) === JSON.stringify(b.params);

// Where to send history when the app opens `target` itself. Redrawing the
// current screen (a filter change, Home's midnight refresh) adds no step. If
// an earlier step is that screen (Home, Cancel, Back to records), go back to
// it; otherwise push a new step.
export function planNavigation(stack, depth, target) {
  if (sameEntry(stack[depth], target)) return { stay: true };
  for (let i = depth - 1; i >= 0; i--) {
    if (sameEntry(stack[i], target)) return { go: i - depth };
  }
  return { push: true };
}
