import { ICONS } from './icons.js';

// Tiny element builder. Text always goes in as textContent, never innerHTML,
// so nothing typed into a note can become markup.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Icons from one set (Lucide, vendored in icons.js; see THIRD_PARTY.md).
// Decorative: the visible text beside each one carries the meaning.
export function icon(name, size = 20) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', width: size, height: size, class: `icon icon-${name}`, 'aria-hidden': 'true', focusable: 'false',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  })) svg.setAttribute(key, value);
  for (const [tag, attrs] of ICONS[name]) {
    const shape = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}

// Builds SVG nodes from the plain ['tag', attrs, ...children] trees that
// charts.js returns. Text goes in as text nodes, never markup.
export function svgTree([tag, attrs, ...children]) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) {
    node.append(Array.isArray(child) ? svgTree(child) : document.createTextNode(String(child)));
  }
  return node;
}

// In-app replacement for confirm(): resolves to the chosen button's value.
export function ask({ title, body, buttons }) {
  return new Promise((resolve) => {
    // Focus opens on the safe choice (the primary button: Cancel, Stay,
    // Continue editing), so a stray Return never confirms a delete.
    const dialog = h('dialog', { class: 'ask', 'aria-labelledby': 'ask-title', 'aria-describedby': body ? 'ask-body' : null },
      h('h2', { id: 'ask-title' }, title),
      body ? h('p', { id: 'ask-body' }, body) : null,
      h('div', { class: 'ask-buttons' },
        buttons.map(({ label, value, kind }) =>
          h('button', { type: 'button', class: `btn ${kind ?? ''}`, autofocus: kind === 'primary', onclick: () => close(value) }, label))));
    function close(value) {
      dialog.close();
      dialog.remove();
      resolve(value);
    }
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(buttons.at(-1).value); });
    document.body.append(dialog);
    dialog.showModal();
  });
}
