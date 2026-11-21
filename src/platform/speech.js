// Prepoznavanje govora iz pregledača (Chrome na Androidu), sa istim interfejsom kao claude.ai `dictation`.

export function createSpeechDictation(win = window, lang = 'sr-RS') {
  const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!SR) return null;
  const subs = { partial: new Set(), final: new Set(), state: new Set() };
  const emit = (k, v) => subs[k].forEach((fn) => fn(v));
  let rec = null;
  let state = 'idle';
  let reason = null;
  const setState = (s, r) => { state = s; emit('state', s === 'idle' ? { state: s, reason: r } : { state: s }); };
  const on = (k) => (fn) => { subs[k].add(fn); return () => subs[k].delete(fn); };

  return {
    start() {
      if (rec) return Promise.resolve();
      reason = null;
      rec = new SR();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false; // Android ponavlja rezultate u continuous režimu; jedna rečenica po dodiru.
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) emit('final', { text: ' ' + t.trim() });
          else interim += t;
        }
        emit('partial', { text: interim });
      };
      rec.onerror = (e) => {
        reason = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'not_granted'
          : e.error === 'no-speech' || e.error === 'aborted' ? 'stopped'
            : e.error === 'language-not-supported' ? 'unavailable' : 'upstream_error';
      };
      rec.onend = () => { rec = null; emit('partial', { text: '' }); setState('idle', reason ?? 'stopped'); };
      setState('starting');
      try { rec.start(); } catch (e) {
        rec = null; setState('idle', 'upstream_error');
        return Promise.reject({ code: 'upstream_error', message: String(e) });
      }
      setState('listening');
      return Promise.resolve();
    },
    stop() { if (rec) { state = 'finishing'; rec.stop(); } return Promise.resolve(); },
    active() { return state !== 'idle'; },
    onPartial: on('partial'),
    onFinal: on('final'),
    onState: on('state'),
  };
}
