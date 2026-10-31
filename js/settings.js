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

export function siteOptions(settings) {
  return Object.entries(settings.site_labels).map(([code, label]) => ({ code, label }));
}
