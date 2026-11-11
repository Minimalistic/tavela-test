// Motion and tap feedback, shared by the entry forms and every other button.
// Purely visual: nothing here reads or changes the draft.
const FADE_MS = 150;
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
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

// Long enough to see the press and the ring start before a button that opens
// another screen is replaced (Jason, 10-31: Home's buttons should feel like
// the Updates' answers). The press peaks at 130ms of its 260ms.
export const PRESS_SHOWN_MS = 180;
let pressShownBy = 0;

// Tap feedback: a small press, a ring in the button's colour and a light fill
// pulse (CSS keyframes on .tapped). Re-adding the class restarts them, so
// quick repeat taps each register.
export function pressed(el, now = performance.now()) {
  el.classList.remove('tapped');
  void el.offsetWidth; // force a style flush so the animation starts over
  el.classList.add('tapped');
  if (!reduceMotion()) pressShownBy = now + PRESS_SHOWN_MS;
}

// app.show waits on this, so a tap that opens a screen is seen first. With
// reduced motion there's no press to see, so no wait.
export function pressSettled(now = performance.now()) {
  const wait = pressShownBy - now;
  return wait > 0 ? new Promise((resolve) => setTimeout(resolve, wait)) : Promise.resolve();
}

// One listener for the whole app: form answers, buttons, Home's tiles and
// Records rows. Scale segments call pressed() themselves, on lift. It
// listens in the capture phase so the press is recorded before the button's
// own handler calls app.show, which then waits for it.
export function tapFeedback(root) {
  root.addEventListener('click', (event) => {
    const target = event.target.matches('.tile input, .seg input')
      ? event.target.closest('.tile, .seg').querySelector('.tile-text, .seg-text')
      : event.target.closest('.btn, .home-tile, .record-row');
    if (target) pressed(target);
  }, true);
}
