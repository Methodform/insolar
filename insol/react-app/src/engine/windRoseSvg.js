// Роза ветров как строка SVG — для PDF-отчёта (не зависит от того, открывали ли диалог розы).
// Логика построения повторяет компонент WindRose.jsx (сезон «Год»).
import { WIND_DIRS, prevailingDir } from './wind.js';

const SC = [[0, '#4a90d9'], [3, '#6fb98c'], [6, '#f2c14e'], [9, '#e8843d'], [13, '#d0453b']];
function speedColor(v) {
  v = Math.max(0, Math.min(13, v));
  for (let i = 1; i < SC.length; i++) {
    if (v <= SC[i][0]) {
      const a = SC[i - 1], b = SC[i], t = (v - a[0]) / ((b[0] - a[0]) || 1);
      const h = (x, y) => Math.round(x + (y - x) * t);
      const p = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
      const ca = p(a[1]), cb = p(b[1]);
      return `rgb(${h(ca[0], cb[0])},${h(ca[1], cb[1])},${h(ca[2], cb[2])})`;
    }
  }
  return SC[SC.length - 1][1];
}

export function windRoseSvg(data, season = 'year') {
  const s = data.seasons[season];
  const prev = prevailingDir(s);
  const W = 320, H = 260, cx = 160, cy = 128, R = 104;
  const pt = (deg, rad) => [cx + Math.sin(deg * Math.PI / 180) * rad, cy - Math.cos(deg * Math.PI / 180) * rad];
  const pct = f => Math.round(f * 100);

  const rings = [0.5, 1].map(k => `<circle cx="${cx}" cy="${cy}" r="${(R * k).toFixed(1)}" fill="none" stroke="#bbb" stroke-width="1" stroke-dasharray="3 3"/>`).join('');
  const axes = `<line x1="${cx}" y1="${cy - R - 8}" x2="${cx}" y2="${cy + R + 8}" stroke="#ccc"/><line x1="${cx - R - 8}" y1="${cy}" x2="${cx + R + 8}" y2="${cy}" stroke="#ccc"/>`;
  const petals = s.freq.map((f, i) => {
    const a = i * 45, r = Math.max(3, R * (f / s.maxFreq));
    const [x1, y1] = pt(a - 21, r), [x2, y2] = pt(a + 21, r);
    return `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${speedColor(s.meanSpd[i])}" fill-opacity="0.85" stroke="#fff" stroke-width="0.6"/>`;
  }).join('');
  const labels = [['С', 0], ['В', 90], ['Ю', 180], ['З', 270]].map(([t, a]) => {
    const [x, y] = pt(a, R + 16);
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="13" font-weight="700" text-anchor="middle" fill="${t === 'С' ? '#d0453b' : '#555'}">${t}</text>`;
  }).join('');

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:340px;height:auto">${rings}${axes}${petals}${labels}<circle cx="${cx}" cy="${cy}" r="3" fill="#999"/></svg>`;
  const cap = `<div style="font-size:10.5pt;color:#333;margin-top:4pt;line-height:1.4">` +
    `Господствующий ветер: <b>${prev.dir}</b> (${pct(prev.freq)}% времени), средняя скорость ${s.avgSpd.toFixed(1)} м/с, штиль ${pct(s.calm)}%. ` +
    `За год: штиль (&lt;1 м/с) ≈ ${data.seasons.year.calmDays} дн, слабый ветер (&lt;2 м/с) ≈ ${data.seasons.year.lowDays} дн. ` +
    `Климат-данные Open-Meteo за ${data.period}.</div>`;
  return svg + cap;
}
