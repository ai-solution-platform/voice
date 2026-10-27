// Locale-aware formatting via Intl. Always format numbers/dates through fmt so the language switch
// re-formats them. Every date is shown in Bangkok time (the demo story's time zone) whatever the viewer's
// own time zone is.
// Dates: tables use fmt.date (Gregorian, all languages) · prose uses fmt.dateProse (Thai: Buddhist year 2569)
//        · logs, CSV and API values use fmt.iso → 2026-10-27T14:35:00+07:00 (never localised).
// Credits: balances whole (fmt.int / fmt.credits), rates and costs 2 decimals (fmt.rate / fmt.credits2).
// No compact notation for credits (Chinese would show "5.5万"); fmt.compact is for chart axes only.

import { locale } from './i18n.js';
import { TZ, nowMs } from '../data/clock.js';

const cache = new Map();
function nf(opts) {
  const key = 'n' + locale() + JSON.stringify(opts || {});
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(locale(), opts));
  return cache.get(key);
}
function df(opts, loc = locale()) {
  const key = 'd' + loc + JSON.stringify(opts || {});
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(loc, { timeZone: TZ, ...opts }));
  return cache.get(key);
}
const toDate = (d) => (d instanceof Date ? d : new Date(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00+07:00` : d));
const pad = (n) => String(n).padStart(2, '0');
const parts = (d) => {
  const o = {};
  for (const p of df({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }, 'en-GB').formatToParts(toDate(d))) o[p.type] = p.value;
  return o;
};

export const fmt = {
  /** 12,450 */
  int: (n) => nf({ maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0)),
  /** Floor for balances shown in tiles/chips (21,596.64 → 21,596). */
  floor: (n) => nf({ maximumFractionDigits: 0 }).format(Math.floor(Number(n) || 0)),
  /** General number with up to `max` decimals. */
  num: (n, max = 2) => nf({ maximumFractionDigits: max }).format(Number(n) || 0),
  /** Rates per unit, always 2 decimals: 1.29 */
  rate: (n) => nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0),
  /** Credit amounts: whole numbers without decimals, otherwise 2 decimals. */
  credits: (n) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return Number.isInteger(v) ? nf({ maximumFractionDigits: 0 }).format(v) : nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  },
  /** Credit amounts always with 2 decimals (cost columns, statements). */
  credits2: (n) => nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0),
  /** pct(68.4) → 68.4% */
  pct: (n, digits = 1) => nf({ style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format((Number(n) || 0) / 100),
  /** Table date, Gregorian in every language: 27 Oct 2026 · 27 ต.ค. 2026 · 2026年10月27日 */
  date: (d) => df({ day: 'numeric', month: 'short', year: 'numeric' }).format(toDate(d)),
  /** Prose date: 27 October 2026 · 27 ตุลาคม 2569 · 2026年10月27日 (long=true adds the weekday) */
  dateProse: (d, long = false) => {
    const loc = locale().startsWith('th') ? 'th-TH' : locale();
    return df(long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' }, loc).format(toDate(d));
  },
  /** 27 Oct */
  dayMonth: (d) => df({ day: 'numeric', month: 'short' }).format(toDate(d)),
  /** Tue 27 (chart axis) */
  weekdayDay: (d) => df({ weekday: 'short', day: 'numeric' }).format(toDate(d)),
  weekday: (d) => df({ weekday: 'short' }).format(toDate(d)),
  /** 14:32:08 */
  time: (d) => df({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(toDate(d)),
  /** 14:32 */
  timeShort: (d) => df({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(toDate(d)),
  /** 27 Oct 2026, 14:32 */
  dateTime: (d) => df({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(toDate(d)),
  /** ISO in Bangkok time, never localised: 2026-10-27T14:35:00+07:00 */
  iso: (d) => {
    const p = parts(d);
    return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}+07:00`;
  },
  /** 2026-10-27 (Bangkok) */
  isoDate: (d) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; },
  /** "5 minutes ago" relative to the demo clock */
  relative: (d) => {
    const diff = (toDate(d).getTime() - nowMs()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
    const abs = Math.abs(diff);
    if (abs < 45) return rtf.format(0, 'second');
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
  },
  /** Call duration in tables: m:ss or h:mm:ss */
  duration: (sec) => {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  },
  /** Chart axes only: 1.2K / 1.2万 */
  compact: (n) => nf({ notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0),
};
