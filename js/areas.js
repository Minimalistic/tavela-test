// Visual language (DECISIONS: "App-wide visual language"): every entry type
// belongs to one area, and an area has one colour (an --area-* token in
// app.css) and one icon (icons.js), used the same way on Home, form headers,
// list rows and reports. Colour never carries meaning alone: the words and
// the icon always come with it. Pure, so tests can hold it steady.

export const AREAS = ['bathroom', 'bowel', 'comfort', 'behavior', 'handoff', 'backup'];

const HANDOFF_ICONS = { home_am: 'morning', day_pm: 'afternoon' };
const BOWEL_EVENTS = new Set(['bm', 'stool_accident', 'bowel_care']);

export function entryArea(record) {
  if (record.summary_type) return 'handoff';
  return BOWEL_EVENTS.has(record.event_code) ? 'bowel' : 'bathroom';
}

// Bathroom events show what happened; event codes double as icon names.
export function entryIcon(record) {
  return record.summary_type ? HANDOFF_ICONS[record.summary_type] : record.event_code ?? 'checkin';
}

export const handoffIcon = (type) => HANDOFF_ICONS[type];
