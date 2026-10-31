// Tracker phrase (ACCEPTANCE.md "Tracker phrase"): the Tracker ID written as
// three words. Not a second identifier: TRK- plus six Crockford characters is
// 30 bits, and three words from 1,024 are 30 bits, so each code has exactly one
// phrase and each phrase one code. The code stays the stored form (SPEC §15.4).
import { DATASET_ID_PATTERN } from './dataset.js';
import { TRACKER_WORDS } from './tracker-words.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const WORD_INDEX = new Map(TRACKER_WORDS.map((word, index) => [word, index]));

// "TRK-7KQ2MX" -> "word-word-word", or null for anything that isn't a valid ID.
export function phraseFor(datasetId) {
  if (typeof datasetId !== 'string' || !DATASET_ID_PATTERN.test(datasetId)) return null;
  let bits = 0;
  for (const char of datasetId.slice(4)) bits = bits * 32 + CROCKFORD.indexOf(char);
  return [Math.floor(bits / 2 ** 20), Math.floor(bits / 2 ** 10) % 1024, bits % 1024]
    .map((index) => TRACKER_WORDS[index]).join('-');
}

// Forgiving about case, spaces and hyphens; never guesses. Returns the
// TRK- code, or null.
export function idForPhrase(text) {
  if (typeof text !== 'string') return null;
  const words = text.trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (words.length !== 3 || !words.every((word) => WORD_INDEX.has(word))) return null;
  let bits = words.reduce((acc, word) => acc * 1024 + WORD_INDEX.get(word), 0);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code = CROCKFORD[bits % 32] + code;
    bits = Math.floor(bits / 32);
  }
  return `TRK-${code}`;
}

// What a person typed to name a tracker, as a TRK- code: the code itself (any
// case) or its phrase. Null when it's neither.
export function trackerFromTyped(text) {
  if (typeof text !== 'string') return null;
  const asCode = text.trim().toUpperCase();
  return DATASET_ID_PATTERN.test(asCode) ? asCode : idForPhrase(text);
}
