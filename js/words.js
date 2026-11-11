// Small wording helpers shared by the pure modules and the views.

// "1 day", "3 days"; irregular plurals pass their own: plural(n, 'entry', 'entries').
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
