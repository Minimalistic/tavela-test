// Motion and tap feedback shared by the entry forms. Purely visual: nothing
// here reads or changes the draft.
const FADE_MS = 150;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const leaving = new WeakMap();

// Follow-up questions fade in and out in place (about 150ms, no movement).
// A leaving one is inert while it fades, so a tap can't land on it. Before
// the form is on the page, or with reduced motion, it's instant.
export function setShown(el, shown) {
  const fading = leaving.get(el);
  if (shown) {
    if (fading) {
      fading.cancel();
      return;
    }
    if (!el.hidden) return;
    el.hidden = false;
    if (el.isConnected && !reduceMotion()) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
    }
    return;
  }
  if (el.hidden || fading) return;
  if (!el.isConnected || reduceMotion()) {
    el.hidden = true;
    return;
  }
  el.inert = true;
  const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-in', fill: 'forwards' });
  leaving.set(el, fade);
  const settle = () => {
    leaving.delete(el);
    el.inert = false;
  };
  fade.finished.then(() => {
    settle();
    el.hidden = true;
    fade.cancel();
  }, settle);
}

// Tap feedback on every answer and button in a form: a small press, a ring
// in the button's colour and a light fill pulse (CSS keyframes on .tapped).
// Re-adding the class restarts them, so quick repeat taps each register.
export function pressed(el) {
  el.classList.remove('tapped');
  void el.offsetWidth; // force a style flush so the animation starts over
  el.classList.add('tapped');
}

// Scale segments call pressed() themselves, on lift.
export function tapFeedback(form) {
  form.addEventListener('click', (event) => {
    const target = event.target.matches('.tile input, .seg input')
      ? event.target.closest('.tile, .seg').querySelector('.tile-text, .seg-text')
      : event.target.closest('.btn');
    if (target) pressed(target);
  });
}
