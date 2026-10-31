// Dataset ID (docs/SPEC.md §15.4): names the dataset, not the device, so it
// travels in backups and survives restores.

// Crockford Base32: no I, L, O or U, so it reads back unambiguously.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const DATASET_ID_PATTERN = /^TRK-[0-9A-HJKMNP-TV-Z]{6}$/;

export function newDatasetId(random = globalThis.crypto) {
  const bytes = random.getRandomValues(new Uint8Array(6));
  // 256 is a multiple of 32, so the low five bits are uniform.
  return `TRK-${[...bytes].map((byte) => CROCKFORD[byte & 31]).join('')}`;
}

// First-run setup takes this over in session 6; until then the ID is made the
// first time the app opens.
export async function ensureDatasetId(store, random = globalThis.crypto) {
  const existing = await store.getMeta('dataset_id');
  if (existing) return existing;
  const id = newDatasetId(random);
  await store.setMeta('dataset_id', id);
  return id;
}
