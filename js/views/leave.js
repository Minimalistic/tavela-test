import { ask } from '../dom.js';

// SPEC §6: leaving with unsaved input asks Discard / Continue editing.
export async function confirmLeave(dirty, editing) {
  if (!dirty) return true;
  const choice = await ask({
    title: editing ? 'Leave without saving your changes?' : 'Leave without saving?',
    body: editing ? 'Your changes have not been saved. The entry stays as it was.' : 'This entry has not been saved.',
    buttons: [
      { label: 'Discard', value: 'discard', kind: 'danger' },
      { label: 'Continue editing', value: 'stay', kind: 'primary' },
    ],
  });
  return choice === 'discard';
}
