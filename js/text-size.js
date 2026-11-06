// Follows the iPad and iPhone Text Size setting (ACCEPTANCE "Follows the iPad
// and iPhone Text Size setting"). Apple exposes it to web pages only as a
// font keyword, -apple-system-body, which is 17px at the default size and
// 53px at the largest. Putting it straight on <html> would make the default
// 17px, about 6% bigger than the 16px base every size here assumes. Instead
// a hidden probe reads it, and the root scales by that size / 17: exactly
// today's sizes at the default, the system's ratio everywhere else. Other
// browsers don't know the keyword and are left alone: their own font
// setting and zoom already work, since sizes are in rem.
//
// The root is set as a percent of the browser's default, so a browser font
// setting still counts. An app-level size, if one is ever added, would be
// one more factor here.

export const IOS_DEFAULT_BODY_PX = 17;

// Pure: the root size, as a percent of the browser default, for a system
// body size in px. Null when there's nothing usable to follow.
export function rootPercent(systemBodyPx) {
  if (!Number.isFinite(systemBodyPx) || systemBodyPx <= 0) return null;
  return Math.round((systemBodyPx / IOS_DEFAULT_BODY_PX) * 10000) / 100;
}

// The accessibility sizes (Larger Accessibility Sizes) start at 28px body,
// 165%. From there, as Apple's own apps do, rows that put things side by side
// stack instead: CSS keys those layouts off html.big-text.
export const BIG_TEXT_PERCENT = 150;
export const isBigText = (percent) => percent !== null && percent >= BIG_TEXT_PERCENT;

function systemBodyPx(doc) {
  const probe = doc.createElement('span');
  probe.className = 'text-size-probe';
  probe.setAttribute('aria-hidden', 'true');
  doc.body.append(probe);
  const px = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return px;
}

function apply(doc) {
  const percent = rootPercent(systemBodyPx(doc));
  // CSSOM, not a style attribute: allowed under the strict CSP.
  if (percent !== null) doc.documentElement.style.fontSize = `${percent}%`;
  doc.documentElement.classList.toggle('big-text', isBigText(percent));
}

// Touch devices only: Safari on a Mac knows the keyword too, but reports the
// Mac's fixed 13px, which would shrink everything to three quarters. iPads
// and iPhones report touch points; Macs report none.
export function followsTextSize({ supportsKeyword, maxTouchPoints }) {
  return Boolean(supportsKeyword) && maxTouchPoints > 0;
}

// Read at start, and again on coming back to the app: the setting is
// usually changed in Settings while Tavela waits in the background.
export function followSystemTextSize(doc = document) {
  if (!followsTextSize({
    supportsKeyword: globalThis.CSS?.supports?.('font', '-apple-system-body'),
    maxTouchPoints: navigator.maxTouchPoints,
  })) return;
  apply(doc);
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') apply(doc);
  });
}
