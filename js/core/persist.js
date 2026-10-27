// localStorage wrapper. Every access is in try/catch: private windows, blocked storage and
// sandboxed previews must still render the demo. Only small per-viewer flags live here
// (language, announcement dismissed, tour done, onboarding done) — everything else is in memory.

const PREFIX = 'ants-voice-demo:';

export const persist = {
  get(key, fallback = null) {
    try {
      const v = window.localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { window.localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable: ignore */ }
  },
  remove(key) {
    try { window.localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
  },
  clearAll() {
    try {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(PREFIX)) keys.push(k);
      }
      keys.forEach((k) => window.localStorage.removeItem(k));
    } catch { /* ignore */ }
  },
};

/** Keys used across the app (one place, so Reset demo clears them all). */
export const KEYS = {
  lang: 'lang',
  announceDismissed: 'announce-dismissed',
  tourDone: 'tour-done',
  onboardingDone: 'onboarding-done',
  navCollapsed: 'nav-collapsed',
};
