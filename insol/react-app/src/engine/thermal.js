// Тепловая шкала (для легенды инсоляции). Вынесено из Viewport.jsx, чтобы не тянуть весь Viewport в бандл.
const THERMAL = [[0, '#3a1f5c'], [0.18, '#6d2f79'], [0.36, '#a8446f'], [0.54, '#d95f4e'], [0.7, '#f0842f'], [0.84, '#ffb02e'], [0.94, '#ffd84d'], [1, '#fff6c8']];

function lerpHex(a, b, t) {
  const r = x => parseInt(x, 16), h = n => Math.round(n).toString(16).padStart(2, '0');
  const ar = r(a.slice(1, 3)), ag = r(a.slice(3, 5)), ab = r(a.slice(5, 7)), br = r(b.slice(1, 3)), bg = r(b.slice(3, 5)), bb = r(b.slice(5, 7));
  return '#' + h(ar + (br - ar) * t) + h(ag + (bg - ag) * t) + h(ab + (bb - ab) * t);
}

export function thermalColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < THERMAL.length; i++) { if (t <= THERMAL[i][0]) { const a = THERMAL[i - 1], b = THERMAL[i]; return lerpHex(a[1], b[1], (t - a[0]) / ((b[0] - a[0]) || 1)); } }
  return THERMAL[THERMAL.length - 1][1];
}

// Шкала «часы солнца»: непрерывный градиент синий → зелёный → красный.
// t=0 — мало солнца (синий), t=0.5 — средне (зелёный), t=1 — много солнца (красный).
const SUN_STOPS = [[0, '#0000ff'], [0.5, '#00ff00'], [1, '#ff0000']];
export function sunHoursColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < SUN_STOPS.length; i++) { if (t <= SUN_STOPS[i][0]) { const a = SUN_STOPS[i - 1], b = SUN_STOPS[i]; return lerpHex(a[1], b[1], (t - a[0]) / ((b[0] - a[0]) || 1)); } }
  return SUN_STOPS[SUN_STOPS.length - 1][1];
}
