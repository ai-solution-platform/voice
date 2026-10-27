// Thai public holidays — the ONE demo list shared by every screen that needs it (campaign calling windows,
// Settings › Compliance; support "first reply by" targets can use it too).
// A weekday public holiday follows the weekend calling hours (08:00–18:00).
// Source: the Bank of Thailand holiday notices for financial institutions, 2026 (19 days) and 2027 (No. 37/2569,
// 17 Aug 2026, 18 days), checked 27 Oct 2026. A holiday that falls on a weekend is listed with its weekday
// substitute. Not included: regional special days (Bangkok only) and days that are government but not bank holidays.
// The Cabinet can add special holidays during the year, so this is a demo list, not a legal calendar.

const N = {
  newYear: { en: "New Year's Day", th: 'วันขึ้นปีใหม่', zh: '元旦' },
  special: { en: 'Special holiday', th: 'วันหยุดพิเศษ', zh: '特别假日' },
  makha: { en: 'Makha Bucha Day', th: 'วันมาฆบูชา', zh: '万佛节' },
  chakri: { en: 'Chakri Memorial Day', th: 'วันจักรี', zh: '却克里王朝纪念日' },
  songkran: { en: 'Songkran Festival', th: 'วันสงกรานต์', zh: '宋干节' },
  labour: { en: 'National Labour Day', th: 'วันแรงงานแห่งชาติ', zh: '劳动节' },
  coronation: { en: 'Coronation Day', th: 'วันฉัตรมงคล', zh: '加冕纪念日' },
  visakha: { en: 'Visakha Bucha Day', th: 'วันวิสาขบูชา', zh: '卫塞节' },
  queen: { en: "H.M. the Queen's Birthday", th: 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี', zh: '王后诞辰' },
  king: { en: "H.M. the King's Birthday", th: 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว', zh: '国王诞辰' },
  asarnha: { en: 'Asarnha Bucha Day', th: 'วันอาสาฬหบูชา', zh: '三宝佛节' },
  mother: { en: "The Queen Mother's Birthday and National Mother's Day", th: 'วันเฉลิมพระชนมพรรษาพระพันปีหลวง และวันแม่แห่งชาติ', zh: '王太后诞辰暨母亲节' },
  rama9: { en: 'King Bhumibol Memorial Day', th: 'วันนวมินทรมหาราช', zh: '九世王纪念日' },
  chula: { en: 'Chulalongkorn Day', th: 'วันปิยมหาราช', zh: '五世王纪念日' },
  father: { en: "National Day and National Father's Day", th: 'วันชาติ และวันพ่อแห่งชาติ', zh: '国庆日暨父亲节' },
  constitution: { en: 'Constitution Day', th: 'วันรัฐธรรมนูญ', zh: '宪法日' },
  nye: { en: "New Year's Eve", th: 'วันสิ้นปี', zh: '新年前夕' },
};
const substitute = (n) => ({ en: `Substitute holiday for ${n.en}`, th: `วันหยุดชดเชย${n.th}`, zh: `${n.zh}补假` });

// [date, name key, substitute?]
const ROWS = [
  ['2026-01-01', 'newYear'], ['2026-01-02', 'special'], ['2026-03-03', 'makha'], ['2026-04-06', 'chakri'],
  ['2026-04-13', 'songkran'], ['2026-04-14', 'songkran'], ['2026-04-15', 'songkran'], ['2026-05-01', 'labour'],
  ['2026-05-04', 'coronation'], ['2026-05-31', 'visakha'], ['2026-06-01', 'visakha', true], ['2026-06-03', 'queen'],
  ['2026-07-28', 'king'], ['2026-07-29', 'asarnha'], ['2026-08-12', 'mother'], ['2026-10-13', 'rama9'],
  ['2026-10-23', 'chula'], ['2026-12-05', 'father'], ['2026-12-07', 'father', true], ['2026-12-10', 'constitution'],
  ['2026-12-31', 'nye'],
  ['2027-01-01', 'newYear'], ['2027-02-21', 'makha'], ['2027-02-22', 'makha', true], ['2027-04-06', 'chakri'],
  ['2027-04-13', 'songkran'], ['2027-04-14', 'songkran'], ['2027-04-15', 'songkran'], ['2027-05-01', 'labour'],
  ['2027-05-03', 'labour', true], ['2027-05-04', 'coronation'], ['2027-05-20', 'visakha'], ['2027-06-03', 'queen'],
  ['2027-07-18', 'asarnha'], ['2027-07-19', 'asarnha', true], ['2027-07-28', 'king'], ['2027-08-12', 'mother'],
  ['2027-10-13', 'rama9'], ['2027-10-23', 'chula'], ['2027-10-25', 'chula', true], ['2027-12-05', 'father'],
  ['2027-12-06', 'father', true], ['2027-12-10', 'constitution'], ['2027-12-31', 'nye'],
];

/** Every holiday: { date: 'YYYY-MM-DD', name: { en, th, zh }, substitute: boolean }, in date order. */
export const HOLIDAYS = ROWS.map(([date, key, sub]) => ({ date, name: sub ? substitute(N[key]) : N[key], substitute: !!sub }));
const BY_DATE = new Map(HOLIDAYS.map((x) => [x.date, x]));

/** The holiday on a Bangkok calendar day ('YYYY-MM-DD'), or null. */
export const holidayOn = (ymd) => BY_DATE.get(ymd) || null;
/** Bangkok calendar day of a timestamp (ms). */
export const ymdOf = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
/** Holidays from a day on (inclusive), for lists such as Settings › Compliance. */
export const holidaysFrom = (ymd) => HOLIDAYS.filter((x) => x.date >= ymd);
/** First and last day the list covers (callers say so when a date falls outside it). */
export const HOLIDAY_RANGE = { from: '2026-01-01', to: '2027-12-31' };
