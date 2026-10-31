import { h, icon } from '../dom.js';
import { pressed } from './feedback.js';
import { toOffsetIso, toInputValue, fromInputValue, isFutureTime, minutesAgo } from '../time.js';

const TIME_SHORTCUTS = [
  { label: 'Now', minutes: 0 },
  { label: '15 min ago', minutes: 15 },
  { label: '30 min ago', minutes: 30 },
  { label: '1 hr ago', minutes: 60 },
];

// Shared field builders for the entry forms. Each form builds its fields once;
// sync() then reflects the draft into the inputs. Re-rendering per tap would
// steal focus from the text fields.
const areaIcon = (name, area) => h('span', { class: `area-${area}` }, icon(name));

// Return in a one-line box (text, time, a tile) would submit the form and
// save the whole entry while the person is still typing. Only Save saves;
// a textarea still gets its new line, and a focused button still presses.
export function blockImplicitSubmit(event) {
  if (event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement) event.preventDefault();
}

export function createFields({ getDraft, update }) {
  const groups = {};
  const errorEls = {};
  const isChecked = {};
  const textInputs = {};
  const scaleSyncs = [];
  // "Needed" marks stay hidden until Save is tapped too early, so a fresh
  // form doesn't open looking like a page of errors.
  let showNeeds = false;

  // Options with a `section` are laid out in labelled rows; it's still one
  // radio group, so arrow keys and VoiceOver move through all of them.
  // iconFor(option) gives [icon name, area] to show beside the label; the icon
  // is aria-hidden, and the option takes its area's colour. `area` colours the
  // whole question; without it the form's area applies.
  function radioGroup(field, legend, options, { columns = '', describe, iconFor, area } = {}) {
    errorEls[field] = h('p', { class: 'field-need', id: `need-${field}` });
    const tile = (option) => h('label', { class: iconFor ? `tile area-${iconFor(option)[1]}` : 'tile' },
      h('input', {
        type: 'radio', name: field, value: String(option.code),
        onchange: () => update({ [field]: option.code }),
      }),
      h('span', { class: 'tile-text' },
        h('span', { class: 'tile-label' }, iconFor ? [areaIcon(...iconFor(option)), ' '] : null, option.label),
        describe?.(option) ? h('span', { class: 'tile-sub' }, describe(option)) : null));
    const sections = [...new Set(options.map((option) => option.section).filter(Boolean))];
    const body = sections.length === 0
      ? h('div', { class: 'tiles' }, options.map(tile))
      : sections.map((section, index) => {
        const id = `sec-${field}-${index}`;
        return h('div', { class: 'tile-section', role: 'group', 'aria-labelledby': id },
          h('p', { class: 'tile-section-label', id }, section),
          h('div', { class: 'tiles' }, options.filter((option) => option.section === section).map(tile)));
      });
    const fieldset = h('fieldset', { class: `group ${columns} ${area ? `area-${area}` : ''}`, 'aria-describedby': `need-${field}` },
      h('legend', {}, legend),
      errorEls[field],
      body);
    groups[field] = fieldset;
    return fieldset;
  }

  // Ordered answers as one unbroken bar (Bristol hard → liquid, amount
  // small → large), so the order is visible. Tap a segment, or press and
  // slide: the description follows the finger, and nothing is chosen until
  // it lifts on a segment; sliding off the bar cancels. Each segment is still
  // a native radio named in full ("Type 4, Smooth, soft log"), so keyboards
  // and screen readers get the same group as before. `off` options (Unable
  // to tell, Unsure) sit beside the bar as ordinary buttons.
  function scaleGroup(field, legend, options, { off = [], ends = null, segText, name, describe, area } = {}) {
    errorEls[field] = h('p', { class: 'field-need', id: `need-${field}` });
    const onScale = options.filter((option) => !off.includes(option.code));
    const choose = (option) => update({ [field]: option.code });
    const segs = onScale.map((option) => h('label', { class: 'seg', 'data-code': String(option.code) },
      h('input', { type: 'radio', name: field, value: String(option.code), 'aria-label': name(option), onchange: () => choose(option) }),
      h('span', { class: 'seg-text', 'aria-hidden': 'true' }, segText(option))));
    const bar = h('div', { class: 'scale' }, segs);
    // The description has a fixed-width slot; a new type only swaps its words.
    const desc = ends ? h('span', { class: 'scale-desc' }) : null;
    const foot = ends ? h('div', { class: 'scale-foot', 'aria-hidden': 'true' }, h('span', {}, ends[0]), desc, h('span', {}, ends[1])) : null;
    const optionFor = (seg) => onScale.find((option) => String(option.code) === seg?.dataset.code);
    const chosen = () => onScale.find((option) => option.code === getDraft()[field]);
    const showDesc = (option) => {
      if (desc) desc.textContent = option ? describe(option) : 'Tap or slide';
    };

    let over = null;
    let pressEndedAt = -Infinity; // when this bar last finished a pointer press itself
    const segAt = (x, y) => {
      const box = bar.getBoundingClientRect();
      if (y < box.top - 40 || y > box.bottom + 40) return null; // slid off the bar
      return segs.find((seg) => {
        const r = seg.getBoundingClientRect();
        return x >= r.left - 2 && x <= r.right + 2;
      }) ?? null;
    };
    const preview = (seg) => {
      over = seg;
      for (const each of segs) each.classList.toggle('preview', each === seg);
      showDesc(seg ? optionFor(seg) : chosen());
    };
    bar.addEventListener('pointerdown', (event) => {
      if (event.button > 0) return;
      bar.setPointerCapture(event.pointerId);
      preview(segAt(event.clientX, event.clientY));
    });
    bar.addEventListener('pointermove', (event) => {
      if (!bar.hasPointerCapture(event.pointerId)) return;
      const seg = segAt(event.clientX, event.clientY);
      if (seg !== over) preview(seg);
    });
    bar.addEventListener('pointerup', () => {
      pressEndedAt = performance.now();
      const seg = over;
      preview(null);
      if (!seg) return;
      seg.querySelector('input').focus({ preventScroll: true });
      pressed(seg.querySelector('.seg-text'));
      choose(optionFor(seg));
    });
    bar.addEventListener('pointercancel', () => preview(null)); // the page scrolled instead
    // Pointer picks happen on lift (above), so the click that follows a
    // press is swallowed: it would pick again, or pick after a cancelled
    // slide. A click with no press just before it (keyboard, VoiceOver)
    // passes; the window means a press that never got its click can't
    // swallow a later one.
    bar.addEventListener('click', (event) => {
      if (performance.now() - pressEndedAt < 500) event.preventDefault();
    });

    const offTiles = options.filter((option) => off.includes(option.code)).map((option) => h('label', { class: 'tile' },
      h('input', { type: 'radio', name: field, value: String(option.code), onchange: () => choose(option) }),
      h('span', { class: 'tile-text' }, h('span', { class: 'tile-label' }, option.label))));
    scaleSyncs.push(() => {
      if (!over) showDesc(chosen());
    });
    const fieldset = h('fieldset', { class: `group scale-group ${area ? `area-${area}` : ''}`, 'aria-describedby': `need-${field}` },
      h('legend', {}, legend),
      errorEls[field],
      h('div', { class: 'scale-row' },
        h('div', { class: 'scale-wrap' }, bar, foot),
        offTiles.length ? h('div', { class: 'scale-off' }, offTiles) : null));
    groups[field] = fieldset;
    return fieldset;
  }

  // toggle(code) returns the changes to apply; checked(draft, code) reads them
  // back. Defaults treat draft[field] as a plain array of codes.
  function checkGroup(field, legend, options, toggle, checked = (draft, code) => draft[field].includes(code)) {
    errorEls[field] = h('p', { class: 'field-need', id: `need-${field}` });
    isChecked[field] = checked;
    const fieldset = h('fieldset', { class: 'group', 'aria-describedby': `need-${field}` },
      h('legend', {}, legend),
      errorEls[field],
      h('div', { class: 'tiles' }, options.map((option) =>
        h('label', { class: 'tile' },
          h('input', {
            type: 'checkbox', name: field, value: option.code,
            onchange: () => update(toggle(getDraft(), option.code)),
          }),
          h('span', { class: 'tile-text' }, h('span', { class: 'tile-label' }, option.label))))));
    groups[field] = fieldset;
    return fieldset;
  }

  function textField(field, label, { multiline = false, maxlength = 500, hint, className = '' } = {}) {
    const input = h(multiline ? 'textarea' : 'input', {
      id: `f-${field}`, name: field, maxlength, rows: multiline ? 3 : null,
      type: multiline ? null : 'text', autocomplete: 'off', autocapitalize: field === 'initials' ? 'characters' : 'sentences',
      oninput: (event) => update({ [field]: event.target.value }),
    });
    input.value = getDraft()[field] ?? '';
    if (hint) input.setAttribute('aria-describedby', `hint-${field}`);
    textInputs[field] = input;
    const wrap = h('div', { class: `group text-group ${className}` },
      h('label', { for: `f-${field}` }, label),
      hint ? h('p', { class: 'hint field-hint', id: `hint-${field}` }, hint) : null,
      input);
    groups[field] = wrap;
    return wrap;
  }

  let futureWarning;
  let whenInput;
  function whenGroup(label) {
    whenInput = h('input', {
      id: 'f-occurred_at', type: 'datetime-local', value: toInputValue(getDraft().occurred_at),
      onchange: (event) => update({ occurred_at: fromInputValue(event.target.value) }),
    });
    futureWarning = h('p', { class: 'warn', hidden: true, role: 'status' },
      'This time is in the future. Check the date and time.');
    errorEls.occurred_at = h('p', { class: 'field-need' });
    return h('div', { class: 'group' },
      h('label', { for: 'f-occurred_at', class: 'legend-like' }, label),
      errorEls.occurred_at,
      h('div', { class: 'when-row' }, whenInput,
        // One-tap times for logging after the fact (Jason, 10-20); the
        // picker is fiddly on iPad. Each is relative to the moment of the tap.
        h('div', { class: 'time-shortcuts', role: 'group', 'aria-label': 'Set the time' },
          TIME_SHORTCUTS.map(({ label, minutes }) => h('button', {
            type: 'button', class: 'btn small',
            onclick: () => {
              const when = toOffsetIso(minutesAgo(minutes));
              whenInput.value = toInputValue(when);
              update({ occurred_at: when });
            },
          }, label)))),
      futureWarning);
  }

  // Reflect the draft into the inputs (including values cleared by normalize)
  // and mark what Save still needs.
  function syncInputs(form, errors) {
    const draft = getDraft();
    for (const input of form.querySelectorAll('input[type=radio]')) {
      input.checked = draft[input.name] !== null && String(draft[input.name]) === input.value;
    }
    for (const input of form.querySelectorAll('input[type=checkbox]')) {
      input.checked = isChecked[input.name](draft, input.value);
    }
    // Text follows the draft too (Start over, Undo), except the box being
    // typed in, which is the draft's source.
    for (const [field, input] of Object.entries(textInputs)) {
      if (input !== document.activeElement && input.value !== (draft[field] ?? '')) input.value = draft[field] ?? '';
    }
    if (whenInput && whenInput !== document.activeElement && draft.occurred_at
      && whenInput.value !== toInputValue(draft.occurred_at)) whenInput.value = toInputValue(draft.occurred_at);
    // Marks clear at zero; a later follow-up isn't marked until Save is tapped again.
    if (Object.keys(errors).length === 0) showNeeds = false;
    for (const [field, el] of Object.entries(errorEls)) {
      const needed = showNeeds && Boolean(errors[field]);
      el.replaceChildren(...(needed ? [h('span', { class: 'need-tag' }, 'Needed'), ` ${errors[field]}`] : []));
      el.closest('.group')?.classList.toggle('needs', needed);
    }
    for (const syncScale of scaleSyncs) syncScale();
    if (futureWarning) futureWarning.hidden = !draft.occurred_at || !isFutureTime(draft.occurred_at);
  }

  // Save tapped too early: mark what's missing, then bring the first
  // unanswered question (in page order) into view and focus it.
  function revealNeeds(form, sync) {
    showNeeds = true;
    sync();
    const group = form.querySelector('.group.needs');
    if (!group) return;
    group.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    group.querySelector('input, textarea')?.focus({ preventScroll: true });
  }

  const needsShown = () => showNeeds;
  const hideNeeds = () => { showNeeds = false; };

  return { groups, radioGroup, scaleGroup, checkGroup, textField, whenGroup, syncInputs, revealNeeds, needsShown, hideNeeds };
}

