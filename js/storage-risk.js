// Whether this browser may clear the stored entries on its own (DECISIONS
// "Storage at risk"). Safari tabs can lose site data after days unused, and an
// app added to the Home Screen is exempt; elsewhere a persistence grant
// protects it. persisted is true, false, or null when the browser can't say.
export const STORAGE_AT_RISK = 'Install Handstead to protect your records.';

export function storageRiskLine({ installed, persisted, demo }) {
  // Demo data is throwaway, and the demo footer already says so.
  if (demo || installed || persisted === true) return null;
  return STORAGE_AT_RISK;
}

// The same warning as a card at the top of Home, where it's seen every visit
// instead of sitting in the footer below the fold. One calm line that says
// what to do, with the steps folded under "How to install" (ACCEPTANCE
// "Shorter install banner"). It can't be dismissed: it goes away once the
// risk does (installed, or a grant).
export const STORAGE_BANNER = {
  title: 'Install Handstead to protect your records',
  more: 'How to install',
};

// The steps differ by device, in each one's own words. iPadOS Safari calls
// itself a Mac, so a Mac user agent with touch points is an iPad.
export const INSTALL_STEPS = {
  apple: ['Tap Share (the square with an arrow).', 'Tap Add to Home Screen.', 'Open Handstead from the new icon.'],
  android: ['Tap ⋮ at the top right of Chrome.', 'Tap Install app or Add to Home screen.', 'Open Handstead from the new icon.'],
  other: ["Use your browser's Install or Add to Home Screen option.", 'Open Handstead from there.'],
};

export function installPlatform({ userAgent = '', maxTouchPoints = 0 } = {}) {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 0)) return 'apple';
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}

export function storageRiskBanner(state, device = {}) {
  if (!storageRiskLine(state)) return null;
  return { ...STORAGE_BANNER, steps: INSTALL_STEPS[installPlatform(device)] };
}
