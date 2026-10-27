// Flows (Beta) — #/flows (list) · #/flows/<id or slug> (editor)
// An IVR builder lite: a vertical list of steps — Say · Gather digits ·
// Transfer · Record · Hang up — with menu options nested under "Gather digits", an opening-hours rule, per-step
// voice preview in the chosen language, and "Preview a call path" that plays the menu and lets you press keys
// (DTMF tones) while the path lights up. Publishing asks for a version note and lists the changes.
// Prompts are user content in three languages ({ en, th, zh }). Typed prompts are only spoken by an on-device
// voice; with an online browser voice the preview shows captions without sound.

import { raw, reducedMotion } from '../core/dom.js';
import { newId, audit } from '../core/actions.js';
import { LANGS, LANG_ORDER, getLang, loc } from '../core/i18n.js';
import { store } from '../core/store.js';
import { nowMs } from '../data/clock.js';
import { PRICES } from '../data/prices.js';

export const id = 'flows';
export const nav = { group: 'build', icon: 'flow', labelKey: 'nav.flows', beta: true };
export const titleKey = 'nav.flows';
export const skeleton = 'form';
export const css = true;

const NODE_TYPES = ['say', 'gather', 'transfer', 'record', 'hangup'];
const ACTIONS = ['say', 'transfer', 'menu', 'record', 'sms', 'hangup'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'];
const MAX_OPTIONS = 9;
const MAX_DEPTH = 3;
const TYPE_ICON = { say: 'volume', gather: 'dialpad', transfer: 'phone-out', record: 'mic', hangup: 'phone-off', sms: 'sms', menu: 'list', hours: 'clock' };
const TARGETS = ['hq-pbx queue 200', 'hq-pbx ext 200', 'hq-pbx ext 310', '053-xxx-120 via cm-branch-pbx'];
const DAYS = ['mon-fri', 'mon-sat', 'every'];
// Transfer targets are stored as plain strings ("hq-pbx queue 200", "053-xxx-120 via cm-branch-pbx");
// only the trunk name and the numbers stay as they are on screen, the words are translated.
function tgt(ctx, target) {
  const x = String(target || '');
  let m = /^(\S+) queue (\S+)$/.exec(x);
  if (m) return ctx.t('tgt.queue', { trunk: m[1], n: m[2] });
  m = /^(\S+) ext (\S+)$/.exec(x);
  if (m) return ctx.t('tgt.ext', { trunk: m[1], n: m[2] });
  m = /^(\S+) via (\S+)$/.exec(x);
  if (m) return ctx.t('tgt.via', { number: m[1], trunk: m[2] });
  return x;
}
const noop = () => {};

// ---------- seed content (2.5 and 3.2) ----------
let SEQ = 0;
const nid = () => `n${(++SEQ).toString(36)}`;
const P = (en, th, zh) => ({ en, th, zh });
const clone = (x) => JSON.parse(JSON.stringify(x));

const TXT = {
  greet4: P('Thank you for calling Example Trading. For our staff, press 1. For opening hours, press 2. For your delivery status, press 3. To leave a message, press 9. For the operator, press 0.',
    'สวัสดีค่ะ บริษัท ตัวอย่างเทรดดิ้ง จำกัด ยินดีให้บริการค่ะ ติดต่อเจ้าหน้าที่ กด 1 สอบถามเวลาทำการ กด 2 ตรวจสอบสถานะการจัดส่ง กด 3 ฝากข้อความ กด 9 ติดต่อพนักงานรับสาย กด 0 ค่ะ',
    '感谢致电示例贸易。人工服务请按1，营业时间请按2，查询配送状态请按3，留言请按9，总机请按0。'),
  greet3: P('Thank you for calling Example Trading. For our staff, press 1. For opening hours, press 2. To leave a message, press 9. For the operator, press 0.',
    'สวัสดีค่ะ บริษัท ตัวอย่างเทรดดิ้ง จำกัด ยินดีให้บริการค่ะ ติดต่อเจ้าหน้าที่ กด 1 สอบถามเวลาทำการ กด 2 ฝากข้อความ กด 9 ติดต่อพนักงานรับสาย กด 0 ค่ะ',
    '感谢致电示例贸易。人工服务请按1，营业时间请按2，留言请按9，总机请按0。'),
  greet1: P('Thank you for calling Example Trading. For our staff, press 1. For the operator, press 0.',
    'สวัสดีค่ะ บริษัท ตัวอย่างเทรดดิ้ง จำกัด ยินดีให้บริการค่ะ ติดต่อเจ้าหน้าที่ กด 1 ติดต่อพนักงานรับสาย กด 0 ค่ะ',
    '感谢致电示例贸易。人工服务请按1，总机请按0。'),
  staff: P('Please hold while we connect you to our staff.', 'กรุณารอสักครู่ กำลังโอนสายไปยังเจ้าหน้าที่ค่ะ', '请稍候，正在为您转接人工服务。'),
  hoursMenu: P('For our Bangkok office, press 1. For our branches, press 2.', 'สำนักงานกรุงเทพฯ กด 1 สาขาต่างจังหวัด กด 2 ค่ะ', '曼谷办公室请按1，外府分店请按2。'),
  bkk: P('Our Bangkok office is open Monday to Saturday, 9:00 to 18:00.', 'สำนักงานกรุงเทพฯ เปิดทำการวันจันทร์ถึงวันเสาร์ เวลาเก้าโมงถึงหกโมงเย็นค่ะ', '曼谷办公室营业时间为周一至周六上午9点至下午6点。'),
  branchMenu: P('For Chiang Mai, press 1. For Khon Kaen, press 2.', 'สาขาเชียงใหม่ กด 1 สาขาขอนแก่น กด 2 ค่ะ', '清迈分店请按1，孔敬分店请按2。'),
  cm: P('Connecting you to our Chiang Mai branch.', 'กำลังโอนสายไปยังสาขาเชียงใหม่ค่ะ', '正在为您转接清迈分店。'),
  kk: P('Our Khon Kaen branch is open Monday to Saturday, 8:30 to 17:30.', 'สาขาขอนแก่นเปิดทำการวันจันทร์ถึงวันเสาร์ เวลาแปดโมงครึ่งถึงห้าโมงครึ่งค่ะ', '孔敬分店营业时间为周一至周六上午8点30分至下午5点30分。'),
  track: P("We've sent you a text with a link to track your order. Thank you.", 'เราส่ง SMS ลิงก์ติดตามออเดอร์ให้คุณแล้วค่ะ ขอบคุณค่ะ', '我们已向您发送包含订单跟踪链接的短信。谢谢。'),
  leave: P('Please leave your message after the beep. Press the hash key when you finish.', 'กรุณาฝากข้อความหลังเสียงสัญญาณ เมื่อพูดจบให้กดเครื่องหมายสี่เหลี่ยมค่ะ', '请在提示音后留言，说完请按井号键。'),
  operator: P('Connecting you to the operator.', 'กำลังโอนสายไปยังพนักงานรับสายค่ะ', '正在为您转接总机。'),
  noKey: P('Please call again during opening hours. Goodbye.', 'กรุณาโทรมาใหม่ในเวลาทำการค่ะ สวัสดีค่ะ', '请在营业时间内再次来电。再见。'),
  wrong: P("Sorry, that's not an option.", 'ขออภัยค่ะ ไม่มีตัวเลือกนี้', '抱歉，没有这个选项。'),
  closed: P("Thank you for calling. Our branch is closed right now or can't take calls. Please call again Monday to Saturday, 9 am to 6 pm.",
    'ขอบคุณที่โทรมาค่ะ ขณะนี้สาขาปิดทำการหรือไม่สามารถรับสายได้ กรุณาโทรใหม่ วันจันทร์ถึงวันเสาร์ เวลาเก้าโมงถึงหกโมงเย็นค่ะ',
    '感谢来电。本分店目前不在营业时间或暂时无法接听，请于周一至周六上午9点至下午6点再次来电。'),
  clinicGreet: P('Thank you for calling Example Clinic, Sukhumvit branch. For the clinic counter, press 1. For opening hours, press 2. To leave a message, press 9.',
    'สวัสดีค่ะ คลินิกตัวอย่าง สาขาสุขุมวิท ยินดีให้บริการค่ะ ติดต่อเคาน์เตอร์คลินิก กด 1 สอบถามเวลาทำการ กด 2 ฝากข้อความ กด 9 ค่ะ',
    '感谢致电示例诊所素坤逸分店。诊所前台请按1，营业时间请按2，留言请按9。'),
  counter: P('Connecting you to the clinic counter.', 'กำลังโอนสายไปยังเคาน์เตอร์คลินิกค่ะ', '正在为您转接诊所前台。'),
  clinicHours: P('The clinic is open every day, 8:00 to 20:00.', 'คลินิกเปิดทุกวัน เวลาแปดโมงเช้าถึงสองทุ่มค่ะ', '诊所每天上午8点至晚上8点营业。'),
  msgIntro: P('Thank you for calling Example Trading. Please leave your name, number and message after the beep.', 'ขอบคุณที่โทรหา ตัวอย่างเทรดดิ้ง ค่ะ กรุณาฝากชื่อ เบอร์โทร และข้อความหลังเสียงสัญญาณค่ะ', '感谢致电示例贸易。请在提示音后留下您的姓名、电话和留言。'),
  msgThanks: P("Thank you. We'll call you back. Goodbye.", 'ขอบคุณค่ะ เราจะโทรกลับโดยเร็ว สวัสดีค่ะ', '谢谢，我们会尽快回电。再见。'),
  blank: P('Hello, thank you for calling.', 'สวัสดีค่ะ ขอบคุณที่โทรมาค่ะ', '您好，感谢来电。'),
  goodbye: P('Thank you for calling. Goodbye.', 'ขอบคุณที่โทรมาค่ะ สวัสดีค่ะ', '感谢来电，再见。'),
};
const NAMES = {
  staff: P('Talk to our staff', 'ติดต่อเจ้าหน้าที่', '人工服务'),
  hours: P('Opening hours', 'เวลาทำการ', '营业时间'),
  bkk: P('Bangkok office', 'สำนักงานกรุงเทพฯ', '曼谷办公室'),
  branches: P('Branches', 'สาขาต่างจังหวัด', '外府分店'),
  cm: P('Chiang Mai', 'เชียงใหม่', '清迈'),
  kk: P('Khon Kaen', 'ขอนแก่น', '孔敬'),
  delivery: P('Delivery status', 'สถานะการจัดส่ง', '配送状态'),
  leave: P('Leave a message', 'ฝากข้อความ', '留言'),
  operator: P('Operator', 'พนักงานรับสาย', '总机'),
  counter: P('Clinic counter', 'เคาน์เตอร์คลินิก', '诊所前台'),
  track: P('Track your order', 'ติดตามออเดอร์', '跟踪订单'),
  greeting: P('Greeting', 'คำทักทาย', '欢迎语'),
  menu: P('Main menu', 'เมนูหลัก', '主菜单'),
  closedMsg: P('Closed message', 'ข้อความปิดทำการ', '非营业提示'),
  thanks: P('Thank you', 'ขอบคุณ', '致谢'),
};

const opt = (key, name, action, prompt, extra = {}) => ({ id: nid(), key, name, action, prompt, ...extra });
const say = (name, prompt) => ({ id: nid(), type: 'say', name, prompt });
const gather = (name, options, extra = {}) => ({ id: nid(), type: 'gather', name, prompt: P('', '', ''), wait: 5, noKey: 'repeat1', wrong: 'repeat', noKeyPrompt: TXT.noKey, options, ...extra });
const HOURS_MS = { on: true, days: 'mon-sat', from: '09:00', to: '18:00', holidays: true, outside: 'flw_01JB5CLSD2' };

function mainMenu(v) {
  const opts = [
    opt('1', NAMES.staff, 'transfer', TXT.staff, { target: 'hq-pbx queue 200', ring: 30, record: true }),
    ...(v >= 2 ? [opt('2', NAMES.hours, 'menu', TXT.hoursMenu, { options: [
      opt('1', NAMES.bkk, 'say', TXT.bkk),
      opt('2', NAMES.branches, 'menu', TXT.branchMenu, { options: [
        opt('1', NAMES.cm, 'transfer', TXT.cm, { target: '053-xxx-120 via cm-branch-pbx', ring: 30, record: false }),
        opt('2', NAMES.kk, 'say', TXT.kk),
      ] }),
    ] })] : []),
    ...(v >= 4 ? [opt('3', NAMES.delivery, 'sms', TXT.track, { sms: NAMES.track, isNew: true })] : []),
    ...(v >= 2 ? [opt('9', NAMES.leave, 'record', TXT.leave, { max: 60 })] : []),
    opt('0', NAMES.operator, 'transfer', TXT.operator, { target: 'hq-pbx ext 200', ring: 30, record: true }),
  ];
  return { voice: 'female', hours: v >= 3 ? { ...HOURS_MS } : { ...HOURS_MS, on: false }, number: '02-xxx-1000', nodes: [say(NAMES.greeting, v >= 4 ? TXT.greet4 : v >= 2 ? TXT.greet3 : TXT.greet1), gather(NAMES.menu, opts)] };
}
const clinicMenu = () => ({ voice: 'female', hours: { on: true, days: 'every', from: '08:00', to: '20:00', holidays: false, outside: 'flw_01JB5CLSD2' }, number: '02-xxx-1002', nodes: [
  say(NAMES.greeting, TXT.clinicGreet),
  gather(NAMES.menu, [
    opt('1', NAMES.counter, 'transfer', TXT.counter, { target: 'hq-pbx ext 310', ring: 30, record: true }),
    opt('2', NAMES.hours, 'say', TXT.clinicHours),
    opt('9', NAMES.leave, 'record', TXT.leave, { max: 60 }),
  ]),
] });
const closedFlow = () => ({ voice: 'female', hours: { ...HOURS_MS, on: false }, number: null, nodes: [say(NAMES.closedMsg, TXT.closed), { id: nid(), type: 'hangup', prompt: P('', '', '') }] });
const messageFlow = () => ({ voice: 'female', hours: { ...HOURS_MS, on: false }, number: null, nodes: [say(NAMES.greeting, TXT.msgIntro), { id: nid(), type: 'record', max: 60, finish: '#', prompt: P('', '', '') }, say(NAMES.thanks, TXT.msgThanks), { id: nid(), type: 'hangup', prompt: P('', '', '') }] });
const TEMPLATES = {
  main: () => { const d = mainMenu(2); d.number = null; d.hours.on = false; return d; },
  hours: () => ({ voice: 'female', hours: { ...HOURS_MS }, number: null, nodes: [say(NAMES.greeting, TXT.blank), { id: nid(), type: 'transfer', target: 'hq-pbx ext 200', ring: 30, record: false, prompt: TXT.operator }] }),
  message: messageFlow,
  blank: () => ({ voice: 'female', hours: { ...HOURS_MS, on: false }, number: null, nodes: [say(NAMES.greeting, TXT.blank), { id: nid(), type: 'hangup', prompt: TXT.goodbye }] }),
};

function seedDoc(flowId) {
  if (flowId === 'flw_01JB5MAIN1') return { work: mainMenu(4), snapshots: { 1: mainMenu(1), 2: mainMenu(2), 3: mainMenu(3) }, changes: [{ k: 'optAdded', vars: { key: '3' } }, { k: 'promptEdited', vars: { name: NAMES.greeting } }], dirty: false };
  if (flowId === 'flw_01JB5CKN02') { const d = clinicMenu(); return { work: d, snapshots: { 1: clone(d), 2: clone(d) }, changes: [], dirty: false }; }
  if (flowId === 'flw_01JB5CLSD2') { const d = closedFlow(); return { work: d, snapshots: { 1: clone(d), 2: clone(d) }, changes: [], dirty: false }; }
  if (flowId === 'flw_01JB5MSG01') return { work: messageFlow(), snapshots: {}, changes: [{ k: 'created' }], dirty: false };
  return { work: TEMPLATES.blank(), snapshots: {}, changes: [{ k: 'created' }], dirty: false };
}

export const initialState = () => ({ docs: {}, sel: {}, vlang: null, playing: null, sim: { run: 0, phase: 'idle', flowId: null, trail: [], path: [], text: '', when: 'now', note: '', result: '' } });

export function crumb(params) {
  const key = params.path[0];
  if (!key) return '';
  const f = (store.get('flows') || []).find((x) => x.id === key || slug(x) === key);
  return f ? loc(f.name) : '';
}

export const commands = [
  { id: 'new', labelKey: 'cmd.new', icon: 'flow', keywords: ['new flow ivr phone menu press 1'], run: ({ go }) => go('flows?new=1') },
];

// ---------- helpers ----------
const slug = (f) => String((f.name && f.name.en) || f.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const flowBy = (ctx, key) => ctx.list('flows').find((f) => f.id === key || slug(f) === key);
const onFlow = (fid) => () => location.hash.startsWith(`#/flows/${fid}`);
function soon(ctx, fn, ms) {
  const st = ctx.state;
  setTimeout(() => { if (st === ctx.state) fn(st); }, ms);
}
const vlang = (ctx) => ctx.state.vlang || getLang();
const L = (ctx, obj) => (obj ? obj[vlang(ctx)] ?? obj.en ?? '' : '');
const today = () => new Date(nowMs()).toISOString().slice(0, 10);

function docOf(ctx, fid) {
  const s = ctx.state;
  if (!s.docs[fid]) s.docs[fid] = seedDoc(fid);
  return s.docs[fid];
}

/** Every item with its list, parent and depth. */
function walk(nodes, fn, parent = null, depth = 0) {
  nodes.forEach((n, i) => {
    fn(n, nodes, i, parent, depth);
    if (n.type === 'gather' || n.action === 'menu') walk(n.options || [], fn, n, depth + 1);
  });
}
function find(doc, itemId) {
  let r = null;
  walk(doc.nodes, (n, list, index, parent, depth) => { if (n.id === itemId) r = { item: n, list, index, parent, depth }; });
  return r;
}
/** The chain of items from the top to itemId. */
function pathTo(doc, itemId) {
  const chain = [];
  const rec = (nodes) => {
    for (const n of nodes) {
      chain.push(n);
      if (n.id === itemId) return true;
      if ((n.type === 'gather' || n.action === 'menu') && rec(n.options || [])) return true;
      chain.pop();
    }
    return false;
  };
  rec(doc.nodes);
  return chain;
}
const isMenu = (n) => n && (n.type === 'gather' || n.action === 'menu');
const kindOf = (n) => (n.type ? n.type : n.action);

function draftVersion(f, d) {
  if (f.draft) return f.draft;
  return d.changes.length || d.dirty ? (f.live || 0) + 1 : null;
}

function isOpen(hours, ms) {
  if (!hours || !hours.on) return true;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  const dow = o.weekday;
  const okDay = hours.days === 'every' || (hours.days === 'mon-sat' ? dow !== 'Sun' : !['Sat', 'Sun'].includes(dow));
  const hm = `${o.hour}:${o.minute}`;
  return okDay && hm >= hours.from && hm < hours.to;
}

/** The Thai polite particle must follow the voice (ค่ะ for a female voice, ครับ for a male voice). */
function particleMismatch(doc) {
  let female = 0;
  let male = 0;
  walk(doc.nodes, (n) => { for (const k of ['prompt', 'noKeyPrompt']) { const s = n[k] && n[k].th; if (s) { female += (s.match(/ค่ะ|คะ/g) || []).length; male += (s.match(/ครับ/g) || []).length; } } });
  if (doc.voice === 'male' && female) return 'toMale';
  if (doc.voice !== 'male' && male) return 'toFemale';
  return null;
}
function fixParticles(doc, dir) {
  walk(doc.nodes, (n) => {
    for (const k of ['prompt', 'noKeyPrompt']) {
      if (!n[k] || !n[k].th) continue;
      n[k] = { ...n[k], th: dir === 'toMale' ? n[k].th.replace(/ค่ะ|คะ/g, 'ครับ') : n[k].th.replace(/ครับ/g, 'ค่ะ') };
    }
  });
}

function touch(ctx, fid, change) {
  const d = docOf(ctx, fid);
  d.dirty = true;
  if (change && !d.changes.some((c) => c.k === change.k && JSON.stringify(c.vars || {}) === JSON.stringify(change.vars || {}))) d.changes.push(change);
}

function ensureDraft(ctx, f) {
  if (f.draft) return f.draft;
  const v = (f.live || 0) + 1;
  ctx.store.update('flows', (list) => list.map((x) => (x.id === f.id ? { ...x, draft: v, versions: [{ v, status: 'draft', at: today(), by: ctx.store.get('user.name') }, ...(x.versions || [])] } : x)));
  return v;
}

// ---------- speech ----------
let speech = null;
let speakTok = 0;
function stopSpeech() {
  speakTok += 1;
  if (speech) { try { speech.stop(); } catch { /* ignore */ } speech = null; }
}
/** Speak (or, for edited text with an online voice, only caption) one prompt. Calls then() when done unless stopped. */
function speak(ctx, text, { edited = false, premium = false, onWord, then } = {}) {
  stopSpeech();
  const tok = speakTok;
  const lang = vlang(ctx);
  const tag = LANGS[lang].tts;
  const tts = ctx.ui.audio.tts;
  const pick = tts.supported() ? tts.pick(tag, { premium }) : { voice: null, match: 'none', local: true };
  let note = '';
  if (!tts.supported() || pick.match === 'none') note = ctx.t('dialer.noVoiceNote');
  else if (pick.match !== 'exact' && lang !== 'en') note = ctx.t('dialer.fallbackVoiceNote', { lang: LANGS[lang].label });
  const remote = pick.voice && !pick.local;
  let handle;
  if (edited && remote) {
    // Typed prompts never go to an online voice: captions only.
    note = ctx.t('sim.remoteNote');
    const words = ctx.ui.audio.words(text, tag);
    const per = Math.max(240, tts.estimateMs(text, tag) / Math.max(1, words.length));
    let i = -1;
    let timer = null;
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    timer = setInterval(() => { i += 1; if (onWord) onWord(i); if (i >= words.length - 1) { clearInterval(timer); resolve(); } }, per);
    handle = { done, stop() { clearInterval(timer); resolve(); } };
  } else {
    handle = tts.speak([{ text }], { lang: tag, premium, onWord });
  }
  speech = handle;
  handle.done.then(() => { if (tok === speakTok) { speech = null; if (then) then(); } });
  return note;
}

// ---------- list ----------
function listPage(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const flows = ctx.list('flows');
  const head = h`<div class="page-head"><div class="titles"><h1 class="row-tight">${t('title')} <span class="chip chip-info" tabindex="0" data-tip-key="flows.betaTip">${t('common.beta')}</span>${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div>
    <div class="tools">${flows.length ? h`<button type="button" class="btn btn-primary" data-action="fl.new">${icon('plus')}${t('new')}</button>` : ''}</div></div>`;
  if (!flows.length) {
    return h`<div class="page fl">${head}<div class="card fl-empty"><div class="empty">
      <span class="art">${icon('flow')}</span><h2>${t('empty.title')}</h2><p class="hint">${t('empty.body')}</p>
      <div class="grid g-2 fl-tpls">${['main', 'hours', 'message', 'blank'].map((k) => h`<button type="button" class="optcard" data-action="fl.empty.tpl" data-value="${k}"><span class="t">${icon(k === 'main' ? 'dialpad' : k === 'hours' ? 'clock' : k === 'message' ? 'mic' : 'file', 'ico-sm')} ${t(`tpl.${k}`)}</span><span class="h">${t(`tpl.${k}H`)}</span></button>`)}</div>
      <div class="row"><button type="button" class="btn btn-primary" data-action="fl.new">${icon('plus')}${t('new')}</button><a class="linkbtn hint" href="#/help/article/flows-guide" data-action="fl.guide">${icon('book', 'ico-sm')}${t('guide')}</a></div></div></div></div>`;
  }
  const numbers = ctx.list('numbers');
  return h`<div class="page fl">${head}
    <div class="grid g-2 fl-cards">${flows.map((f) => {
      const d = docOf(ctx, f.id);
      const dv = draftVersion(f, d);
      const linked = numbers.filter((n) => n.routing && n.routing.type === 'flow' && n.routing.ref === f.id).map((n) => n.number);
      const fb = (f.linked || []).filter((x) => String(x).startsWith('fallback:')).map((x) => x.slice(9));
      const last = (f.versions || [])[0];
      return h`<a class="card fl-card" href="#/flows/${f.id}" data-action="fl.card">
        <div class="row fl-card-h"><span class="fl-ico">${icon('flow')}</span><strong class="grow">${ctx.loc(f.name)}</strong>
          ${f.live ? h`<span class="chip chip-ok">${t('chip.live', { v: f.live })}</span>` : ''}${dv ? h`<span class="chip chip-warn">${t('chip.draft', { v: dv })}</span>` : ''}</div>
        <span class="hint">${linked.length ? t('card.linked', { list: linked.join(', ') }) : fb.length ? t('card.fallback', { list: fb.join(', ') }) : t('card.notLinked')}</span>
        <div class="row fl-card-f hint-xs"><span>${t('card.calls', { n: fmt.int(f.calls7d || 0) })}</span>${last && last.at ? h`<span>· ${t('card.updated', { date: fmt.dayMonth(last.at), by: last.by || '—' })}</span>` : ''}
          ${d.work.hours && d.work.hours.on ? h`<span>· ${icon('clock', 'ico-xs')} ${t('card.hours', { from: d.work.hours.from, to: d.work.hours.to })}</span>` : ''}</div></a>`;
    })}</div>
    <p class="hint-xs">${icon('info', 'ico-xs')} ${t('listNote', { premium: fmt.rate(PRICES.premiumVoice) })}</p></div>`;
}

// ---------- editor ----------
function summary(ctx, n) {
  const { t } = ctx;
  const k = kindOf(n);
  const pr = L(ctx, n.prompt);
  if (k === 'say') return pr || t('sum.empty');
  if (k === 'gather') return t('sum.gather', { n: (n.options || []).length, s: n.wait });
  if (k === 'menu') return `${t('sum.menu', { n: (n.options || []).length })} · ${pr}`;
  if (k === 'transfer') return t(n.record ? 'sum.transferRec' : 'sum.transfer', { target: tgt(ctx, n.target), s: n.ring || 30 });
  if (k === 'record') return t('sum.record', { s: n.max || 60 });
  if (k === 'sms') return t('sum.sms', { link: L(ctx, n.sms) || '—' });
  return pr || t('sum.hangup');
}

function nodeRow(ctx, f, n, i, total) {
  const { t, html: h, icon } = ctx;
  const st = ctx.state;
  const sel = st.sel[f.id] === n.id;
  const sim = st.sim.flowId === f.id ? st.sim : null;
  const onPath = sim && sim.path.includes(n.id);
  const now = sim && sim.at === n.id && sim.phase !== 'ended';
  const k = n.type;
  return h`<li class="fl-node is-${k} ${sel ? 'is-sel' : ''} ${onPath ? 'is-path' : ''} ${now ? 'is-now' : ''}" data-id="${n.id}">
    <div class="fl-row">
      <span class="fl-tico">${icon(TYPE_ICON[k], 'ico-sm')}</span>
      <button type="button" class="fl-main" data-action="fl.node" data-value="${n.id}" aria-pressed="${sel}">
        <span class="fl-type">${t(`type.${k}`)}${n.name ? h` · <span data-fl-name="${n.id}">${L(ctx, n.name)}</span>` : ''}</span>
        <span class="fl-sum clamp-2" data-fl-sum="${n.id}">${summary(ctx, n)}</span></button>
      <div class="fl-acts">
        ${L(ctx, n.prompt) || (k === 'gather' && i > 0) ? h`<button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="fl.node.play" data-value="${n.id}" aria-label="${t('play.path')}" data-tip-key="flows.play.path">${icon(st.playing === n.id ? 'stop' : 'play', 'ico-sm')}</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="fl.node.edit" data-value="${n.id}" aria-label="${t('node.edit')}" data-tip-key="flows.node.edit">${icon('edit', 'ico-sm')}</button>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="fl.node.up" data-value="${n.id}" aria-label="${t('node.up')}" data-tip-key="flows.node.up" ${raw(i === 0 ? 'aria-disabled="true"' : '')}>${icon('chevron-up', 'ico-sm')}</button>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="fl.node.down" data-value="${n.id}" aria-label="${t('node.down')}" data-tip-key="flows.node.down" ${raw(i === total - 1 ? 'aria-disabled="true"' : '')}>${icon('chevron-down', 'ico-sm')}</button>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="fl.node.del" data-value="${n.id}" aria-label="${t('node.del')}" data-tip-key="flows.node.del" ${raw(total <= 1 ? 'aria-disabled="true"' : '')}>${icon('trash', 'ico-sm')}</button>
      </div></div>
    ${k === 'gather' ? h`${optionList(ctx, f, n, 1)}<button type="button" class="fl-timing" data-action="fl.timing" data-value="${n.id}">${icon('clock', 'ico-xs')}<span>${t('timing.line', { s: n.wait, noKey: t(`timing.noKey.${n.noKey}`), wrong: t(`timing.wrong.${n.wrong}`) })}</span></button>` : ''}
  </li>`;
}

function optionList(ctx, f, parent, depth) {
  const { t, html: h, icon } = ctx;
  const st = ctx.state;
  const sim = st.sim.flowId === f.id ? st.sim : null;
  const opts = parent.options || [];
  return h`<ol class="fl-opts fl-d${depth}" aria-label="${t('opts.aria', { name: L(ctx, parent.name) || t(`type.${kindOf(parent)}`) })}">
    ${opts.map((o) => {
      const sel = st.sel[f.id] === o.id;
      const onPath = sim && sim.path.includes(o.id);
      const now = sim && sim.at === o.id && sim.phase !== 'ended';
      return h`<li class="fl-opt is-${o.action} ${sel ? 'is-sel' : ''} ${onPath ? 'is-path' : ''} ${now ? 'is-now' : ''}" data-id="${o.id}">
        <div class="fl-row"><span class="fl-key mono" aria-label="${t('opts.keyAria', { key: o.key })}">${o.key}</span>
          <button type="button" class="fl-main" data-action="fl.node" data-value="${o.id}" aria-pressed="${sel}">
            <span class="fl-type"><span data-fl-name="${o.id}">${L(ctx, o.name)}</span> ${o.isNew ? h`<span class="chip chip-brand">${t('opts.new')}</span>` : ''}</span>
            <span class="fl-sum clamp-2"><span class="fl-act">${icon(TYPE_ICON[o.action], 'ico-xs')}${t(`act.${o.action}`)}</span> · <span data-fl-sum="${o.id}">${summary(ctx, o)}</span></span></button>
          <div class="fl-acts">
            <button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="fl.node.play" data-value="${o.id}" aria-label="${t('play.path')}" data-tip-key="flows.play.path">${icon(st.playing === o.id ? 'stop' : 'play', 'ico-sm')}</button>
            <button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="fl.panel.remove" data-value="${o.id}" aria-label="${t('opts.remove', { key: o.key })}" data-tip-key="flows.opts.removeTip">${icon('x', 'ico-sm')}</button></div></div>
        ${o.action === 'menu' ? optionList(ctx, f, o, depth + 1) : ''}</li>`;
    })}
    <li class="fl-addopt">${opts.length >= MAX_OPTIONS || depth > MAX_DEPTH
      ? h`<button type="button" class="btn btn-sm btn-ghost" data-action="fl.add" data-value="${parent.id}" aria-disabled="true" aria-describedby="fl-max-${parent.id}">${icon('plus', 'ico-sm')}${t('opts.add')}</button><span class="hint-xs" id="fl-max-${parent.id}">${t('opts.max', { n: MAX_OPTIONS, levels: MAX_DEPTH })}</span>`
      : h`<button type="button" class="btn btn-sm btn-ghost" data-action="fl.add" data-value="${parent.id}">${icon('plus', 'ico-sm')}${t('opts.add')}</button>`}</li>
  </ol>`;
}

function hoursCard(ctx, f, d) {
  const { t, html: h, icon } = ctx;
  const hr = d.work.hours;
  const others = ctx.list('flows').filter((x) => x.id !== f.id);
  const sim = ctx.state.sim.flowId === f.id ? ctx.state.sim : null;
  return h`<section class="card fl-hours ${sim && sim.path.includes('hours') ? 'is-path' : ''}" aria-labelledby="fl-h-h">
    <div class="row fl-hours-h"><span class="fl-tico">${icon('clock', 'ico-sm')}</span><h3 id="fl-h-h" class="grow">${t('hours.title')}</h3>
      <button type="button" class="toggle" role="switch" data-action="fl.hours" aria-checked="${hr.on}" aria-labelledby="fl-h-h"></button></div>
    ${hr.on ? h`<div class="fl-hours-b">
        <label class="field"><span class="label">${t('hours.days')}</span><select class="select" data-field="hDays" data-action="fl.hours.days">${DAYS.map((k) => h`<option value="${k}" ${raw(hr.days === k ? 'selected' : '')}>${t(`hours.d.${k}`)}</option>`)}</select></label>
        <label class="field"><span class="label">${t('hours.from')}</span><input class="input mono" type="time" data-field="hFrom" data-action="fl.hours.from" value="${hr.from}"></label>
        <label class="field"><span class="label">${t('hours.to')}</span><input class="input mono" type="time" data-field="hTo" data-action="fl.hours.to" value="${hr.to}"></label>
        <label class="field"><span class="label">${t('hours.outside')}</span><select class="select" data-field="hOutside" data-action="fl.hours.flow">${others.map((x) => h`<option value="${x.id}" ${raw(hr.outside === x.id ? 'selected' : '')}>${ctx.loc(x.name)}</option>`)}</select></label>
        <label class="check fl-hol"><input type="checkbox" data-field="hHol" data-action="fl.hours.hol" ${raw(hr.holidays ? 'checked' : '')}>${t('hours.holidays')}</label>
      </div><p class="hint-xs">${t('hours.line', { days: t(`hours.d.${hr.days}`), from: hr.from, to: hr.to, flow: (others.find((x) => x.id === hr.outside) && ctx.loc(others.find((x) => x.id === hr.outside).name)) || '—' })}</p>`
      : h`<p class="hint-xs">${t('hours.off')}</p>`}</section>`;
}

function panelCard(ctx, f, d) {
  const { t, html: h, icon, fmt } = ctx;
  const sid = ctx.state.sel[f.id] || (d.work.nodes[0] && d.work.nodes[0].id);
  const found = sid && find(d.work, sid);
  if (!found) return h`<section class="card fl-panel"><div class="empty"><span class="hint">${t('panel.none')}</span></div></section>`;
  const n = found.item;
  const k = kindOf(n);
  const isOpt = !n.type;
  const siblings = found.list;
  const usedKeys = siblings.filter((x) => x.id !== n.id).map((x) => x.key);
  const trunks = ctx.list('trunks');
  const targets = [...new Set([...TARGETS, ...trunks.map((x) => `${x.name} ext 200`), n.target].filter(Boolean))];
  const lang = vlang(ctx);
  const promptField = (labelKey = 'panel.prompt', hint = '') => h`<label class="field"><span class="label">${t(labelKey)} <span class="hint-xs">· ${LANGS[lang].label}</span></span>
    <textarea class="textarea" rows="4" data-field="prompt" data-action="fl.panel.prompt" lang="${LANGS[lang].html}">${L(ctx, n.prompt)}</textarea>${hint ? h`<span class="hint-xs">${hint}</span>` : ''}</label>`;
  return h`<section class="card fl-panel" aria-labelledby="fl-p-h">
    <div class="card-head"><span class="fl-tico">${icon(TYPE_ICON[k], 'ico-sm')}</span><h2 id="fl-p-h">${isOpt ? t('panel.option', { key: n.key }) : t(`type.${k}`)}</h2>
      <button type="button" class="btn btn-sm" data-action="fl.panel.play" ${raw(L(ctx, n.prompt) ? '' : 'aria-disabled="true"')}>${icon(ctx.state.playing === n.id ? 'stop' : 'play', 'ico-sm')}${ctx.state.playing === n.id ? t('play.stop') : t('play.preview')}</button></div>
    <div class="card-body stack-3">
      ${isOpt ? h`<div class="fl-2col">
          <label class="field"><span class="label">${t('panel.key')}</span><select class="select mono" data-field="key" data-action="fl.panel.key">${KEYS.filter((x) => x === n.key || !usedKeys.includes(x)).map((x) => h`<option value="${x}" ${raw(n.key === x ? 'selected' : '')}>${x}</option>`)}</select></label>
          <label class="field"><span class="label">${t('panel.name')}</span><input class="input" data-field="name" data-action="fl.panel.name" value="${L(ctx, n.name)}" autocomplete="off"></label></div>
        <label class="field"><span class="label">${t('panel.action')}</span><select class="select" data-field="action" data-action="fl.panel.action">${ACTIONS.filter((a) => a !== 'menu' || found.depth < MAX_DEPTH).map((a) => h`<option value="${a}" ${raw(n.action === a ? 'selected' : '')}>${t(`act.${a}`)}</option>`)}</select></label>`
        : n.name ? h`<label class="field"><span class="label">${t('panel.name')}</span><input class="input" data-field="name" data-action="fl.panel.name" value="${L(ctx, n.name)}" autocomplete="off"></label>` : ''}
      ${k === 'say' ? promptField() : ''}
      ${k === 'menu' ? promptField('panel.menuPrompt', t('panel.menuHint', { n: (n.options || []).length })) : ''}
      ${k === 'gather' ? h`${promptField('panel.gatherPrompt', t('panel.gatherHint'))}
        <fieldset class="fl-fs"><legend class="label">${t('timing.title')}</legend>
          <div class="fl-3col"><label class="field"><span class="hint-xs">${t('timing.wait')}</span><select class="select" data-field="wait">${[3, 5, 8].map((s) => h`<option value="${s}" ${raw(n.wait === s ? 'selected' : '')}>${t('common.seconds', { n: s })}</option>`)}</select></label>
          <label class="field"><span class="hint-xs">${t('timing.noKeyL')}</span><select class="select" data-field="noKey">${['repeat1', 'repeat2', 'hangup'].map((s) => h`<option value="${s}" ${raw(n.noKey === s ? 'selected' : '')}>${t(`timing.noKey.${s}`)}</option>`)}</select></label>
          <label class="field"><span class="hint-xs">${t('timing.wrongL')}</span><select class="select" data-field="wrong">${['repeat', 'hangup'].map((s) => h`<option value="${s}" ${raw(n.wrong === s ? 'selected' : '')}>${t(`timing.wrong.${s}`)}</option>`)}</select></label></div>
          <span class="hint-xs">${t('timing.goodbye')}: ${L(ctx, n.noKeyPrompt)}</span></fieldset>
        <div><button type="button" class="btn btn-sm" data-action="fl.add" data-value="${n.id}" ${raw((n.options || []).length >= MAX_OPTIONS ? 'aria-disabled="true"' : '')}>${icon('plus', 'ico-sm')}${t('opts.add')}</button></div>` : ''}
      ${k === 'transfer' ? h`${promptField('panel.transferPrompt')}
        <div class="fl-2col"><label class="field"><span class="label">${t('panel.target')}</span><select class="select" data-field="target" data-action="fl.panel.target">${targets.map((x) => h`<option value="${x}" ${raw(n.target === x ? 'selected' : '')}>${tgt(ctx, x)}</option>`)}</select></label>
          <label class="field"><span class="label">${t('panel.ring')}</span><select class="select" data-field="ring">${[15, 20, 30, 45].map((s) => h`<option value="${s}" ${raw((n.ring || 30) === s ? 'selected' : '')}>${t('common.seconds', { n: s })}</option>`)}</select></label></div>
        <label class="check"><input type="checkbox" data-field="record" ${raw(n.record ? 'checked' : '')}>${t('panel.recordCall', { price: fmt.rate(PRICES.recording), days: PRICES.recordingDays })}</label>
        ${String(n.target).includes('cm-branch-pbx') && (trunks.find((x) => x.name === 'cm-branch-pbx') || {}).status === 'down' ? h`<div class="note note-warn">${icon('alert')}<span>${t('panel.trunkDown')}</span></div>` : ''}` : ''}
      ${k === 'record' ? h`${isOpt || L(ctx, n.prompt) ? promptField('panel.recordPrompt') : ''}
        <label class="field"><span class="label">${t('panel.max')}</span><select class="select" data-field="max">${[30, 60, 120].map((s) => h`<option value="${s}" ${raw((n.max || 60) === s ? 'selected' : '')}>${t('common.seconds', { n: s })}</option>`)}</select></label>
        <p class="hint-xs">${t('panel.recordHint', { price: fmt.rate(PRICES.recording), days: PRICES.recordingDays })}</p>` : ''}
      ${k === 'sms' ? h`<label class="field"><span class="label">${t('panel.smsLink')}</span><input class="input" data-field="sms" data-action="fl.panel.sms" value="${L(ctx, n.sms)}" autocomplete="off"></label>
        <div class="note note-info">${icon('sms')}<span>${t('panel.smsNote')}</span></div>${promptField('panel.smsPrompt')}` : ''}
      ${k === 'hangup' ? promptField('panel.hangupPrompt', t('panel.hangupHint')) : ''}
      <div class="row fl-panelfoot">${isOpt
        ? h`<button type="button" class="btn btn-sm btn-danger-ghost" data-action="fl.panel.remove" data-value="${n.id}">${icon('trash', 'ico-sm')}${t('panel.removeOpt')}</button>`
        : h`<button type="button" class="btn btn-sm btn-danger-ghost" data-action="fl.node.del" data-value="${n.id}" ${raw(d.work.nodes.length <= 1 ? 'aria-disabled="true"' : '')}>${icon('trash', 'ico-sm')}${t('panel.removeStep')}</button>`}
        <span class="hint-xs grow">${t('panel.autosave')}</span></div>
    </div></section>`;
}

function simCard(ctx, f, d) {
  const { t, html: h, icon } = ctx;
  const sim = ctx.state.sim.flowId === f.id ? ctx.state.sim : { phase: 'idle', trail: [], path: [], text: '', when: ctx.state.sim.when, note: '' };
  const hr = d.work.hours;
  const running = sim.phase !== 'idle' && sim.phase !== 'ended';
  const keysOn = running && (sim.phase === 'waiting' || sim.phase === 'recording' || (sim.phase === 'speaking' && sim.menuId));
  const paths = quickPaths(d.work).slice(0, 4);
  const openNow = isOpen(hr, nowMs());
  const lang = vlang(ctx);
  return h`<section class="card fl-sim" aria-labelledby="fl-s-h">
    <div class="card-head"><span class="fl-tico">${icon('phone-in', 'ico-sm')}</span><h2 id="fl-s-h">${t('sim.title')}</h2>
      ${running ? h`<button type="button" class="btn btn-sm" data-action="fl.sim.stop">${icon('stop', 'ico-sm')}${t('sim.stop')}</button>`
        : h`<button type="button" class="btn btn-sm btn-navy" data-action="fl.sim.start">${icon('play', 'ico-sm')}${sim.phase === 'ended' ? t('sim.again') : t('sim.start')}</button>`}</div>
    <div class="card-body stack-3">
      ${hr.on ? h`<div class="seg seg-sm" role="group" aria-label="${t('sim.whenAria')}">${['now', 'outside'].map((k) => h`<button type="button" data-action="fl.sim.time" data-value="${k}" aria-pressed="${(ctx.state.sim.when || 'now') === k}" ${raw(running ? 'aria-disabled="true"' : '')}>${k === 'now' ? t(openNow ? 'sim.nowOpen' : 'sim.nowClosed', { time: ctx.fmt.timeShort(nowMs()) }) : t('sim.outside')}</button>`)}</div>` : ''}
      <div class="fl-status" aria-live="polite"><span class="dot ${running ? 'dot-ok dot-live' : ''}"></span><span>${sim.phase === 'idle' ? t('sim.idle', { lang: LANGS[lang].label }) : t(`sim.ph.${sim.phase}`, { s: sim.waitS || 0, result: sim.result ? t(`sim.res.${sim.result}`, sim.resVars || {}) : '' })}</span></div>
      <div class="captions fl-cap" data-fl-cap lang="${LANGS[lang].html}">${sim.text ? ctx.ui.audio.words(sim.text, LANGS[lang].tts).map((w, i) => h`<span class="w ${i <= (sim.wordIdx ?? -1) ? 'on' : ''}">${w.text}</span>`) : h`<span class="ph">${t('sim.capEmpty')}</span>`}</div>
      ${sim.note ? h`<p class="dl-note">${icon('info')}<span>${sim.note}</span></p>` : ''}
      <div class="fl-keypad" role="group" aria-label="${t('sim.keypad')}">${KEYS.map((k) => h`<button type="button" data-action="fl.sim.key" data-value="${k}" aria-label="${k}" ${raw(keysOn ? '' : 'aria-disabled="true"')}>${k}</button>`)}</div>
      ${paths.length ? h`<div class="stack fl-quick"><span class="hint-xs">${t('sim.tryPath')}</span><div class="row">${paths.map((p) => h`<button type="button" class="btn btn-sm mono" data-action="fl.sim.auto" data-value="${p.keys.join(',')}" ${raw(running ? 'aria-disabled="true"' : '')} aria-label="${t('sim.autoAria', { keys: p.keys.join(' → '), name: L(ctx, p.name) })}">${p.keys.join(' → ')}</button>`)}</div></div>` : ''}
      ${sim.trail.length ? h`<ol class="fl-trail" aria-label="${t('sim.trailAria')}">${sim.trail.map((s) => h`<li class="is-${s.kind}">${s.key ? h`<span class="fl-key mono">${s.key}</span>` : ''}<span>${s.text}</span></li>`)}</ol>` : ''}
      <p class="hint-xs">${t('sim.note')}</p></div></section>`;
}

function quickPaths(doc) {
  const out = [];
  const g = doc.nodes.find((n) => n.type === 'gather');
  if (!g) return out;
  const rec = (opts, keys) => {
    for (const o of opts) {
      if (o.action === 'menu') rec(o.options || [], [...keys, o.key]);
      else out.push({ keys: [...keys, o.key], name: o.name });
    }
  };
  rec(g.options || [], []);
  // The deepest path (it shows the most), then the one-key paths in menu order.
  const deep = out.filter((p) => p.keys.length > 1).sort((a, b) => b.keys.length - a.keys.length).slice(0, 1);
  return [...deep, ...out.filter((p) => p.keys.length === 1)];
}

function versionsCard(ctx, f, d) {
  const { t, html: h, icon, fmt } = ctx;
  const dv = draftVersion(f, d);
  const list = [...(f.versions || [])];
  if (dv && !list.some((x) => x.v === dv)) list.unshift({ v: dv, status: 'draft', at: null, by: ctx.store.get('user.name') });
  list.sort((a, b) => b.v - a.v);
  return h`<section class="card fl-vers" aria-labelledby="fl-v-h"><div class="card-head"><h2 id="fl-v-h">${t('ver.title')}</h2></div>
    <ol class="fl-verlist">${list.map((x) => {
      const isDraft = x.v === dv;
      const isLive = x.v === f.live;
      return h`<li><button type="button" class="fl-verrow" data-action="fl.ver.row" data-value="${x.v}">
          <strong>${t('ver.v', { v: x.v })}</strong>${isLive ? h`<span class="chip chip-ok">${t('ver.live')}</span>` : ''}${isDraft ? h`<span class="chip chip-warn">${t('ver.draft')}</span>` : ''}
          <span class="hint-xs grow">${x.at ? fmt.dayMonth(x.at) : t('ver.unsaved')}${x.by ? ` · ${x.by}` : ''}${isDraft ? (d.changes.length ? ` · ${changesOf(ctx, d).join(', ')}` : '') : x.note ? ` · ${x.note}` : ''}</span></button>
        ${!isDraft ? h`<button type="button" class="btn btn-sm btn-ghost" data-action="fl.ver.restore" data-value="${x.v}">${icon('refresh', 'ico-sm')}${t('ver.restore')}</button>` : ''}</li>`;
    })}</ol></section>`;
}

function changesOf(ctx, d) {
  const { t } = ctx;
  return d.changes.map((c) => {
    const v = c.vars || {};
    const name = v.name ? (typeof v.name === 'string' ? v.name : L(ctx, v.name)) : v.typeKey ? t(`type.${v.typeKey}`) : '';
    return t(`chg.${c.k}`, { ...v, name, type: v.typeKey ? t(`type.${v.typeKey}`) : '' });
  });
}

function editorPage(ctx, key) {
  const { t, html: h, icon, fmt } = ctx;
  const f = flowBy(ctx, key);
  if (!f) {
    return h`<div class="page fl"><div class="card"><div class="empty empty-center"><span class="art">${icon('flow')}</span><h2>${t('nf.title')}</h2><span class="hint">${t('nf.body')}</span>
      <a class="btn btn-navy" href="#/flows" data-action="fl.back">${icon('arrow-left', 'ico-sm')}${t('nf.back')}</a></div></div></div>`;
  }
  const d = docOf(ctx, f.id);
  const dv = draftVersion(f, d);
  const pubV = dv || (f.live || 0) + 1;
  const canPublish = !!dv;
  const numbers = ctx.list('numbers').filter((n) => n.type !== 'loa');
  const lang = vlang(ctx);
  const pm = particleMismatch(d.work);
  const verified = ctx.store.get('verifiedNumbers') || [];
  return h`<div class="page fl">
    <div class="page-head"><div class="titles"><a class="linkbtn hint fl-back" href="#/flows" data-action="fl.back">${icon('arrow-left', 'ico-xs')}${t('title')}</a>
        <h1 class="row-tight fl-title"><span>${ctx.loc(f.name)}</span> <span class="chip chip-info" tabindex="0" data-tip-key="flows.betaTip">${t('common.beta')}</span>${ctx.pageHelp()}</h1>
        <div class="row-tight fl-chips">${f.live ? h`<span class="chip chip-ok">${t('chip.live', { v: f.live })}</span>` : h`<span class="chip">${t('chip.notLive')}</span>`}
          ${dv ? h`<span class="chip chip-warn">${t('chip.draft', { v: dv })}</span>` : ''}<span class="chip chip-brand" data-fl-unsaved ${raw(d.dirty ? '' : 'hidden')}>${t('chip.unsaved')}</span></div></div>
      <div class="tools">
        <button type="button" class="btn" data-action="fl.test">${icon('phone')}${t('test', { number: verified[0] || '' })}</button>
        <button type="button" class="btn" data-action="fl.save">${icon('file', 'ico-sm')}${t('save')}</button>
        <button type="button" class="btn btn-primary" data-action="fl.publish" ${raw(canPublish ? '' : 'aria-disabled="true" aria-describedby="fl-pub-h"')}>${icon('rocket')}${t('publish', { v: pubV })}</button>
        ${canPublish ? '' : h`<span class="hint-xs" id="fl-pub-h">${t('publishNone')}</span>`}</div></div>

    <div class="card fl-bar">
      <label class="field"><span class="label">${t('bar.number')}</span><select class="select mono" data-field="number" data-action="fl.number"><option value="">${t('bar.noNumber')}</option>${numbers.map((n) => h`<option value="${n.number}" ${raw(d.work.number === n.number ? 'selected' : '')}>${n.number}${n.status !== 'active' ? ` · ${t('bar.inReview')}` : ''}</option>`)}</select></label>
      <div class="field"><span class="label">${t('bar.lang')}</span><div class="seg" role="group" aria-label="${t('bar.lang')}">${LANG_ORDER.map((l) => h`<button type="button" data-action="fl.lang" data-value="${l}" aria-pressed="${lang === l}">${LANGS[l].label}</button>`)}</div></div>
      <label class="field"><span class="label">${ctx.term(t('bar.voice'), 'voice_tier')}</span><select aria-label="${t('bar.voice')}" class="select" data-field="voice" data-action="fl.panel.voice">${['female', 'male', 'premium'].map((v) => h`<option value="${v}" ${raw(d.work.voice === v ? 'selected' : '')}>${t(`voice.${v}`, { price: fmt.rate(PRICES.premiumVoice) })}</option>`)}</select></label>
      ${d.work.voice === 'premium' ? h`<p class="hint-xs fl-barnote">${t('voice.premiumLine', { price: fmt.rate(PRICES.premiumVoice) })}</p>` : ''}
      ${pm ? h`<div class="note note-warn fl-barnote">${icon('info')}<div class="grow">${t(pm === 'toMale' ? 'particle.toMale' : 'particle.toFemale')}</div><button type="button" class="btn btn-sm" data-action="fl.fix">${t('particle.fix')}</button></div>` : ''}
    </div>

    <div class="fl-grid">
      <div class="stack-4 fl-left">
        ${hoursCard(ctx, f, d)}
        <section class="card fl-steps" aria-labelledby="fl-n-h"><div class="card-head"><h2 id="fl-n-h">${t('steps.title')}</h2><span class="hint-xs">${t('steps.hint')}</span></div>
          <ol class="fl-nodes">${d.work.nodes.map((n, i) => nodeRow(ctx, f, n, i, d.work.nodes.length))}</ol>
          <div class="fl-addnode"><span class="hint-xs">${t('steps.add')}</span>${NODE_TYPES.map((k) => h`<button type="button" class="btn btn-sm" data-action="fl.addnode" data-value="${k}">${icon(TYPE_ICON[k], 'ico-sm')}${t(`type.${k}`)}</button>`)}</div></section>
        ${d.changes.length ? h`<section class="card card-pad fl-changes"><strong>${t('chg.title', { v: pubV })}</strong><ul>${changesOf(ctx, d).map((c) => h`<li>${c}</li>`)}</ul></section>` : ''}
      </div>
      <div class="stack-4 fl-right">${panelCard(ctx, f, d)}${simCard(ctx, f, d)}${versionsCard(ctx, f, d)}
        ${!f.live ? h`<section class="card card-pad stack"><strong>${t('del.title')}</strong><span class="hint-xs">${t('del.hint')}</span><div><button type="button" class="btn btn-sm btn-danger-ghost" data-action="fl.delete">${icon('trash', 'ico-sm')}${t('del.btn')}</button></div></section>` : ''}
      </div></div></div>`;
}

export function render(ctx) {
  const key = ctx.params.path[0];
  return key ? editorPage(ctx, key) : listPage(ctx);
}

// ---------- simulation ----------
function sim(ctx) { return ctx.state.sim; }
function simRedraw(ctx, fid) { if (location.hash.startsWith(`#/flows/${fid}`)) ctx.rerender(); }

// A test call in the shared dialer can drive the same engine: key presses in the dialer go to pressKey(),
// prompts are spoken by the call (call.say), and the steps light up on the page as they are reached.
let DCALL = null; // { fid, call, run }
let DENDED = null; // the call whose path already ended (it hangs up a moment later)
function dcall(ctx, fid) {
  const s = sim(ctx);
  return DCALL && DCALL.fid === fid && DCALL.run === s.run ? DCALL : null;
}
function bindDialer(ctx, fid, call) {
  const { t } = ctx;
  const s = sim(ctx);
  simStop(ctx, { silent: true });
  const doc = docOf(ctx, fid).work;
  const gi = doc.nodes.findIndex((n) => n.type === 'gather');
  Object.assign(s, { flowId: fid, phase: 'waiting', trail: [], path: [], text: '', result: '', resVars: {}, at: null, menuId: gi >= 0 ? doc.nodes[gi].id : null, menuIndex: gi, retries: 0, queue: [], note: '' });
  const hr = doc.hours;
  if (hr && hr.on) { s.path.push('hours'); trail(s, 'ok', t('sim.tr.open', { from: hr.from, to: hr.to })); }
  const first = doc.nodes.find((n) => n.type === 'say');
  if (first) { s.path.push(first.id); trail(s, 'say', t('sim.tr.say', { name: L(ctx, first.name) || t('type.say') })); }
  if (gi >= 0) { s.path.push(doc.nodes[gi].id); s.at = doc.nodes[gi].id; }
  DCALL = { fid, call, run: s.run };
}

function simStop(ctx, { silent = false } = {}) {
  const s = sim(ctx);
  s.run += 1;
  stopSpeech();
  ctx.ui.audio.tones.stop();
  clearTimeout(s._wait);
  if (!silent) { s.phase = s.phase === 'idle' ? 'idle' : 'ended'; if (s.phase === 'ended' && !s.result) s.result = 'stopped'; }
}

function simSay(ctx, fid, text, opts, then) {
  const s = sim(ctx);
  const run = s.run;
  const dc = dcall(ctx, fid);
  if (dc && !dc.call.inCall()) { DCALL = null; simStop(ctx); simRedraw(ctx, fid); return; }
  s.text = text;
  s.wordIdx = -1;
  if (s.phase !== 'recording') s.phase = 'speaking';
  if (dc) {
    s.note = '';
    dc.call.say(text, { after: () => { if (s.run === run) then(); } });
    simRedraw(ctx, fid);
    return;
  }
  const doc = docOf(ctx, fid).work;
  const note = speak(ctx, text, {
    edited: !!opts.edited, premium: doc.voice === 'premium',
    onWord: (i) => {
      s.wordIdx = i;
      const cap = document.querySelector('#outlet [data-fl-cap]');
      if (cap) cap.querySelectorAll('.w').forEach((w, k) => { w.classList.toggle('on', k <= i); w.classList.toggle('cur', k === i); });
    },
    then: () => { if (s.run === run) then(); },
  });
  s.note = note;
  simRedraw(ctx, fid);
}

function trail(s, kind, text, key) { s.trail.push({ kind, text, key }); }

function simEnd(ctx, fid, result, vars = {}) {
  const s = sim(ctx);
  clearTimeout(s._wait);
  s.phase = 'ended';
  s.result = result;
  s.resVars = vars;
  s.menuId = null;
  s.queue = [];
  trail(s, result === 'noKey' || result === 'closedFallback' ? 'warn' : 'end', ctx.t(`sim.res.${result}`, vars));
  const dc = dcall(ctx, fid);
  if (dc) { DCALL = null; DENDED = dc.call; setTimeout(() => { if (dc.call.inCall()) dc.call.hangup(); }, reducedMotion() ? 200 : 700); } // the dialer plays its own hang-up tone
  else ctx.ui.audio.tones.hangup();
  simRedraw(ctx, fid);
}

function simStart(ctx, fid, queue = []) {
  const { t } = ctx;
  const s = sim(ctx);
  simStop(ctx, { silent: true });
  ctx.ui.audio.unlock();
  Object.assign(s, { flowId: fid, phase: 'speaking', trail: [], path: [], text: '', result: '', resVars: {}, at: null, menuId: null, retries: 0, queue: [...queue], note: '' });
  const doc = docOf(ctx, fid).work;
  const hr = doc.hours;
  if (hr && hr.on) {
    const open = (s.when || 'now') === 'now' ? isOpen(hr, nowMs()) : false;
    s.path.push('hours');
    if (!open) {
      const target = ctx.list('flows').find((x) => x.id === hr.outside);
      trail(s, 'warn', t('sim.tr.outside', { flow: target ? ctx.loc(target.name) : '—' }));
      const td = target ? docOf(ctx, target.id).work : null;
      const first = td && td.nodes.find((n) => n.type === 'say');
      simSay(ctx, fid, first ? L(ctx, first.prompt) : L(ctx, TXT.closed), { edited: first && first.edited }, () => simEnd(ctx, fid, 'closedFlow', { flow: target ? ctx.loc(target.name) : '—' }));
      return;
    }
    trail(s, 'ok', t('sim.tr.open', { from: hr.from, to: hr.to }));
  }
  runNode(ctx, fid, 0);
}

function runNode(ctx, fid, i) {
  const { t } = ctx;
  const s = sim(ctx);
  const doc = docOf(ctx, fid).work;
  const n = doc.nodes[i];
  if (!n) { simEnd(ctx, fid, 'hangup'); return; }
  s.at = n.id;
  s.path.push(n.id);
  if (n.type === 'say') {
    const next = doc.nodes[i + 1];
    s.menuId = next && next.type === 'gather' ? next.id : null; // callers may press a key during the greeting
    s.menuIndex = i + 1;
    trail(s, 'say', t('sim.tr.say', { name: L(ctx, n.name) || t('type.say') }));
    simSay(ctx, fid, L(ctx, n.prompt), { edited: n.edited }, () => runNode(ctx, fid, i + 1));
    // "Try a path": the simulated caller presses the first key during the greeting (barge-in).
    if (s.menuId && s.queue && s.queue.length) {
      const run = s.run;
      setTimeout(() => { if (s.run === run && s.phase === 'speaking' && s.queue.length) pressKey(ctx, fid, s.queue.shift()); }, reducedMotion() ? 400 : 1400);
    }
    return;
  }
  if (n.type === 'gather') { s.menuIndex = i; enterMenu(ctx, fid, n, doc.nodes[i - 1]); return; }
  if (n.type === 'transfer') { doTransfer(ctx, fid, n); return; }
  if (n.type === 'record') { doRecord(ctx, fid, n); return; }
  if (n.type === 'hangup') {
    const pr = L(ctx, n.prompt);
    if (pr) simSay(ctx, fid, pr, { edited: n.edited }, () => simEnd(ctx, fid, 'hangup'));
    else simEnd(ctx, fid, 'hangup');
  }
}

function enterMenu(ctx, fid, menu, prevSay, repeat = false) {
  const s = sim(ctx);
  s.menuId = menu.id;
  s.at = menu.id;
  if (!s.path.includes(menu.id)) s.path.push(menu.id);
  const text = L(ctx, menu.prompt) || (repeat && prevSay ? L(ctx, prevSay.prompt) : '');
  if (text) simSay(ctx, fid, text, { edited: menu.edited }, () => waitKey(ctx, fid, menu, prevSay));
  else waitKey(ctx, fid, menu, prevSay);
}

function waitKey(ctx, fid, menu, prevSay) {
  const s = sim(ctx);
  const run = s.run;
  s.phase = 'waiting';
  s.menuId = menu.id;
  const waitS = menu.wait || 5;
  s.waitS = waitS;
  simRedraw(ctx, fid);
  if (s.queue && s.queue.length) {
    const k = s.queue.shift();
    setTimeout(() => { if (s.run === run && s.phase === 'waiting') pressKey(ctx, fid, k); }, reducedMotion() ? 300 : 800);
    return;
  }
  clearTimeout(s._wait);
  s._wait = setTimeout(() => {
    if (s.run !== run || s.phase !== 'waiting') return;
    const root = gatherOf(ctx, fid, menu);
    const limit = root.noKey === 'repeat2' ? 2 : root.noKey === 'repeat1' ? 1 : 0;
    trail(s, 'warn', ctx.t('sim.tr.noKey', { s: waitS }));
    if (s.retries < limit) { s.retries += 1; enterMenu(ctx, fid, menu, prevSay, true); return; }
    simSay(ctx, fid, L(ctx, root.noKeyPrompt || TXT.noKey), {}, () => simEnd(ctx, fid, 'noKey'));
  }, waitS * 1000);
}

function gatherOf(ctx, fid, menu) {
  const doc = docOf(ctx, fid).work;
  if (menu.type === 'gather') return menu;
  const chain = pathTo(doc, menu.id);
  return chain.find((x) => x.type === 'gather') || menu;
}

function pressKey(ctx, fid, k) {
  const { t } = ctx;
  const s = sim(ctx);
  ctx.ui.audio.unlock();
  if (!dcall(ctx, fid)) ctx.ui.audio.tones.dtmf(k);
  if (s.phase === 'recording') {
    if (k === '#') { clearTimeout(s._wait); trail(s, 'ok', t('sim.tr.recDone')); simEnd(ctx, fid, 'recorded'); }
    return;
  }
  const doc = docOf(ctx, fid).work;
  const menuFound = s.menuId && find(doc, s.menuId);
  if (!menuFound) return;
  const menu = menuFound.item;
  // Barge-in: a key during the greeting or the menu prompt stops the speech.
  if (s.phase === 'speaking') { stopSpeech(); if (!s.path.includes(menu.id)) s.path.push(menu.id); }
  clearTimeout(s._wait);
  const o = (menu.options || []).find((x) => x.key === k);
  const prevSay = doc.nodes[(s.menuIndex || 1) - 1];
  if (!o) {
    trail(s, 'warn', t('sim.tr.wrong'), k);
    const root = gatherOf(ctx, fid, menu);
    if (root.wrong === 'hangup') { simSay(ctx, fid, L(ctx, TXT.wrong), {}, () => simEnd(ctx, fid, 'wrongKey')); return; }
    simSay(ctx, fid, L(ctx, TXT.wrong), {}, () => enterMenu(ctx, fid, menu, prevSay, true));
    return;
  }
  s.at = o.id;
  s.path.push(o.id);
  s.menuId = null;
  trail(s, 'key', L(ctx, o.name), k);
  if (o.action === 'menu') { enterMenu(ctx, fid, o, prevSay); return; }
  if (o.action === 'say') { simSay(ctx, fid, L(ctx, o.prompt), { edited: o.edited }, () => simEnd(ctx, fid, 'message')); return; }
  if (o.action === 'transfer') { doTransfer(ctx, fid, o); return; }
  if (o.action === 'record') { doRecord(ctx, fid, o); return; }
  if (o.action === 'sms') {
    trail(s, 'ok', t('sim.tr.sms', { link: L(ctx, o.sms) || '—' }));
    simSay(ctx, fid, L(ctx, o.prompt), { edited: o.edited }, () => simEnd(ctx, fid, 'sms'));
    return;
  }
  simEnd(ctx, fid, 'hangup');
}

function doTransfer(ctx, fid, n) {
  const { t } = ctx;
  const s = sim(ctx);
  s.at = n.id;
  const target = n.target || '';
  const trunkName = (target.match(/(?:via )?([a-z0-9-]+-pbx)/) || [])[1];
  const trunk = trunkName && ctx.list('trunks').find((x) => x.name === trunkName);
  const afterPrompt = () => {
    if (trunk && (trunk.status === 'down' || trunk.status === 'off')) {
      trail(s, 'warn', t('sim.tr.trunkDown', { trunk: trunk.name }));
      simSay(ctx, fid, L(ctx, TXT.closed), {}, () => simEnd(ctx, fid, 'closedFallback', { trunk: trunk.name }));
      return;
    }
    s.phase = 'ringing';
    trail(s, 'ok', t('sim.tr.ringing', { target: tgt(ctx, target) }));
    simRedraw(ctx, fid);
    const stop = ctx.ui.audio.tones.ringback(1);
    const run = s.run;
    setTimeout(() => { if (typeof stop === 'function') stop(); if (s.run === run) simEnd(ctx, fid, 'transferred', { target: tgt(ctx, target) }); }, reducedMotion() ? 600 : 2400);
  };
  const pr = L(ctx, n.prompt);
  if (pr) simSay(ctx, fid, pr, { edited: n.edited }, afterPrompt); else afterPrompt();
}

function doRecord(ctx, fid, n) {
  const { t } = ctx;
  const s = sim(ctx);
  const begin = () => {
    s.phase = 'recording';
    ctx.ui.audio.tones.busy(1); // the beep
    trail(s, 'ok', t('sim.tr.recording', { s: n.max || 60 }));
    simRedraw(ctx, fid);
    const run = s.run;
    clearTimeout(s._wait);
    s._wait = setTimeout(() => { if (s.run === run && s.phase === 'recording') simEnd(ctx, fid, 'recorded'); }, 4000);
  };
  const pr = L(ctx, n.prompt);
  if (pr) simSay(ctx, fid, pr, { edited: n.edited }, begin); else begin();
}

// ---------- modals ----------
function newFlowModal(ctx, tpl = 'main') {
  const { t, html: h, icon } = ctx;
  let pick = tpl;
  const body = () => h`<div class="stack-3">
    <label class="field"><span class="label">${t('new.name')}</span><input class="input" data-m="name" placeholder="${t('new.namePh')}" autocomplete="off" autofocus></label>
    <span class="field-err" data-m="err" hidden>${t('new.nameErr')}</span>
    <div class="field"><span class="label">${t('new.from')}</span><div class="grid g-2 fl-tpls" role="radiogroup" aria-label="${t('new.from')}">${['main', 'hours', 'message', 'blank'].map((k) => h`<button type="button" class="optcard" role="radio" data-action="fl.new.tpl" data-value="${k}" aria-checked="${pick === k}"><span class="t">${icon(k === 'main' ? 'dialpad' : k === 'hours' ? 'clock' : k === 'message' ? 'mic' : 'file', 'ico-sm')} ${t(`tpl.${k}`)}</span><span class="h">${t(`tpl.${k}H`)}</span></button>`)}</div></div>
    <p class="hint-xs">${t('new.note')}</p></div>`;
  const m = ctx.ui.modal({
    title: t('new.title'), size: 'md', body: body(),
    actions: {
      'fl.new.tpl': (el, ev, hd) => {
        const name = hd.el.querySelector('[data-m="name"]').value;
        pick = el.dataset.value;
        hd.setBody(body());
        hd.el.querySelector('[data-m="name"]').value = name;
        hd.el.querySelector(`[data-action="fl.new.tpl"][data-value="${pick}"]`).focus();
      },
    },
    buttons: [
      { label: t('common.cancel') },
      { label: t('new.create'), kind: 'primary', icon: 'plus', onClick: (hd) => {
        const name = hd.el.querySelector('[data-m="name"]').value.trim();
        if (!name) { hd.el.querySelector('[data-m="err"]').hidden = false; hd.el.querySelector('[data-m="name"]').focus(); return false; }
        const fid = newId('flw');
        ctx.store.push('flows', { id: fid, name: { en: name, th: name, zh: name }, live: null, draft: 1, versions: [{ v: 1, status: 'draft', at: today(), by: ctx.store.get('user.name') }], linked: [], calls7d: 0 });
        ctx.state.docs[fid] = { work: TEMPLATES[pick](), snapshots: {}, changes: [{ k: 'created' }], dirty: false };
        audit('flow.created', { name, template: pick }, fid);
        ctx.ui.toast(t('new.done', { name }), { kind: 'success' });
        ctx.go(`flows/${fid}`);
        return true;
      } },
    ],
  });
  return m;
}

function publishModal(ctx, f) {
  const { t, html: h, icon } = ctx;
  const d = docOf(ctx, f.id);
  const v = draftVersion(f, d) || (f.live || 0) + 1;
  const changes = changesOf(ctx, d);
  const linkedNow = ctx.list('numbers').filter((n) => n.routing && n.routing.type === 'flow' && n.routing.ref === f.id).map((n) => n.number);
  const target = d.work.number;
  const nums = [...new Set([...linkedNow, ...(target ? [target] : [])])];
  ctx.ui.modal({
    title: t('pub.title', { name: ctx.loc(f.name), v }), size: 'md',
    body: h`<div class="stack-3">
      <div><span class="label">${t('pub.changes', { count: changes.length, n: changes.length })}</span><ul class="fl-publist">${changes.map((c) => h`<li>${c}</li>`)}</ul></div>
      <label class="field"><span class="label">${t('pub.note')}</span><textarea class="textarea" rows="2" data-m="note">${changes.join(', ')}</textarea><span class="hint-xs">${t('pub.noteHint')}</span></label>
      <div class="note note-info">${icon('info')}<span>${nums.length ? t('pub.effect', { list: nums.join(', '), v }) : t('pub.noNumbers')}</span></div>
      ${d.work.hours && d.work.hours.on ? h`<p class="hint-xs">${t('pub.hours', { from: d.work.hours.from, to: d.work.hours.to })}</p>` : ''}
      <p class="hint-xs">${t('pub.rollback', { v: f.live || '—' })}</p></div>`,
    buttons: [
      { label: t('pub.keep'), id: 'fl-pub-cancel' },
      { label: t('pub.yes', { v }), kind: 'primary', icon: 'rocket', onClick: (hd) => {
        const note = hd.el.querySelector('[data-m="note"]').value.trim();
        const who = ctx.store.get('user.name');
        d.snapshots[v] = clone(d.work);
        d.changes = [];
        d.dirty = false;
        ctx.store.update('flows', (list) => list.map((x) => (x.id === f.id ? {
          ...x, live: v, draft: null,
          versions: [{ v, status: 'live', at: today(), by: who, note }, ...(x.versions || []).filter((y) => y.v !== v).map((y) => ({ ...y, status: undefined }))],
          linked: [...new Set([...(x.linked || []).filter((y) => String(y).startsWith('fallback:')), ...nums])],
        } : x)));
        if (target) ctx.store.update('numbers', (list) => list.map((n) => (n.number === target ? { ...n, routing: { type: 'flow', ref: f.id } } : n)));
        audit('flow.published', { flow: f.id, v, note }, f.id);
        ctx.ui.toast(t('toast.T25', { name: ctx.loc(f.name), v }), { kind: 'success' });
        return true;
      } },
    ],
  });
  setTimeout(() => { const c = document.getElementById('fl-pub-cancel'); if (c) c.focus(); }, 40);
}

function previewModal(ctx, f, v) {
  const { t, html: h, icon } = ctx;
  const d = docOf(ctx, f.id);
  const dv = draftVersion(f, d);
  const doc = v === dv ? d.work : d.snapshots[v] || (f.id === 'flw_01JB5MAIN1' ? mainMenu(v) : d.work);
  const rows = [];
  walk(doc.nodes, (n, list, i, parent, depth) => rows.push({ n, depth }));
  ctx.ui.modal({
    title: t('ver.previewTitle', { name: ctx.loc(f.name), v }), size: 'md',
    body: h`<p class="hint-xs">${t('ver.readOnly')}</p>
      ${doc.hours && doc.hours.on ? h`<p class="hint">${icon('clock', 'ico-xs')} ${t('hours.line', { days: t(`hours.d.${doc.hours.days}`), from: doc.hours.from, to: doc.hours.to, flow: '…' })}</p>` : ''}
      <ol class="fl-prev">${rows.map(({ n, depth }) => h`<li style="--d:${depth}">${n.key ? h`<span class="fl-key mono">${n.key}</span>` : h`<span class="fl-tico">${icon(TYPE_ICON[n.type], 'ico-xs')}</span>`}
        <span><strong>${n.key ? L(ctx, n.name) : t(`type.${n.type}`)}</strong> · <span class="hint-xs">${n.key ? t(`act.${n.action}`) + ' · ' : ''}${summary(ctx, n)}</span></span></li>`)}</ol>`,
    buttons: [{ label: t('common.close'), kind: 'navy' }],
  });
}

// ---------- behaviour ----------
function moveNode(ctx, fid, nid1, dir) {
  const d = docOf(ctx, fid);
  const i = d.work.nodes.findIndex((n) => n.id === nid1);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.work.nodes.length) return;
  const list = d.work.nodes;
  [list[i], list[j]] = [list[j], list[i]];
  touch(ctx, fid, { k: 'moved', vars: { typeKey: list[j].type } });
  ctx.rerender();
  const b = document.querySelector(`#outlet [data-action="fl.node.${dir < 0 ? 'up' : 'down'}"][data-value="${nid1}"]`);
  if (b && b.getAttribute('aria-disabled') !== 'true') b.focus(); else { const m = document.querySelector(`#outlet [data-action="fl.node"][data-value="${nid1}"]`); if (m) m.focus(); }
}

function newOption(ctx, parent) {
  const used = (parent.options || []).map((o) => o.key);
  const key = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].find((k) => !used.includes(k)) || '0';
  const name = P(`Option ${key}`, `ตัวเลือก ${key}`, `选项 ${key}`);
  const prompt = P('Thank you. Goodbye.', 'ขอบคุณค่ะ สวัสดีค่ะ', '谢谢，再见。');
  return { id: nid(), key, name, action: 'say', prompt, isNew: true, edited: false };
}

function newNode(type) {
  if (type === 'say') return { id: nid(), type, name: P('Message', 'ข้อความ', '提示音'), prompt: P('Thank you for calling.', 'ขอบคุณที่โทรมาค่ะ', '感谢来电。') };
  if (type === 'gather') return { ...gather(P('Menu', 'เมนู', '菜单'), []), prompt: P('For our staff, press 1.', 'ติดต่อเจ้าหน้าที่ กด 1 ค่ะ', '人工服务请按1。') };
  if (type === 'transfer') return { id: nid(), type, target: 'hq-pbx ext 200', ring: 30, record: false, prompt: TXT.operator };
  if (type === 'record') return { id: nid(), type, max: 60, finish: '#', prompt: TXT.leave };
  return { id: nid(), type: 'hangup', prompt: TXT.goodbye };
}

export function mount(root, ctx) {
  const { t } = ctx;
  const key = ctx.params.path[0];
  const f = key ? flowBy(ctx, key) : null;
  const fid = f ? f.id : null;
  const d = fid ? docOf(ctx, fid) : null;
  const sel = () => (fid ? ctx.state.sel[fid] || (d.work.nodes[0] && d.work.nodes[0].id) : null);
  const item = () => { const s = sel(); return s ? find(d.work, s) : null; };

  // A deep link to a slug (#/flows/closed) settles on the id.
  if (f && key !== f.id) ctx.later(() => ctx.go(`flows/${f.id}`, { replace: true }), 0);

  ctx.actions(root, {
    'fl.guide': noop, 'fl.card': noop, 'fl.back': noop, 'fl.number': noop, 'fl.panel.voice': noop, 'fl.panel.prompt': noop, 'fl.panel.name': noop,
    'fl.panel.key': noop, 'fl.panel.action': noop, 'fl.panel.target': noop, 'fl.panel.sms': noop,
    'fl.timing': (el) => { ctx.state.sel[fid] = el.dataset.value; ctx.rerender(); const w = root.querySelector('.fl-panel [data-field="wait"]'); if (w) w.focus(); },
    'fl.hours.days': noop, 'fl.hours.from': noop, 'fl.hours.to': noop, 'fl.hours.flow': noop, 'fl.hours.hol': noop,
    'fl.new': () => newFlowModal(ctx),
    'fl.empty.tpl': (el) => newFlowModal(ctx, el.dataset.value),
    'fl.lang': (el) => { if (ctx.state.vlang !== el.dataset.value) { stopSpeech(); ctx.state.playing = null; ctx.setState({ vlang: el.dataset.value }); } },
    'fl.node': (el) => { ctx.state.sel[fid] = el.dataset.value; ctx.rerender(); },
    'fl.node.edit': (el) => {
      ctx.state.sel[fid] = el.dataset.value;
      ctx.rerender();
      const ta = root.querySelector('.fl-panel textarea, .fl-panel input');
      if (ta) { ta.focus({ preventScroll: false }); }
    },
    'fl.node.up': (el) => moveNode(ctx, fid, el.dataset.value, -1),
    'fl.node.down': (el) => moveNode(ctx, fid, el.dataset.value, 1),
    'fl.node.del': (el) => {
      const i = d.work.nodes.findIndex((n) => n.id === el.dataset.value);
      if (i < 0 || d.work.nodes.length <= 1) return;
      const [gone] = d.work.nodes.splice(i, 1);
      touch(ctx, fid, { k: 'nodeRemoved', vars: { typeKey: gone.type } });
      if (ctx.state.sel[fid] === gone.id) ctx.state.sel[fid] = (d.work.nodes[Math.max(0, i - 1)] || {}).id;
      ctx.rerender();
      ctx.ui.toast(t('node.removed', { type: t(`type.${gone.type}`) }), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => { d.work.nodes.splice(i, 0, gone); d.changes = d.changes.filter((c) => !(c.k === 'nodeRemoved' && c.vars.typeKey === gone.type)); if (onFlow(fid)()) ctx.rerender(); } } });
    },
    'fl.addnode': (el) => {
      const n = newNode(el.dataset.value);
      d.work.nodes.push(n);
      ctx.state.sel[fid] = n.id;
      touch(ctx, fid, { k: 'nodeAdded', vars: { typeKey: n.type } });
      ctx.rerender();
      const row = root.querySelector(`[data-action="fl.node"][data-value="${n.id}"]`);
      if (row) { row.focus(); row.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
    },
    'fl.add': (el) => {
      const p = find(d.work, el.dataset.value);
      if (!p || (p.item.options || []).length >= MAX_OPTIONS) return;
      const o = newOption(ctx, p.item);
      p.item.options = [...(p.item.options || []), o];
      ctx.state.sel[fid] = o.id;
      touch(ctx, fid, { k: 'optAdded', vars: { key: o.key } });
      ctx.rerender();
      const nameInput = root.querySelector('.fl-panel [data-field="name"]');
      if (nameInput) { nameInput.focus(); nameInput.select(); }
    },
    'fl.panel.remove': (el) => {
      const r = find(d.work, el.dataset.value);
      if (!r || !r.parent) return;
      const idx = r.index;
      const gone = r.item;
      r.parent.options = r.parent.options.filter((o) => o.id !== gone.id);
      touch(ctx, fid, { k: 'optRemoved', vars: { key: gone.key } });
      if (ctx.state.sel[fid] === gone.id) ctx.state.sel[fid] = r.parent.id;
      ctx.rerender();
      const parentId = r.parent.id;
      ctx.ui.toast(t('opts.removed', { key: gone.key, name: L(ctx, gone.name) }), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => {
        const p2 = find(d.work, parentId);
        if (!p2) return;
        const list = [...(p2.item.options || [])];
        list.splice(idx, 0, gone);
        p2.item.options = list;
        d.changes = d.changes.filter((c) => !(c.k === 'optRemoved' && c.vars.key === gone.key));
        if (onFlow(fid)()) ctx.rerender();
      } } });
    },
    'fl.node.play': (el) => playPath(el.dataset.value),
    'fl.panel.play': () => { const s = sel(); if (s) playPath(s, true); },
    'fl.hours': () => { d.work.hours = { ...d.work.hours, on: !d.work.hours.on }; touch(ctx, fid, { k: 'hours' }); ctx.rerender(); },
    'fl.fix': () => { const dir = particleMismatch(d.work); if (!dir) return; fixParticles(d.work, dir); touch(ctx, fid, { k: 'particles' }); ctx.rerender(); ctx.ui.toast(t('particle.fixed'), { kind: 'success' }); },
    'fl.test': () => {
      // A real test call of this flow in the shared dialer: greeting first, then key presses walk the menu.
      const lang = ctx.state.vlang || getLang();
      const D = ctx.ui.dialer;
      if (D.isOpen()) { const open0 = D.open({}); if (open0 && open0.ctrl && open0.ctrl.inCall()) return; D.close(); }
      const doc = d.work;
      const pr = (o) => (o ? o[lang] || o.en || '' : '');
      const hr = doc.hours;
      if (hr && hr.on && !isOpen(hr, nowMs())) {
        const target = ctx.list('flows').find((x) => x.id === hr.outside);
        const td = target ? docOf(ctx, target.id).work : null;
        const fs = td && td.nodes.find((n) => n.type === 'say');
        D.open({ mode: 'flow', source: `flow:${fid}`, text: fs ? pr(fs.prompt) : pr(TXT.closed), voiceLang: lang });
        return;
      }
      const first = doc.nodes.find((n) => n.type === 'say');
      const gi = doc.nodes.findIndex((n) => n.type === 'gather');
      const text = [first ? pr(first.prompt) : '', gi >= 0 ? pr(doc.nodes[gi].prompt) : ''].filter(Boolean).join(' ');
      const opts = { mode: 'flow', source: `flow:${fid}`, voiceLang: lang };
      if (text) opts.text = text;
      if (gi >= 0) {
        opts.onKey = (k, call) => {
          if (call === DENDED) return;
          const dc = dcall(ctx, fid);
          if (!dc || dc.call !== call) bindDialer(ctx, fid, call);
          pressKey(ctx, fid, k);
        };
      }
      D.open(opts);
    },
    'fl.save': () => {
      if (!draftVersion(f, d)) { ctx.ui.toast(t('saveNone', { v: f.live || 1 }), { kind: 'info' }); return; }
      const v = ensureDraft(ctx, f);
      d.dirty = false;
      ctx.store.update('flows', (list) => list.map((x) => (x.id === fid ? { ...x, versions: (x.versions || []).map((y) => (y.v === v ? { ...y, at: today(), by: ctx.store.get('user.name') } : y)) } : x)));
      audit('flow.draft.saved', { flow: fid, v }, fid);
      ctx.ui.toast(t('toast.T03'), { kind: 'success', sub: t('saved', { name: ctx.loc(f.name), v }) });
    },
    'fl.publish': () => publishModal(ctx, f),
    'fl.ver.row': (el) => previewModal(ctx, f, Number(el.dataset.value)),
    'fl.ver.restore': async (el) => {
      const v = Number(el.dataset.value);
      const ok = await ctx.ui.confirm({ title: t('ver.restoreTitle', { v }), body: t('ver.restoreBody'), confirmLabel: t('ver.restoreYes', { v }), cancelLabel: t('ver.restoreNo') });
      if (!ok) return;
      const snap = d.snapshots[v] || (fid === 'flw_01JB5MAIN1' ? mainMenu(v) : null);
      if (!snap) return;
      d.work = clone(snap);
      d.changes = [{ k: 'restored', vars: { v } }];
      d.dirty = true;
      ctx.state.sel[fid] = null;
      ensureDraft(ctx, f);
      ctx.rerender();
      ctx.ui.toast(t('toast.T26', { v }), { kind: 'success' });
    },
    'fl.delete': async () => {
      const ok = await ctx.ui.confirm({ title: t('del.confirmTitle', { name: ctx.loc(f.name) }), body: t('del.confirmBody'), confirmLabel: t('del.btn'), cancelLabel: t('del.keep'), danger: true });
      if (!ok) return;
      simStop(ctx, { silent: true });
      ctx.store.update('flows', (list) => list.filter((x) => x.id !== fid));
      delete ctx.state.docs[fid];
      audit('flow.deleted', { flow: fid }, fid);
      ctx.ui.toast(t('del.done', { name: ctx.loc(f.name) }), { kind: 'success' });
      ctx.go('flows');
    },
    // call-path preview
    'fl.sim.start': () => { stopPlay(); simStart(ctx, fid); },
    'fl.sim.stop': () => { simStop(ctx); ctx.rerender(); },
    'fl.sim.time': (el) => { ctx.state.sim.when = el.dataset.value; ctx.rerender(); },
    'fl.sim.key': (el) => { if (sim(ctx).flowId === fid) pressKey(ctx, fid, el.dataset.value); },
    'fl.sim.auto': (el) => { stopPlay(); simStart(ctx, fid, el.dataset.value.split(',')); },
  });

  function stopPlay() {
    if (ctx.state.playing) { ctx.state.playing = null; stopSpeech(); }
  }

  function playPath(itemId, single = false) {
    ctx.ui.audio.unlock();
    if (ctx.state.playing === itemId) { stopPlay(); ctx.rerender(); return; }
    if (sim(ctx).flowId === fid && sim(ctx).phase !== 'idle' && sim(ctx).phase !== 'ended') simStop(ctx);
    const chain = single ? [find(d.work, itemId).item] : pathTo(d.work, itemId);
    // From the greeting: the say steps before this one, then each menu prompt and the chosen option.
    const top = d.work.nodes.findIndex((n) => n.id === chain[0].id);
    const before = single ? [] : d.work.nodes.slice(0, Math.max(0, top)).filter((n) => n.type === 'say');
    const items = [...before, ...chain].filter((n) => L(ctx, n.prompt));
    if (!items.length) return;
    ctx.state.playing = itemId;
    ctx.rerender();
    let k = 0;
    const next = () => {
      if (ctx.state.playing !== itemId) return;
      if (k >= items.length) { ctx.state.playing = null; if (onFlow(fid)()) ctx.rerender(); return; }
      const n = items[k++];
      const note = speak(ctx, L(ctx, n.prompt), { edited: n.edited, premium: d.work.voice === 'premium', then: next });
      if (note && k === 1) ctx.ui.toast(note, { kind: 'info' });
    };
    next();
  }

  ctx.inputs(root, {
    number: (v) => { d.work.number = v || null; touch(ctx, fid, { k: 'number', vars: { number: v || '—' } }); ctx.rerender(); },
    voice: (v) => { d.work.voice = v; touch(ctx, fid, { k: 'voice' }); ctx.rerender(); },
    prompt: (v) => {
      const r = item();
      if (!r) return;
      const lang = vlang(ctx);
      r.item.prompt = { ...(r.item.prompt || {}), [lang]: v };
      r.item.edited = true;
      touch(ctx, fid, { k: 'promptEdited', vars: r.item.name ? { name: r.item.name } : { typeKey: kindOf(r.item) } });
      const s1 = root.querySelector(`[data-fl-sum="${r.item.id}"]`);
      if (s1) s1.textContent = summary(ctx, r.item);
      const ch = root.querySelector('[data-fl-unsaved]');
      if (ch) ch.hidden = false;
    },
    name: (v) => {
      const r = item();
      if (!r) return;
      r.item.name = { en: v, th: v, zh: v };
      touch(ctx, fid, { k: 'renamed', vars: { name: v } });
      const s1 = root.querySelector(`[data-fl-name="${r.item.id}"]`);
      if (s1) s1.textContent = v;
      const ch = root.querySelector('[data-fl-unsaved]');
      if (ch) ch.hidden = false;
    },
    sms: (v) => { const r = item(); if (!r) return; r.item.sms = { en: v, th: v, zh: v }; touch(ctx, fid, { k: 'optEdited', vars: { key: r.item.key } }); const s1 = root.querySelector(`[data-fl-sum="${r.item.id}"]`); if (s1) s1.textContent = summary(ctx, r.item); },
    key: (v) => { const r = item(); if (!r) return; const old = r.item.key; r.item.key = v; r.parent.options.sort((a, b) => KEYS.indexOf(a.key) - KEYS.indexOf(b.key)); touch(ctx, fid, { k: 'keyChanged', vars: { from: old, to: v } }); ctx.rerender(); },
    action: (v) => {
      const r = item();
      if (!r) return;
      const o = r.item;
      o.action = v;
      if (v === 'menu' && !o.options) o.options = [];
      if (v === 'transfer' && !o.target) { o.target = 'hq-pbx ext 200'; o.ring = 30; }
      if (v === 'sms' && !o.sms) o.sms = NAMES.track;
      if (v === 'record' && !o.max) o.max = 60;
      touch(ctx, fid, { k: 'optEdited', vars: { key: o.key } });
      ctx.rerender();
    },
    target: (v) => { const r = item(); if (!r) return; r.item.target = v; touch(ctx, fid, { k: 'optEdited', vars: { key: r.item.key || '—' } }); ctx.rerender(); },
    ring: (v) => { const r = item(); if (r) { r.item.ring = Number(v); touch(ctx, fid, { k: 'timing' }); ctx.rerender(); } },
    record: (v) => { const r = item(); if (r) { r.item.record = !!v; touch(ctx, fid, { k: 'timing' }); ctx.rerender(); } },
    max: (v) => { const r = item(); if (r) { r.item.max = Number(v); touch(ctx, fid, { k: 'timing' }); ctx.rerender(); } },
    wait: (v) => { const r = item(); if (r) { r.item.wait = Number(v); touch(ctx, fid, { k: 'timing' }); ctx.rerender(); } },
    noKey: (v) => { const r = item(); if (r) { r.item.noKey = v; touch(ctx, fid, { k: 'timing' }); ctx.rerender(); } },
    wrong: (v) => { const r = item(); if (r) { r.item.wrong = v; touch(ctx, fid, { k: 'timing' }); ctx.rerender(); } },
    hDays: (v) => { d.work.hours = { ...d.work.hours, days: v }; touch(ctx, fid, { k: 'hours' }); ctx.rerender(); },
    hFrom: (v, el, ev) => { if (ev.type === 'change' && v) { d.work.hours = { ...d.work.hours, from: v }; touch(ctx, fid, { k: 'hours' }); ctx.rerender(); } },
    hTo: (v, el, ev) => { if (ev.type === 'change' && v) { d.work.hours = { ...d.work.hours, to: v }; touch(ctx, fid, { k: 'hours' }); ctx.rerender(); } },
    hOutside: (v) => { d.work.hours = { ...d.work.hours, outside: v }; touch(ctx, fid, { k: 'hours' }); ctx.rerender(); },
    hHol: (v) => { d.work.hours = { ...d.work.hours, holidays: !!v }; touch(ctx, fid, { k: 'hours' }); ctx.rerender(); },
  });
  // Text fields re-render after you leave them (helpers and the change list refresh) — deferred so focus lands first.
  ctx.on(root, 'focusout', '[data-field="prompt"], [data-field="name"], [data-field="sms"]', () => setTimeout(() => { if (onFlow(fid)()) ctx.rerender(); }, 0));

  // Keyboard on the call-path preview: digits, * and # press keys while it waits.
  ctx.on(document, 'keydown', (ev) => {
    if (!fid || ev.metaKey || ev.ctrlKey || ev.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target && ev.target.tagName) || '')) return;
    const s = sim(ctx);
    if (s.flowId !== fid || !['waiting', 'speaking', 'recording'].includes(s.phase) || !KEYS.includes(ev.key)) return;
    ev.preventDefault();
    pressKey(ctx, fid, ev.key);
  });

  ctx.watch('flows', 'numbers', 'trunks', 'mode');
  // Leaving the editor stops the preview audio.
  ctx.cleanup(() => { if (!fid || !location.hash.startsWith(`#/flows/${fid}`)) { if (sim(ctx).flowId === fid) simStop(ctx, { silent: true }); if (ctx.state.playing) { ctx.state.playing = null; stopSpeech(); } } });
  if (!key && ctx.params.query.new === '1') ctx.later(() => { ctx.go('flows', { replace: true }); newFlowModal(ctx); }, 30);
}
