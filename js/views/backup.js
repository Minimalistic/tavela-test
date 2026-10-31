import { h, icon } from '../dom.js';
import { BackupError, passphraseProblem } from '../backup.js';
import { createBackup } from '../restore.js';
import { recordBackupSaved } from '../backup-log.js';
import { formatDateTime, toOffsetIso } from '../time.js';

// Backup & Restore (docs/SPEC.md §13). Moves behind the reviewer PIN in
// session 6.
export async function renderBackup(app) {
  const datasetId = await app.store.getMeta('dataset_id');
  const lastBackup = await app.store.getMeta('last_backup_at');
  const log = (await app.store.getMeta('backup_log')) ?? [];
  return h('section', { class: 'backup' },
    h('h1', {}, 'Backup & Restore'),
    h('p', {}, 'Entries are stored only on this device. A backup is the only way to get them back if the device is lost, replaced or reset. Each backup is locked with a passphrase that is never stored on this device.'),
    h('dl', { class: 'facts' },
      h('dt', {}, 'Tracker ID'), h('dd', {}, datasetId),
      h('dt', {}, 'Last backup'), h('dd', {}, lastBackup ? formatDateTime(lastBackup) : 'Never')),
    h('div', { class: 'backup-actions' },
      h('button', { type: 'button', class: 'btn primary big', onclick: () => app.show('backup-create') }, 'Create Backup'),
      h('button', { type: 'button', class: 'btn big', onclick: () => app.show('restore', { verifyOnly: true }) }, 'Verify Backup'),
      h('button', { type: 'button', class: 'btn big', onclick: () => app.show('restore', { verifyOnly: false }) }, 'Restore from Backup')),
    backupHistory(log));
}

const SHOWN = 10;

// Each line is a confirmation, not proof: the app can't see Files or iCloud.
function backupHistory(log) {
  const row = ({ at, filename, entries }) => h('li', {},
    h('span', { class: 'history-when' }, formatDateTime(at)),
    h('span', { class: 'history-file' }, filename),
    h('span', { class: 'history-count' }, `${entries} ${entries === 1 ? 'entry' : 'entries'}`));
  const list = h('ol', { class: 'backup-history' }, log.slice(0, SHOWN).map(row));
  const showAll = log.length > SHOWN
    ? h('button', {
      type: 'button', class: 'btn small',
      onclick: () => { list.replaceChildren(...log.map(row)); showAll.remove(); },
    }, `Show all ${log.length}`)
    : null;
  return h('section', { class: 'history', 'aria-labelledby': 'history-title' },
    h('h2', { id: 'history-title' }, 'Backup history'),
    log.length === 0
      ? h('p', { class: 'empty' }, 'No backups yet.')
      : [h('p', { class: 'hint' }, 'Backups confirmed as saved somewhere other than this device, newest first.'), list, showAll]);
}

export function passphraseInput(id) {
  return h('input', {
    id, type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'passphrase',
  });
}

export function showPassphraseToggle(...inputs) {
  return h('label', { class: 'filter-check' },
    h('input', {
      type: 'checkbox',
      onchange: (event) => { for (const input of inputs) input.type = event.target.checked ? 'text' : 'password'; },
    }),
    'Show passphrase');
}

// Tablets and phones (iPad, iPhone, Android): the share sheet (Save to Files,
// AirDrop, Drive). A computer gets a plain
// download (Jason, 10-20), as does any browser that refuses to share this file
// type (desktop Chrome does, despite canShare saying yes). Touch decides it,
// not the user agent: iPad Safari reports itself as a Mac.
const usesShareSheet = () => matchMedia('(any-pointer: coarse)').matches && 'share' in navigator;

// download: true skips the share sheet (the ↓ button beside Save Backup File).
async function deliver(file, { download = false } = {}) {
  if (!download && usesShareSheet() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return false;
      console.warn('Tavela: share sheet refused the backup, downloading instead:', err?.name ?? 'unknown error');
    }
  }
  const url = URL.createObjectURL(file);
  h('a', { href: url, download: file.name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export function renderCreateBackup(app) {
  const first = passphraseInput('f-pass');
  const second = passphraseInput('f-pass2');
  const status = h('p', { class: 'save-status', role: 'status', 'aria-live': 'polite' });
  let file = null;
  let entries = 0;

  const fail = (message) => { status.className = 'save-status failed'; status.textContent = message; };
  const note = (message) => { status.className = 'save-status'; status.textContent = message; };

  const createButton = h('button', { type: 'button', class: 'btn primary big', onclick: create }, 'Create Backup');
  const entry = h('div', {},
    h('div', { class: 'group text-group' },
      h('label', { for: 'f-pass' }, 'Backup passphrase'),
      h('p', { class: 'hint field-hint' }, 'At least 14 characters, or 4 or more words. Without it, nobody can open this backup, including the app\'s maker.'),
      first),
    h('div', { class: 'group text-group' }, h('label', { for: 'f-pass2' }, 'Type it again'), second),
    showPassphraseToggle(first, second),
    h('div', { class: 'detail-actions' }, createButton));

  // A separate tap for the share sheet: iPadOS only opens it straight from a
  // tap, and encrypting takes a few seconds.
  const savePanel = h('div', { class: 'void-panel calm', hidden: true },
    h('h2', {}, 'Backup ready'),
    h('p', {}, 'Save it somewhere other than this device: a cloud drive, a computer, or a USB drive.'),
    // Split button on touch devices (Jason, 10-20): the main part opens the
    // share sheet, the ↓ part downloads straight to Downloads.
    h('div', { class: 'ask-buttons start' },
      h('div', { class: 'split-button' },
        h('button', { type: 'button', class: 'btn primary big', onclick: () => share() }, 'Save Backup File'),
        usesShareSheet()
          ? h('button', {
            type: 'button', class: 'btn primary big split-end', 'aria-label': 'Download the file instead', title: 'Download instead',
            onclick: () => share({ download: true }),
          }, icon('download'))
          : null)));

  const askPanel = h('div', { class: 'void-panel calm', hidden: true },
    h('h2', {}, 'Did you save it somewhere other than this device?'),
    h('div', { class: 'ask-buttons start' },
      h('button', { type: 'button', class: 'btn primary', onclick: confirmSaved }, 'Yes, it\'s saved elsewhere'),
      h('button', { type: 'button', class: 'btn', onclick: () => share() }, 'No, save it again')));

  async function create() {
    const problem = passphraseProblem(first.value, second.value);
    if (problem) {
      fail(problem);
      return;
    }
    createButton.disabled = true;
    note('Encrypting and checking the backup. This takes a few seconds…');
    try {
      const backup = await createBackup(app.store, first.value);
      file = new File([backup.text], backup.filename, { type: 'application/json' });
      entries = backup.entries;
      first.value = '';
      second.value = '';
      entry.hidden = true;
      savePanel.hidden = false;
      note('');
    } catch (err) {
      console.error('Tavela: backup failed:', err?.name ?? 'unknown error');
      fail(err instanceof BackupError
        ? `Backup not made: the new file failed its check (${err.detail ?? err.code}). Nothing was changed. Please report this.`
        : 'Backup not made. Nothing was changed. Try again.');
    } finally {
      createButton.disabled = false;
    }
  }

  async function share(options) {
    try {
      if (await deliver(file, options)) {
        savePanel.hidden = true;
        askPanel.hidden = false;
        note('');
      } else {
        note('Not saved yet. Tap Save Backup File to try again.');
      }
    } catch (err) {
      console.error('Tavela: sharing the backup failed:', err?.name ?? 'unknown error');
      fail('The file could not be shared. Tap Save Backup File to try again.');
    }
  }

  // Only a confirmed off-device copy counts as the last backup; the update
  // flow (session 5) relies on it.
  async function confirmSaved() {
    const now = toOffsetIso(new Date());
    try {
      await recordBackupSaved(app.store, { at: now, filename: file.name, entries });
    } catch (err) {
      console.error('Tavela: recording the backup time failed:', err?.name ?? 'unknown error');
      fail('The backup file is fine, but the backup time was not recorded. Tap Yes again.');
      return;
    }
    await app.refreshFooter();
    askPanel.replaceChildren(
      h('h2', {}, `✓ Backup saved · ${formatDateTime(now)}`),
      h('p', {}, 'Keep the passphrase somewhere safe and separate from this device.'),
      h('div', { class: 'ask-buttons start' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => app.show('backup') }, 'Done')));
  }

  return h('section', { class: 'backup' },
    h('h1', {}, 'Create Backup'),
    h('p', {}, 'Makes one encrypted file of every entry on this device, voided ones included.'),
    entry, status, savePanel, askPanel);
}
