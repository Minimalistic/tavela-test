// The screen side of draft.js: a form keeps its unsaved entry on the device,
// Home offers it back, and no form replaces one without asking.
import { h, ask } from '../dom.js';
import {
  DRAFT_KEY, makeDraft, readDraft, draftCard, formName, storeFor, viewFor, resumeProblem,
  whenStarted, DRAFT_UNREADABLE,
} from '../draft.js';
import { toOffsetIso } from '../time.js';

const warn = (what, err) => console.warn(`Tavela: could not ${what} the unsaved entry:`, err?.name ?? 'unknown error');

export async function loadDraft(store) {
  return readDraft(await store.getMeta(DRAFT_KEY));
}

export function removeDraft(store) {
  return store.setMeta(DRAFT_KEY, null).catch((err) => warn('remove', err));
}

// Called by a form once it's built. A short wait after each change keeps
// typing from writing on every key; going to the background writes at once,
// since that is when iPadOS may close the app. A form back to how it opened
// removes what it kept. resumed is the draft the form reopened, if any.
export function keepDraft(store, { kind, editing, baseUpdatedAt, getDraft, isDirty, isLive, resumed = null }) {
  const startedAt = resumed?.started_at ?? toOffsetIso(new Date());
  let kept = Boolean(resumed);
  let timer = null;
  let stopped = false;

  function write() {
    clearTimeout(timer);
    timer = null;
    if (stopped) return;
    if (!isLive()) { stop(); return; }
    if (isDirty()) {
      kept = true;
      store.setMeta(DRAFT_KEY, makeDraft({ kind, editing, baseUpdatedAt, startedAt, data: getDraft() }))
        .catch((err) => warn('keep', err));
    } else if (kept) {
      kept = false;
      removeDraft(store);
    }
  }
  const onVisibility = () => { if (document.visibilityState === 'hidden') write(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', write);

  function stop() {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', write);
  }

  return {
    changed() {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(write, 300);
    },
    // Saved, or discarded on purpose.
    async clear() {
      stop();
      await removeDraft(store);
    },
  };
}

// Before a form opens fresh: an unsaved entry is never replaced without a
// choice. isCurrent says whether this screen change is still the newest one;
// if another overtook it while the question was up, nothing is removed.
// Returns { go: true } to open the form asked for, { resume: { name, params } }
// to open the kept entry instead (show() draws it, so history stays in step),
// or {} when overtaken.
export async function checkBeforeForm(app, isCurrent) {
  const found = await loadDraft(app.store).catch((err) => {
    warn('read', err);
    return null;
  });
  if (!found) return { go: true };
  if (!found.ok) {
    await removeDraft(app.store);
    return { go: true };
  }
  const { draft } = found;
  const choice = await ask({
    title: draft.editing
      ? `There are unsaved changes to ${article(formName(draft))} ${formName(draft)} from ${whenStarted(draft.started_at)}`
      : `There\u2019s an unsaved ${formName(draft)} from ${whenStarted(draft.started_at)}`,
    body: 'Starting this one removes it.',
    buttons: [
      { label: 'Discard it and start this', value: 'discard', kind: 'danger' },
      { label: 'Resume that', value: 'resume', kind: 'primary' },
    ],
  });
  if (!isCurrent()) return {};
  if (choice === 'discard') {
    await removeDraft(app.store);
    return { go: true };
  }
  const opened = await prepareResume(app, draft);
  if (opened.ok) return { resume: opened };
  await ask({ title: opened.message, buttons: [{ label: 'OK', value: 'ok', kind: 'primary' }] });
  return isCurrent() ? { go: true } : {};
}

// The screen and params that reopen a kept entry, after checking it can be:
// an edit only goes back onto the entry as it was, and a new entry is never
// resumed over one already saved with its id. A draft that fails is removed;
// one that couldn't be checked (a storage error) is kept for another try.
async function prepareResume(app, draft) {
  let saved;
  try {
    saved = (await app.store.get(storeFor(draft), draft.data.id)) ?? null;
  } catch (err) {
    warn('check', err);
    return { ok: false, message: COULD_NOT_CHECK };
  }
  const problem = resumeProblem(draft, saved);
  if (problem) {
    await removeDraft(app.store);
    return { ok: false, message: problem };
  }
  return {
    ok: true,
    name: viewFor(draft),
    params: { resume: draft, record: draft.editing ? saved : null, type: draft.data.summary_type },
  };
}

// From Home's card, where nothing else is opening.
export async function resumeDraft(app, draft) {
  const opened = await prepareResume(app, draft);
  if (opened.ok) await app.show(opened.name, opened.params);
  return opened;
}

const COULD_NOT_CHECK = 'Tavela couldn\u2019t open the unsaved entry just now. It\u2019s still kept. Try again.';
const article = (name) => (/^[AEIOU]/.test(name) ? 'an' : 'a');

// Home's card. Returns null when nothing is kept. A draft that can't be
// reopened is removed and said once.
export async function draftCardFor(app) {
  const found = await loadDraft(app.store).catch((err) => {
    warn('read', err);
    return null;
  });
  if (!found) return null;
  if (!found.ok) {
    await removeDraft(app.store);
    return h('div', { class: 'draft-card', role: 'status' }, h('p', {}, DRAFT_UNREADABLE));
  }
  const { draft } = found;
  const { title, note } = draftCard(draft);
  const card = h('div', { class: 'draft-card' },
    h('p', { class: 'draft-card-title' }, title),
    note ? h('p', {}, note) : null,
    h('div', { class: 'draft-card-buttons' },
      h('button', {
        type: 'button', class: 'btn small primary',
        onclick: async () => {
          const result = await resumeDraft(app, draft);
          if (!result.ok) card.replaceChildren(h('p', { role: 'status' }, result.message));
        },
      }, 'Resume'),
      h('button', {
        type: 'button', class: 'btn small',
        onclick: async () => {
          const choice = await ask({
            title: 'Discard this unsaved entry?',
            body: 'It can’t be brought back.',
            buttons: [
              { label: 'Discard', value: 'discard', kind: 'danger' },
              { label: 'Keep it', value: 'keep', kind: 'primary' },
            ],
          });
          if (choice !== 'discard') return;
          await removeDraft(app.store);
          card.remove();
        },
      }, 'Discard')));
  return card;
}
