// Demo clock. The story happens on Tue 27 Oct 2026 at 14:35 Bangkok time (UTC+7) — frozen at load.
// New events created while someone clicks get DEMO_NOW plus the real seconds since load, so
// "2 min ago" keeps moving naturally. Every date is formatted in Asia/Bangkok (fmt uses TZ).
// CONTRACT: never call new Date() / Date.now() for anything a visitor sees — use clock.now() / clock.nowMs().

export const TZ = 'Asia/Bangkok';
export const DEMO_NOW_ISO = '2026-10-27T14:35:00+07:00';
export const DEMO_NOW = Date.parse(DEMO_NOW_ISO);
export const DEMO_DAY = '2026-10-27';

let loadedAt = Date.now();

export const nowMs = () => DEMO_NOW + (Date.now() - loadedAt);
export const now = () => new Date(nowMs());
/** Re-anchor the clock to 14:35:00 (Reset demo). */
export const resetClock = () => { loadedAt = Date.now(); };

/** A time on the demo day: at('14:34:52') → epoch ms. */
export const at = (hms) => Date.parse(`${DEMO_DAY}T${hms.length === 5 ? hms + ':00' : hms}+07:00`);
/** Any Bangkok date/time: on('2026-10-12', '09:05') → epoch ms. */
export const on = (ymd, hms = '00:00:00') => Date.parse(`${ymd}T${hms.length === 5 ? hms + ':00' : hms}+07:00`);
/** ISO string helpers for records. */
export const isoAt = (hms) => new Date(at(hms)).toISOString();
export const isoOn = (ymd, hms) => new Date(on(ymd, hms)).toISOString();
