// Demo audio — no external services.
//   tones   Web Audio oscillators: Thai ringback 420 Hz 1 s on / 4 s off, busy 420 Hz 0.5/0.5, hang-up beeps, DTMF.
//   tts     speechSynthesis in the UI language (th-TH / en-US / zh-CN). Prefers on-device voices
//           (localService) so typed text does not leave the browser; falls back to the closest voice + a note.
//   words   Word segmentation for captions (Intl.Segmenter — Thai and Chinese have no spaces).
// CONTRACT: call ui.audio.unlock() INSIDE the click handler that starts sound (browsers block audio that
// starts outside a user gesture). Browser speech recognition (microphone) is deliberately not offered:
// it sends audio to the browser vendor's servers, which the public demo must not do.

let ac = null;
let master = null;
let muted = false;
const live = new Set();

export function unlock() {
  try {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  } catch {
    ac = null;
  }
  return ac;
}

function beep(freqs, start, dur, gain = 0.05) {
  if (!ac) return;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.015);
  g.gain.setValueAtTime(gain, start + Math.max(0.02, dur - 0.02));
  g.gain.linearRampToValueAtTime(0, start + dur);
  g.connect(master);
  for (const f of freqs) {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(g);
    o.start(start);
    o.stop(start + dur + 0.02);
    live.add(o);
    o.onended = () => live.delete(o);
  }
}

function stopAll() {
  for (const o of live) { try { o.stop(); } catch { /* already stopped */ } }
  live.clear();
}

const DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477], '*': [941, 1209], 0: [941, 1336], '#': [941, 1477] };

export const tones = {
  /** Thai ringback: 420 Hz, 1 s on, 4 s off (Asterisk indications [th]). Returns stop(). */
  ringback(cycles = 12) {
    if (!unlock()) return () => {};
    const t0 = ac.currentTime + 0.05;
    for (let i = 0; i < cycles; i++) beep([420], t0 + i * 5, 1.0, 0.06);
    return stopAll;
  },
  /** Busy: 420 Hz, 500 ms on / 500 ms off. */
  busy(n = 3) {
    if (!unlock()) return () => {};
    const t0 = ac.currentTime + 0.05;
    for (let i = 0; i < n; i++) beep([420], t0 + i, 0.5, 0.06);
    return stopAll;
  },
  /** Three short 400 Hz beeps when a call ends. */
  hangup() {
    if (!unlock()) return;
    const t0 = ac.currentTime + 0.05;
    for (let i = 0; i < 3; i++) beep([400], t0 + i * 0.22, 0.12, 0.05);
  },
  dtmf(key) {
    if (!unlock() || !DTMF[key]) return;
    beep(DTMF[key], ac.currentTime + 0.01, 0.12, 0.05);
  },
  stop: stopAll,
};

export function setMuted(v) {
  muted = !!v;
  if (master) master.gain.value = muted ? 0 : 1;
  if (muted && 'speechSynthesis' in window) { /* volume is applied per utterance */ }
}
export const isMuted = () => muted;

// ---------- words (captions) ----------
/** Split text into display words. Returns [{ text, start, end }] where text includes trailing spaces/punctuation. */
export function words(text, lang = 'en') {
  const s = String(text || '');
  const out = [];
  if (window.Intl && Intl.Segmenter) {
    const seg = new Intl.Segmenter(lang, { granularity: 'word' });
    for (const p of seg.segment(s)) {
      if (p.isWordLike || !out.length) out.push({ text: p.segment, start: p.index, end: p.index + p.segment.length });
      else { const last = out[out.length - 1]; last.text += p.segment; last.end = p.index + p.segment.length; }
    }
  } else {
    let i = 0;
    for (const w of s.split(/(\s+)/)) {
      if (!w) continue;
      if (/^\s+$/.test(w) && out.length) { out[out.length - 1].text += w; out[out.length - 1].end += w.length; }
      else out.push({ text: w, start: i, end: i + w.length });
      i += w.length;
    }
  }
  return out;
}

// ---------- text to speech ----------
let voicesReady = null;
function loadVoices() {
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve([]); return; }
    const have = speechSynthesis.getVoices();
    if (have.length) { resolve(have); return; }
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 900);
  });
  return voicesReady;
}

const norm = (l) => (l || '').toLowerCase().replace('_', '-');

export const tts = {
  supported: () => 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function',
  ready: loadVoices,
  /**
   * Pick a voice for a BCP-47 tag. Prefers on-device voices (localService) so typed text never leaves
   * the browser. Returns { voice, match: 'exact'|'fallback'|'none', local }.
   * Premium picks a different voice when one exists (plus rate 0.95 / pitch 1.05 in speak()).
   */
  pick(tag, { premium = false } = {}) {
    const all = this.supported() ? speechSynthesis.getVoices() : [];
    const base = tag.slice(0, 2).toLowerCase();
    const same = all.filter((v) => norm(v.lang).startsWith(base));
    const rank = (v) => (v.localService ? 0 : 2) + (norm(v.lang) === tag.toLowerCase() ? 0 : 1);
    same.sort((a, b) => rank(a) - rank(b));
    if (same.length) {
      const v = premium && same.length > 1 ? same[1] : same[0];
      return { voice: v, match: 'exact', local: !!v.localService };
    }
    const fallback = all.find((v) => v.default) || all[0] || null;
    return { voice: fallback, match: fallback ? 'fallback' : 'none', local: fallback ? !!fallback.localService : true };
  },
  /** Rough speaking time when the browser gives no events (headless, no voices). */
  estimateMs(text, lang = 'en', rate = 1) {
    const n = words(text, lang).length;
    return Math.max(900, (n * (lang.startsWith('zh') ? 330 : lang.startsWith('th') ? 360 : 380)) / rate);
  },
  /**
   * Speak a sequence of parts: [{ text, rate? }] (a plain string also works). Codes are passed as their own
   * parts with rate 0.8. opts: { lang, premium, onWord(index), voice }.
   * Returns { done: Promise, stop(), words } — `done` always resolves (watchdog), even without speech.
   */
  speak(input, { lang = 'en-US', premium = false, onWord, voice } = {}) {
    const list = (Array.isArray(input) ? input : [{ text: String(input) }]).map((p) => (typeof p === 'string' ? { text: p } : p)).filter((p) => p.text);
    const allWords = [];
    const offsets = [];
    for (const p of list) { offsets.push(allWords.length); allWords.push(...words(p.text + ' ', lang)); }
    let stopped = false;
    let finished = false;
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    let fallbackTimer = null;
    let watchdog = null;
    let usedBoundary = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(fallbackTimer);
      clearTimeout(watchdog);
      if (onWord && allWords.length) onWord(allWords.length - 1, true);
      resolveDone();
    };
    const rateMul = premium ? 0.95 : 1;
    const total = list.reduce((s, p) => s + this.estimateMs(p.text, lang, (p.rate || 1) * rateMul), 0);
    // Caption timer: also the fallback when the voice fires no boundary events.
    let wi = -1;
    const per = total / Math.max(1, allWords.length);
    fallbackTimer = setInterval(() => {
      if (usedBoundary) return;
      wi = Math.min(allWords.length - 1, wi + 1);
      if (onWord) onWord(wi, false);
    }, per);
    let extra = 0;
    const guard = () => {
      if (stopped || finished) return;
      if (this.supported() && speechSynthesis.speaking && extra < 20000) { extra += 1000; watchdog = setTimeout(guard, 1000); return; }
      finish();
    };
    watchdog = setTimeout(guard, total + 2500);
    const t0 = Date.now();
    // An utterance that "ends" far too early (no voice installed, headless, blocked audio) must not cut the
    // call short: the captions keep their timer and the call ends at the estimated speaking time.
    const endSoon = () => {
      if (stopped) return;
      const left = total - (Date.now() - t0);
      if (!usedBoundary && left > total * 0.5) setTimeout(() => { if (!stopped) finish(); }, left);
      else finish();
    };
    const noVoices = this.supported() && !speechSynthesis.getVoices().length && !voice;
    if (!this.supported() || noVoices) {
      setTimeout(() => { if (!stopped) finish(); }, total);
    } else {
      try {
        speechSynthesis.cancel();
        const picked = voice ? { voice } : this.pick(lang, { premium });
        list.forEach((p, pi) => {
          // Chrome stalls on long utterances: split each part into chunks of ≤ 200 characters.
          const chunks = [];
          let buf = '';
          for (const sentence of String(p.text).split(/(?<=[.!?。！？])\s*/)) {
            if ((buf + sentence).length > 200 && buf) { chunks.push(buf); buf = sentence; } else buf += (buf ? ' ' : '') + sentence;
          }
          if (buf) chunks.push(buf);
          let charBase = 0;
          chunks.forEach((c, ci) => {
            const u = new SpeechSynthesisUtterance(c);
            u.lang = lang;
            if (picked.voice) u.voice = picked.voice;
            u.rate = (p.rate || 1) * rateMul;
            u.pitch = premium ? 1.05 : 1;
            u.volume = muted ? 0 : 1;
            const base = charBase;
            const partWords = words(p.text + ' ', lang);
            u.onboundary = (e) => {
              if (e.name && e.name !== 'word') return;
              usedBoundary = true;
              const abs = base + (e.charIndex || 0);
              let idx = partWords.findIndex((w) => abs >= w.start && abs < w.end);
              if (idx < 0) idx = 0;
              if (onWord) onWord(offsets[pi] + idx, false);
            };
            if (pi === list.length - 1 && ci === chunks.length - 1) {
              u.onend = endSoon;
              u.onerror = endSoon;
            }
            speechSynthesis.speak(u);
            charBase += c.length + 1;
          });
        });
      } catch { /* timer captions keep running */ }
    }
    return {
      done,
      words: allWords,
      stop() {
        stopped = true;
        clearInterval(fallbackTimer);
        clearTimeout(watchdog);
        try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch { /* ignore */ }
        resolveDone();
      },
    };
  },
  stop() {
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch { /* ignore */ }
  },
};
