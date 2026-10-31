// Whether this browser may clear the stored entries on its own (DECISIONS
// "Storage at risk"). Safari tabs can lose site data after days unused, and an
// app added to the Home Screen is exempt; elsewhere a persistence grant
// protects it. persisted is true, false, or null when the browser can't say.
export const STORAGE_AT_RISK =
  'Not on the Home Screen: this browser may clear these entries. Add Tavela to the Home Screen.';

export function storageRiskLine({ installed, persisted, demo }) {
  // Demo data is throwaway, and the demo footer already says so.
  if (demo || installed || persisted === true) return null;
  return STORAGE_AT_RISK;
}
