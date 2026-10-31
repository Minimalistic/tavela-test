// Drawing for the Reports timeline: plain ['tag', attrs, ...children] trees,
// no DOM, so they stay pure and testable in node. Every row spans the same
// width with one equal column per day, which is what lines the rows up.

export const INCOMPLETE = new Set(['some_missing', 'unsure']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const el = (tag, attrs = {}, ...children) => [tag, attrs, ...children.filter((child) => child !== null)];
export const r1 = (n) => Math.round(n * 10) / 10;

export function shortDate(day) {
  const [, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

// Marker shapes let series be told apart without colour (SPEC §19).
export function marker(shape, cx, cy, size, cls) {
  const s = size;
  if (shape === 'square') {
    return el('rect', { x: r1(cx - s), y: r1(cy - s), width: r1(2 * s), height: r1(2 * s), class: cls });
  }
  if (shape === 'diamond') {
    const d = s * 1.35;
    return el('path', { d: `M${r1(cx)} ${r1(cy - d)}L${r1(cx + d)} ${r1(cy)}L${r1(cx)} ${r1(cy + d)}L${r1(cx - d)} ${r1(cy)}Z`, class: cls });
  }
  return el('circle', { cx: r1(cx), cy: r1(cy), r: r1(s), class: cls });
}

// The timeline spans its full width, one equal column per day: where day i of
// n sits in a `width` px row, and the reverse, the day under a point, clamped
// to the first and last day. The cursor and drag tab (views/timeline.js,
// views/day-tab.js) use both.
export const dayCenter = (i, n, width) => (width * (i + 0.5)) / n;
export const dayAt = (x, n, width) => Math.max(0, Math.min(n - 1, Math.floor((x / width) * n)));

// The tab under day i: its left edge, kept inside the row, and where its
// pointer sits (the day's exact centre) measured from that edge.
export function tabPlacement(i, n, width, tabWidth) {
  const center = dayCenter(i, n, width);
  const left = Math.max(0, Math.min(width - tabWidth, center - tabWidth / 2));
  return { left: r1(left), pointer: r1(center - left) };
}

// One timeline row (charts.js timelineRows) drawn `width` px wide, the
// screen's own width, so it never scrolls sideways and marks keep their
// shape. Colour comes from the row's area class in app.css.
const ROW_HEIGHT = { bars: 26, dots: 14, line: 30, cells: 22 };
export function rowDrawing(row, width) {
  const n = row.values.length;
  const height = ROW_HEIGHT[row.kind];
  const band = width / n;
  const cx = (i) => dayCenter(i, n, width);
  const nodes = [];
  if (row.kind === 'bars') {
    const max = Math.max(SCALE_FLOOR, ...row.values.map((v) => v ?? 0));
    const barWidth = Math.max(1.5, band * 0.66);
    nodes.push(el('line', { x1: 0, y1: height, x2: r1(width), y2: height, class: 'chart-base' }));
    row.values.forEach((v, i) => {
      if (v) nodes.push(bar(cx(i) - barWidth / 2, height - (v / max) * height, barWidth, height, `tl-mark${row.faint ? ' faint' : ''}`));
    });
  } else if (row.kind === 'dots') {
    const size = Math.max(2.2, Math.min(5, band * 0.3));
    nodes.push(el('line', { x1: 0, y1: height / 2, x2: r1(width), y2: height / 2, class: 'chart-grid' }));
    row.values.forEach((v, i) => { if (v) nodes.push(marker(row.shape ?? 'circle', cx(i), height / 2, v > 1 ? size * 1.25 : size, 'tl-mark')); });
  } else if (row.kind === 'line') {
    // 1 to 5, top and bottom gridlines only; the day boxes give exact values.
    const yFor = (v) => height - 3 - ((v - 1) / 4) * (height - 6);
    nodes.push(...[1, 5].map((v) => el('line', { x1: 0, y1: r1(yFor(v)), x2: r1(width), y2: r1(yFor(v)), class: 'chart-grid' })));
    let d = '';
    row.values.forEach((v, i) => {
      if (v !== null) d += `${i > 0 && row.values[i - 1] !== null ? 'L' : 'M'}${r1(cx(i))} ${r1(yFor(v))}`;
    });
    if (d) nodes.push(el('path', { d, class: `series-line tl-line${row.dashed ? ' dashed' : ''}` }));
    const size = Math.max(1.8, Math.min(3.2, band * 0.25));
    row.values.forEach((v, i) => { if (v !== null) nodes.push(marker(row.dashed ? 'square' : 'circle', cx(i), yFor(v), size, 'tl-mark')); });
  } else if (row.kind === 'cells') {
    // Morning on top, afternoon under it: filled for an Update, outlined with
    // a slash for one marked incomplete, a short dash for none.
    const size = Math.max(1.5, Math.min(4, band * 0.3));
    row.values.forEach((pair, i) => pair.forEach((code, k) => {
      const y = 5 + k * 12;
      const x = cx(i);
      if (code === null) {
        nodes.push(el('line', { x1: r1(x - size), y1: y, x2: r1(x + size), y2: y, class: 'cov-none' }));
      } else if (INCOMPLETE.has(code)) {
        nodes.push(marker('square', x, y, size, 'mark cov-incomplete'),
          el('line', { x1: r1(x - size), y1: r1(y + size), x2: r1(x + size), y2: r1(y - size), class: 'cov-slash' }));
      } else {
        nodes.push(marker('square', x, y, size, 'mark cov-done'));
      }
    }));
  }
  return el('svg', {
    viewBox: `0 0 ${r1(width)} ${height}`, width: r1(width), height, class: 'track-drawing', 'aria-hidden': 'true', focusable: 'false',
  }, ...nodes);
}

// A bar row's scale tops out at the window's busiest day but never below
// SCALE_FLOOR, so one-a-day reads as a third of the height rather than a
// full-height wall.
export const SCALE_FLOOR = 3;

// A bar with rounded top corners and a square foot on the baseline.
export function bar(x, top, width, base, cls) {
  const r = Math.min(3, width / 2, base - top);
  return el('path', {
    d: `M${r1(x)} ${r1(base)}V${r1(top + r)}Q${r1(x)} ${r1(top)} ${r1(x + r)} ${r1(top)}`
      + `H${r1(x + width - r)}Q${r1(x + width)} ${r1(top)} ${r1(x + width)} ${r1(top + r)}V${r1(base)}Z`,
    class: `bar ${cls}`,
  });
}
