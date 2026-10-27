// In-memory demo state with path-based subscriptions.
// CONTRACT:
//   store.get('calls')                       → value at a dot path
//   store.set('env', 'live')                 → replace value, notify subscribers
//   store.update('credits.balance', n => n + 100)
//   store.push('calls', record, { prepend: true })
//   store.subscribe('calls', fn) → unsubscribe   (fn(value, changedPath)); '*' = everything
//   store.reset()                            → back to the seed (used by "Reset demo")
//   store.replace(state)                     → swap the whole state (actions.setMode uses it)
// Seed data comes from js/data/seed.js: the CURRENT dataset (first-run or active account) sits at the top
// level, so store.get('calls') is always "the calls of the account on screen".

import { seed } from '../data/seed.js';

let state = seed();
const subs = new Set();

function split(path) {
  return path ? String(path).split('.') : [];
}

function getAt(obj, parts) {
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setAt(obj, parts, value) {
  if (!parts.length) return value;
  const [head, ...rest] = parts;
  const base = Array.isArray(obj) ? obj.slice() : { ...(obj || {}) };
  base[head] = setAt(obj ? obj[head] : undefined, rest, value);
  return base;
}

function related(a, b) {
  return a === '*' || b === '*' || a === b || a.startsWith(b + '.') || b.startsWith(a + '.');
}

function notify(changed) {
  for (const s of Array.from(subs)) {
    if (!subs.has(s)) continue; // unsubscribed by an earlier subscriber in this same round (e.g. a re-render)
    if (related(s.path, changed)) {
      try { s.fn(s.path === '*' ? state : getAt(state, split(s.path)), changed); } catch (e) { console.error(e); }
    }
  }
}

export const store = {
  get(path) {
    return path ? getAt(state, split(path)) : state;
  },
  set(path, value) {
    state = setAt(state, split(path), value);
    notify(path);
  },
  update(path, fn) {
    this.set(path, fn(this.get(path)));
  },
  push(path, item, { prepend = false } = {}) {
    const arr = this.get(path) || [];
    this.set(path, prepend ? [item, ...arr] : [...arr, item]);
  },
  /** Merge an object into the object at `path`. */
  merge(path, patch) {
    this.set(path, { ...(this.get(path) || {}), ...patch });
  },
  subscribe(path, fn) {
    const s = { path, fn };
    subs.add(s);
    return () => subs.delete(s);
  },
  replace(next) {
    state = next;
    notify('*');
  },
  reset() {
    state = seed();
    notify('*');
  },
};

