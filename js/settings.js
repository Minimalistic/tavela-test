// SPEC §21 defaults. First-run setup (session 6) will let the care team change
// labels; codes are fixed forever.
export const DEFAULT_SETTINGS = {
  display_name: 'Client',
  site_labels: {
    home: 'Home',
    day_program: 'Day program',
    community: 'Community',
    other: 'Other',
  },
};

// A code with no label (a later setting removed it) shows as the code itself.
export function siteLabel(settings, code) {
  return settings.site_labels[code] ?? code;
}

export function siteOptions(settings) {
  return Object.entries(settings.site_labels).map(([code, label]) => ({ code, label }));
}
