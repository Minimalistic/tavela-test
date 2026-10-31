// Encrypted backup file (docs/SPEC.md §13.1): a plain JSON header plus an
// AES-GCM payload. Uses Web Crypto only, so the same code runs in the app and
// under node:test. A backup file is untrusted input: every header field is
// checked before it is used, and decrypting proves nothing about the contents
// (restore.js validates those).
import { DATASET_ID_PATTERN } from './dataset.js';

// Keeps the app's first name (DECISIONS "Name") so every backup made so far
// still restores; the tag is checked here and bound into the encryption.
export const FORMAT = 'tendwell-backup';
// Compound extension: .json tells iPadOS what the file is (it previews,
// AirDrops and attaches without questions); .tavela keeps it recognisable.
// The app identifies a backup by `format` inside, never by the name.
export const EXTENSION = '.tavela.json';
export const ENVELOPE_VERSION = 1;
export const APP_VERSION = '0.3.0';
export const KDF_ITERATIONS = 600_000;
// Upper bound so a hostile header can't make the device grind for minutes.
const MAX_ITERATIONS = 10_000_000;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const MESSAGES = {
  not_a_backup: 'This file isn\'t a Tavela backup. Nothing was changed.',
  too_large: 'This file is too large to be a Tavela backup. Nothing was changed.',
  newer: 'This backup was made by a newer version. Update the app first.',
  wrong_passphrase: 'The passphrase didn\'t open this backup. Check it and try again. If it is right, the file may be damaged. Nothing was changed.',
  damaged: 'This backup file is damaged or incomplete. Nothing was changed.',
  invalid: 'This backup holds entries Tavela can\'t read, so none were used. Nothing was changed.',
};

export class BackupError extends Error {
  // detail names the check that failed (a field, never its value), so a
  // refused file can be reported usefully.
  constructor(code, detail = null) {
    super(MESSAGES[code]);
    this.name = 'BackupError';
    this.code = code;
    this.detail = detail;
  }
}

function toBase64(bytes) {
  let binary = '';
  // Chunked: spreading a large array into fromCharCode overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(passphrase, salt, iterations, usage) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

// The header is bound to the ciphertext as AES-GCM additional data, so
// editing any header field (dataset ID, counts, version) makes it fail to open.
function headerBytes(header) {
  return new TextEncoder().encode(JSON.stringify([
    header.format, header.envelope_version, header.app_version, header.schema_version, header.dataset_id,
    header.created_at, header.record_counts.bathroom_events, header.record_counts.handoffs,
    header.kdf.name, header.kdf.hash, header.kdf.iterations, header.kdf.salt,
    header.cipher.name, header.cipher.iv, header.payload_sha256,
  ]));
}

// data: { schema_version, dataset_id, bathroom_events, handoffs }. Returns the
// file's text.
export async function encryptBackup({ data, passphrase, createdAt, iterations = KDF_ITERATIONS }) {
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    format: FORMAT,
    envelope_version: ENVELOPE_VERSION,
    app_version: APP_VERSION,
    schema_version: data.schema_version,
    dataset_id: data.dataset_id,
    created_at: createdAt,
    record_counts: { bathroom_events: data.bathroom_events.length, handoffs: data.handoffs.length },
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    payload_sha256: await sha256Hex(plaintext),
  };
  const key = await deriveKey(passphrase, salt, iterations, 'encrypt');
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: headerBytes(header) }, key, plaintext);
  return JSON.stringify({ ...header, payload: toBase64(new Uint8Array(ciphertext)) });
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;

function decodedLength(base64) {
  try {
    return fromBase64(base64).length;
  } catch {
    return -1;
  }
}

// Parses and checks the unencrypted header. Returns a fresh copy of only the
// known fields; nothing else from the file is carried along.
export function readEnvelope(text) {
  if (typeof text !== 'string') throw new BackupError('not_a_backup');
  if (text.length > MAX_FILE_BYTES) throw new BackupError('too_large');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('not_a_backup');
  }
  if (!isPlainObject(raw) || raw.format !== FORMAT) throw new BackupError('not_a_backup');
  if (raw.envelope_version !== ENVELOPE_VERSION) {
    throw new BackupError(Number.isInteger(raw.envelope_version) && raw.envelope_version > ENVELOPE_VERSION ? 'newer' : 'damaged');
  }
  const { kdf, cipher, record_counts: counts } = raw;
  const ok = typeof raw.app_version === 'string' && raw.app_version.length <= 32
    && Number.isInteger(raw.schema_version) && raw.schema_version >= 1
    && typeof raw.dataset_id === 'string' && DATASET_ID_PATTERN.test(raw.dataset_id)
    && typeof raw.created_at === 'string' && !Number.isNaN(Date.parse(raw.created_at))
    && isPlainObject(counts) && isCount(counts.bathroom_events) && isCount(counts.handoffs)
    && isPlainObject(kdf) && kdf.name === 'PBKDF2' && kdf.hash === 'SHA-256'
    && Number.isInteger(kdf.iterations) && kdf.iterations >= KDF_ITERATIONS && kdf.iterations <= MAX_ITERATIONS
    && typeof kdf.salt === 'string' && decodedLength(kdf.salt) >= 16 && decodedLength(kdf.salt) <= 64
    && isPlainObject(cipher) && cipher.name === 'AES-GCM'
    && typeof cipher.iv === 'string' && decodedLength(cipher.iv) === 12
    && typeof raw.payload === 'string' && decodedLength(raw.payload) > 16
    && typeof raw.payload_sha256 === 'string' && /^[0-9a-f]{64}$/.test(raw.payload_sha256);
  if (!ok) throw new BackupError('damaged');
  return {
    format: FORMAT,
    envelope_version: ENVELOPE_VERSION,
    app_version: raw.app_version,
    schema_version: raw.schema_version,
    dataset_id: raw.dataset_id,
    created_at: raw.created_at,
    record_counts: { bathroom_events: counts.bathroom_events, handoffs: counts.handoffs },
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: kdf.salt },
    cipher: { name: 'AES-GCM', iv: cipher.iv },
    payload: raw.payload,
    payload_sha256: raw.payload_sha256,
  };
}

// Returns the payload as parsed JSON: decrypted and checksummed, still
// unvalidated.
export async function decryptPayload(header, passphrase) {
  const key = await deriveKey(passphrase, fromBase64(header.kdf.salt), header.kdf.iterations, 'decrypt');
  let plaintext;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(header.cipher.iv), additionalData: headerBytes(header) },
      key, fromBase64(header.payload)));
  } catch {
    // AES-GCM can't tell a wrong passphrase from an edited file.
    throw new BackupError('wrong_passphrase');
  }
  if (await sha256Hex(plaintext) !== header.payload_sha256) throw new BackupError('damaged');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch {
    throw new BackupError('damaged');
  }
}

const pad = (n) => String(n).padStart(2, '0');

// TRK-7F3K9Q_backup_2026-10-20_1800.tavela.json, in local time.
export function backupFilename(datasetId, date) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${datasetId}_backup_${day}_${pad(date.getHours())}${pad(date.getMinutes())}${EXTENSION}`;
}

// SPEC §13.2 minimum. The generator, strength meter and weak-password list
// come with first-run setup (session 6).
export function passphraseProblem(passphrase, confirmation) {
  const words = passphrase.trim().split(/[\s-]+/).filter((word) => word.length >= 3);
  if (passphrase.length < 14 && words.length < 4) {
    return 'Use at least 14 characters, or 4 or more words.';
  }
  if (passphrase !== confirmation) return 'The two passphrases don\'t match.';
  return null;
}
