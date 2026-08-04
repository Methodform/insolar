// Роза ветров как строка SVG — для PDF-отчёта (не зависит от того, открывали ли диалог розы).
// Логика построения повторяет компонент WindRose.jsx (сезон «Год»).
import { WIND_DIRS, prevailingDir, SEASON_LABELS } from './wind.js';

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

// компактная роза (для сеток по сезонам/месяцам): один сектор «С» подписан
function miniRose(s, R) {
  const W = 100, cx = 50, cy = 50;
  const pt = (deg, rad) => [cx + Math.sin(deg * Math.PI / 180) * rad, cy - Math.cos(deg * Math.PI / 180) * rad];
  const mf = s.maxFreq || 0.001;
  const rings = [0.5, 1].map(k => `<circle cx="${cx}" cy="${cy}" r="${(R * k).toFixed(1)}" fill="none" stroke="#ccc" stroke-width="0.6" stroke-dasharray="2 2"/>`).join('');
  const petals = s.freq.map((f, i) => {
    const a = i * 45, r = Math.max(2, R * (f / mf));
    const [x1, y1] = pt(a - 21, r), [x2, y2] = pt(a + 21, r);
    return `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${speedColor(s.meanSpd[i])}" fill-opacity="0.85" stroke="#fff" stroke-width="0.4"/>`;
  }).join('');
  const [nx, ny] = pt(0, R + 6);
  const nLbl = `<text x="${nx.toFixed(1)}" y="${(ny + 2).toFixed(1)}" font-size="8" font-weight="700" text-anchor="middle" fill="#d0453b">С</text>`;
  return `<svg viewBox="0 0 ${W} ${W}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:96px;height:auto">${rings}${petals}${nLbl}<circle cx="${cx}" cy="${cy}" r="2" fill="#999"/></svg>`;
}
function tile(s, title, R) {
  const p = prevailingDir(s);
  return `<div style="text-align:center;page-break-inside:avoid">` +
    `<div style="font-size:9pt;font-weight:bold;color:#333">${title}</div>${miniRose(s, R)}` +
    `<div style="font-size:8pt;color:#666;line-height:1.2">${p.dir} · ${Math.round(p.freq * 100)}% · ${s.avgSpd.toFixed(1)} м/с</div></div>`;
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Полный блок розы ветров для отчёта: год + по сезонам + по месяцам.
export function windRoseReport(data) {
  const year = `<div style="max-width:340px;margin:auto">${windRoseSvg(data, 'year')}</div>`;
  const seasons = ['winter', 'spring', 'summer', 'autumn']
    .map(k => tile(data.seasons[k], SEASON_LABELS[k], 36)).join('');
  const seasonGrid = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:4pt">${seasons}</div>`;
  const months = (data.months || []).map((m, i) => tile(m, MONTHS[i], 30)).join('');
  const monthGrid = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:4pt">${months}</div>`;
  // страница 1 — год + сезоны; страница 2 (разрыв) — 12 месяцев
  return `${year}` +
    `<h3 style="font-size:11pt;margin:12pt 0 2pt;color:#222">Роза ветров по сезонам</h3>${seasonGrid}` +
    `<div style="font-size:8.5pt;color:#888;margin-top:6pt">Под каждой розой: господствующее направление · его доля · средняя скорость. Цвет луча — средняя скорость (синий тихо → красный сильно).</div>` +
    `<div style="page-break-before:always"><h3 style="font-size:11pt;margin:0 0 2pt;color:#222">Роза ветров по месяцам</h3>${monthGrid}</div>`;
}
