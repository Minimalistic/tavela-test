// Fixed fictional sample entries. The v1 fixture backup is built from these
// (tools/make-fixture.mjs), so they never change; demo mode (demo-data.js)
// replaced the "Add sample entries" button in session 4.
import { newBathroomDraft, normalize, toRecord } from './bathroom.js';
import { newHandoffDraft, toRecord as handoffRecord } from './handoff.js';
import { toOffsetIso } from './time.js';

// tavela-test.marsh.city hosts the public test build on its own origin, so
// nothing else on marsh.city shares its storage (ACCEPTANCE "Test build on its
// own subdomain"). Exact names only, so look-alike hosts never count.
const DEV_HOSTS = new Set(['127.0.0.1', 'localhost', 'tavela-test.marsh.city']);

export function isDevHost(hostname) {
  return DEV_HOSTS.has(hostname) || hostname.endsWith('.ts.net');
}

// [days ago, hour, minute, site, answers]
const SAMPLES = [
  [2, 7, 10, 'home', { event_code: 'pee', pain_code: 'no', urine_change_code: 'none_noticed' }],
  [2, 8, 5, 'home', { event_code: 'bm', pain_code: 'no', bristol_type: 4, bm_amount: 'medium' }],
  [2, 10, 40, 'day_program', { event_code: 'pee', pain_code: 'no', urine_change_code: 'not_assessed' }],
  [2, 13, 15, 'day_program', { event_code: 'attempt_no_output', attempt_target: 'urinate', pain_code: 'unsure' }],
  [2, 19, 30, 'home', { event_code: 'bowel_care', bowel_care_status: 'completed', notes: 'Sample: calm throughout, no BM afterward yet.' }],
  [1, 6, 55, 'home', { event_code: 'pee', pain_code: 'yes', urine_change_code: 'change', urine_change_details: ['darker', 'strong_odor'], concern_codes: ['nurse_notified'], notes: 'Sample: said "ow" twice.' }],
  [1, 11, 20, 'day_program', { event_code: 'both', pain_code: 'no', urine_change_code: 'none_noticed', bristol_type: 2, bm_amount: 'small' }],
  [1, 14, 0, 'community', { event_code: 'urine_accident', pain_code: 'unsure', urine_change_code: 'not_assessed', initials: 'XX', notes: 'Sample: happened during the store trip; changed clothes after.' }],
  [1, 20, 10, 'home', { event_code: 'pee', pain_code: 'no', urine_change_code: 'none_noticed' }],
  [0, 7, 30, 'home', { event_code: 'stool_accident', bristol_type: 6, bm_amount: 'unsure', notes: 'Sample: seemed uncomfortable before, more settled after.' }],
  [0, 9, 45, 'day_program', { event_code: 'pee', pain_code: 'no', urine_change_code: 'change', urine_change_details: ['cloudy'], concern_codes: ['no_concern'] }],
  [0, 12, 30, 'other', { event_code: 'bm', bristol_type: 'unable' }],
];

const am = (answers) => ({
  sleep_code: 'slept_well', breakfast_code: 'ate_all', routine_code: 'typical', alertness_code: 'typical',
  comfort: 4, behavior_codes: [], behavior_state: 'none_observed', bathroom_coverage_code: 'all_logged', ...answers,
});
const pm = (answers) => ({
  work_tasks_code: 'typical_support', am_support_code: 'typical_support', pm_support_code: 'typical_support',
  lunch_code: 'ate_all', still_hungry_code: 'no', alertness_code: 'typical', comfort: 4,
  behavior_codes: [], behavior_state: 'none_observed', bathroom_coverage_code: 'all_logged', ...answers,
});

// [days ago, hour, minute, site, type, answers]
const HANDOFF_SAMPLES = [
  [2, 7, 50, 'home', 'home_am', am({ positive_note: 'Sample: hummed along to the radio while getting ready.' })],
  [2, 15, 0, 'day_program', 'day_pm', pm({
    work_tasks_code: 'more_independent', positive_note: 'Sample: sorted the whole bin without prompting.',
  })],
  [1, 7, 45, 'home', 'home_am', am({
    sleep_code: 'disrupted', alertness_code: 'tired', comfort: 2, breakfast_code: 'ate_some',
    handoff_note: 'Sample: up twice overnight; may need a quiet start.',
  })],
  [1, 15, 10, 'day_program', 'day_pm', pm({
    pm_support_code: 'more_support', still_hungry_code: 'yes', comfort: 3,
    behavior_codes: ['slapping_self', 'other'], behavior_state: 'some', bathroom_coverage_code: 'some_missing',
    behavior_other_note: 'Sample: threw a cup',
    handoff_note: 'Sample: brief self-slapping around 1 PM, settled with a break.',
    positive_note: 'Sample: laughed at the group game.',
  })],
  [0, 7, 40, 'home', 'home_am', am({ routine_code: 'not_observed', behavior_state: 'not_observed', comfort: 'unable' })],
];

export function sampleHandoffs(now = new Date()) {
  return HANDOFF_SAMPLES.map(([daysAgo, hour, minute, site, type, answers], index) => {
    const when = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute);
    const occurredAt = toOffsetIso(when);
    const id = `00000000-0000-4000-8000-${String(SAMPLES.length + index + 1).padStart(12, '0')}`;
    return handoffRecord({ ...newHandoffDraft({ id, type, occurredAt, siteCode: site }), ...answers }, occurredAt);
  });
}

export function sampleRecords(now = new Date()) {
  return SAMPLES.map(([daysAgo, hour, minute, site, answers], index) => {
    const when = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute);
    const occurredAt = toOffsetIso(when);
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const draft = normalize({ ...newBathroomDraft({ id, occurredAt, siteCode: site }), ...answers });
    return toRecord(draft, occurredAt);
  });
}
