import { h } from '../dom.js';
import { BackupError, MAX_FILE_BYTES } from '../backup.js';
import { openBackup, planRestore, applyRestore, readLocal } from '../restore.js';
import { formatDateTime } from '../time.js';
import { entryTitle } from './records.js';
import { passphraseInput, showPassphraseToggle } from './backup.js';

const entries = (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

function summary(header, data) {
  return h('dl', { class: 'facts' },
    h('dt', {}, 'Tracker ID'), h('dd', {}, header.dataset_id),
    h('dt', {}, 'Made'), h('dd', {}, formatDateTime(header.created_at)),
    h('dt', {}, 'App version'), h('dd', {}, header.app_version),
    h('dt', {}, 'Data version'), h('dd', {}, String(header.schema_version)),
    h('dt', {}, 'Bathroom Check-Ins'), h('dd', {}, String(data.bathroom_events.length)),
    h('dt', {}, 'Updates'), h('dd', {}, String(data.handoffs.length)));
}

// Verify Backup and Restore share the open step (SPEC §13.4: verify never
// imports anything).
export function renderRestore(app, { verifyOnly = false } = {}) {
  const fileInput = h('input', { id: 'f-file', type: 'file' });
  const pass = passphraseInput('f-pass');
  const status = h('p', { class: 'save-status', role: 'status', 'aria-live': 'polite' });
  const result = h('div', { class: 'restore-result' });
  const fail = (message) => { status.className = 'save-status failed'; status.textContent = message; };
  const note = (message) => { status.className = 'save-status'; status.textContent = message; };

  const openButton = h('button', { type: 'button', class: 'btn primary big', onclick: open }, 'Open Backup');

  async function open() {
    result.replaceChildren();
    const file = fileInput.files[0];
    if (!file) {
      fail('Choose a backup file first.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      fail(new BackupError('too_large').message);
      return;
    }
    openButton.disabled = true;
    note('Opening and checking the backup. This takes a few seconds…');
    try {
      const { header, data } = await openBackup(await file.text(), pass.value);
      pass.value = '';
      note('');
      if (verifyOnly) {
        result.replaceChildren(
          h('p', { class: 'saved-inline' }, '✓ This backup opens and its contents check out. Nothing was imported.'),
          summary(header, data));
      } else {
        result.replaceChildren(summary(header, data), preview(planRestore(await readLocal(app.store), data)));
      }
    } catch (err) {
      if (err instanceof BackupError) {
        fail(err.detail ? `${err.message} (${err.detail})` : err.message);
      } else {
        console.error('Tavela: opening a backup failed:', err?.name ?? 'unknown error');
        fail('This file could not be opened. Nothing was changed.');
      }
    } finally {
      openButton.disabled = false;
    }
  }

  async function restore(plan, how, confirmation, button) {
    button.disabled = true;
    note('Restoring…');
    let outcome;
    try {
      outcome = await applyRestore(app.store, plan, { how, confirmation });
    } catch (err) {
      console.error('Tavela: restore refused:', err?.name ?? 'unknown error');
      outcome = { ok: false, message: 'Not restored. Nothing on this device was changed.' };
    }
    button.disabled = false;
    if (!outcome.ok) {
      fail(outcome.message);
      return;
    }
    note('');
    const now = await readLocal(app.store);
    result.replaceChildren(
      h('h2', {}, '✓ Restored'),
      h('p', {}, `This device now has ${entries(now.bathroom_events.length + now.handoffs.length)}.`),
      h('div', { class: 'ask-buttons start' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => app.show('records') }, 'Go to Records')));
  }

  function preview(plan) {
    if (plan.mode === 'replace') {
      const button = h('button', { type: 'button', class: 'btn primary big' }, `Restore ${entries(plan.incomingTotal)}`);
      button.addEventListener('click', () => restore(plan, 'replace', '', button));
      return h('div', { class: 'preview' },
        h('h2', {}, 'What will happen'),
        h('p', {}, 'This device has no entries, so everything in the backup is added.'),
        button);
    }

    if (plan.mode === 'mismatch') {
      const typed = h('input', { id: 'f-confirm', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
      const button = h('button', { type: 'button', class: 'btn danger big', disabled: true }, 'Replace Everything');
      typed.addEventListener('input', () => { button.disabled = typed.value.trim().toUpperCase() !== plan.datasetId; });
      button.addEventListener('click', () => restore(plan, 'replace', typed.value, button));
      return h('div', { class: 'preview alert-box', role: 'alert' },
        h('h2', {}, `This backup belongs to a different tracker (${plan.datasetId}). Restoring would mix two people's records.`),
        h('p', {}, 'Merging is blocked. You can replace everything on this device with this backup instead.'),
        h('p', {}, h('strong', {}, `The ${entries(plan.localTotal)} on this device would be deleted.`),
          ' Make a backup of this device first if they might be needed.'),
        h('label', { for: 'f-confirm' }, `To replace, type ${plan.datasetId}`),
        typed,
        h('div', { class: 'detail-actions' }, button));
    }

    const { counts, conflicts, writes } = plan;
    const changes = writes.bathroom_events.length + writes.handoffs.length;
    const button = h('button', { type: 'button', class: 'btn primary big' }, 'Restore');
    button.addEventListener('click', () => restore(plan, 'merge', '', button));
    return h('div', { class: 'preview' },
      h('h2', {}, 'What will happen'),
      h('ul', { class: 'preview-counts' },
        h('li', {}, h('strong', {}, String(counts.new)), ' new: will be added'),
        h('li', {}, h('strong', {}, String(counts.duplicate)), ' already on this device: no change'),
        h('li', {}, h('strong', {}, String(counts.updated)), ' newer in the backup: this device\'s copy will be updated'),
        h('li', {}, h('strong', {}, String(counts.conflicting)), ' changed more recently on this device: this device\'s copy is kept')),
      conflicts.length > 0
        ? h('div', {},
          h('p', {}, 'Kept as they are on this device (a void from either copy still applies):'),
          h('ul', { class: 'conflict-list' }, conflicts.map((record) =>
            h('li', {}, `${entryTitle(record)} · ${formatDateTime(record.occurred_at)}`))))
        : null,
      h('p', {}, 'Entries on this device that aren\'t in the backup are left as they are.'),
      changes > 0 ? button : h('p', { class: 'saved-inline' }, 'Nothing to restore: this device already has everything in this backup.'));
  }

  return h('section', { class: 'backup' },
    h('h1', {}, verifyOnly ? 'Verify Backup' : 'Restore from Backup'),
    h('p', {}, verifyOnly
      ? 'Checks that a backup file opens with its passphrase and shows what it holds. It never imports anything.'
      : 'Choose a backup file and enter its passphrase. You\'ll see what would change before anything is restored.'),
    h('div', { class: 'group text-group' }, h('label', { for: 'f-file' }, 'Backup file'), fileInput),
    h('div', { class: 'group text-group' }, h('label', { for: 'f-pass' }, 'Backup passphrase'), pass),
    showPassphraseToggle(pass),
    h('div', { class: 'detail-actions' }, openButton),
    status,
    result);
}
