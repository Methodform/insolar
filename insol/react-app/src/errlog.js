// Перехват ошибок приложения, чтобы виджет отзыва сам «знал», что произошло:
// window.onerror, необработанные промисы и console.error буферизуются.
const buf = [];
const push = e => { buf.push(e); if (buf.length > 25) buf.shift(); };

export function initErrorLog() {
  if (typeof window === 'undefined' || window.__errlog) return;
  window.__errlog = true;
  window.addEventListener('error', ev => push({
    t: Date.now(), kind: 'error',
    message: ev.message || (ev.error && ev.error.message) || 'ошибка',
    source: ev.filename, line: ev.lineno, col: ev.colno,
    stack: ev.error && ev.error.stack ? String(ev.error.stack).slice(0, 1500) : undefined,
  }));
  window.addEventListener('unhandledrejection', ev => {
    const r = ev.reason;
    push({ t: Date.now(), kind: 'promise', message: String((r && r.message) || r).slice(0, 500), stack: r && r.stack ? String(r.stack).slice(0, 1500) : undefined });
  });
  const orig = console.error;
  console.error = (...a) => {
    try { push({ t: Date.now(), kind: 'console', message: a.map(x => (x && x.stack) ? x.stack : String(x)).join(' ').slice(0, 1000) }); } catch (e) {}
    orig.apply(console, a);
  };
}

export function recentErrors() { return buf.slice(-8); }
export function lastError() { return buf.length ? buf[buf.length - 1] : null; }
export function clearErrors() { buf.length = 0; }
