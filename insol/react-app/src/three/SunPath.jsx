import React from 'react';
import { sunPosition, compassAz, getTimes, localToUTC } from '../engine/astronomy.js';

// Небесный купол: горизонт, меридиан, сезонные дуги солнца, стороны света и форма участка.
// Проекция косая: С(север)→лево, Ю→право, В→вверх(глубина), З→вниз, зенит вверх по центру.
export default function SunPath({ lat = 55.75, lon = 37.62, tz = 3, year = 2025, mo = 6, da = 21, curAz = 0, curAlt = -90, poly = null }) {
  const W = 320, H = 250, cx = 160, cy = 158, Rx = 132, Rd = 40, Rz = 128;
  const rad = d => d * Math.PI / 180;
  const proj = (A, h) => { const a = rad(A), hr = rad(h), ch = Math.cos(hr);
    return [cx - Math.cos(a) * ch * Rx, cy - Math.sin(a) * ch * Rd - Math.sin(hr) * Rz]; };
  const path = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');

  // горизонт-эллипс
  const horizon = []; for (let A = 0; A <= 360; A += 6) horizon.push(proj(A, 0));
  // меридиан (С→зенит→Ю) и вертикаль В→зенит→З
  const merid = []; for (let h = 0; h <= 180; h += 4) merid.push(h <= 90 ? proj(0, h) : proj(180, 180 - h));
  const ewArc = []; for (let h = 0; h <= 180; h += 4) ewArc.push(h <= 90 ? proj(90, h) : proj(270, 180 - h));

  // сезонная дуга: [az,alt] по светлому времени дня
  const arc = (mo, day) => {
    const t = getTimes(localToUTC(year, mo, day, 12, 0, tz), lat, lon), pts = [];
    const start = isFinite(t.rise) ? t.rise : localToUTC(year, mo, day, 0, 0, tz);
    const end = isFinite(t.set) ? t.set : start + 86400000;
    for (let ms = start; ms <= end; ms += 8 * 60000) { const p = sunPosition(ms, lat, lon), alt = p.altitude * 180 / Math.PI;
      if (alt > -0.3) pts.push([compassAz(p.azimuth), Math.max(0, alt)]); }
    return pts;
  };
  const seasons = [
    { az: arc(5, 21), label: '22 июня', col: '#e8a33d' },
    { az: arc(2, 20), label: 'равнод.', col: '#d98a2b' },
    { az: arc(11, 21), label: '22 дек.', col: '#c9761c' },
  ].map(s => { let mx = -1, top = null; s.az.forEach(([A, h]) => { if (h > mx) { mx = h; top = [A, h]; } });
    return { ...s, pts: s.az.map(([A, h]) => proj(A, h)), noon: top ? proj(top[0], top[1]) : null }; });
  // траектория текущего дня — по ней движется точка солнца
  const todayArc = arc(mo - 1, da).map(([A, h]) => proj(A, h));

  // стороны света
  const dirs = [['С', 0], ['СВ', 45], ['В', 90], ['ЮВ', 135], ['Ю', 180], ['ЮЗ', 225], ['З', 270], ['СЗ', 315]];

  // участок на земле (косая проекция плоскости): С→лево, В→вверх
  let plotPath = null; const base = (poly && poly.length >= 3) ? poly : null;
  if (base) { let mx = 0; base.forEach(p => mx = Math.max(mx, Math.abs(p[0]), Math.abs(p[1])));
    const s = mx ? 72 / mx : 1;
    // центр участка в центре купола (cx, cy); косая проекция плоскости земли
    const gp = ([e, n]) => [cx - n * s + e * s * 0.4, cy - e * s * 0.5];
    plotPath = path(base.map(gp)) + ' Z'; }

  const cur = curAlt > 0 ? proj(curAz, curAlt) : null;
  const guide = 'var(--gray-a6)', ink = 'var(--gray-11)', mut = 'var(--gray-9)';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* земля/участок */}
      {plotPath && <path d={plotPath} fill="var(--amber-a4)" stroke="var(--amber-8)" strokeWidth="1" />}
      {/* горизонт и направляющие */}
      <path d={path(horizon) + ' Z'} fill="none" stroke={guide} strokeWidth="1.2" />
      <path d={path(merid)} fill="none" stroke={guide} strokeWidth="1.2" />
      <path d={path(ewArc)} fill="none" stroke={guide} strokeWidth="1" strokeDasharray="4 4" />
      {/* сезонные дуги */}
      {seasons.map((s, i) => <path key={i} d={path(s.pts)} fill="none" stroke={s.col} strokeWidth="2.2" strokeLinecap="round" />)}
      {/* траектория текущего дня (по ней идёт точка солнца) */}
      {todayArc.length > 1 && <path d={path(todayArc)} fill="none" stroke="#ffcf33" strokeWidth="1.4" strokeDasharray="3 3" strokeLinecap="round" />}
      {/* диски солнца в полдень + подпись */}
      {seasons.map((s, i) => s.noon && (
        <g key={'n' + i}>
          <circle cx={s.noon[0]} cy={s.noon[1]} r="6" fill={s.col} />
          <text x={s.noon[0] + 9} y={s.noon[1] + 3} fontSize="9" fill={ink}>{s.label}</text>
        </g>
      ))}
      {/* текущее солнце */}
      {cur && <circle cx={cur[0]} cy={cur[1]} r="5" fill="#ffcf33" stroke="#a9781a" strokeWidth="1.5" />}
      {/* стороны света */}
      {dirs.map(([t, A]) => { const [x, y] = proj(A, 0); const main = t.length === 1;
        return <text key={t} x={x} y={y} dx={A > 180 ? -3 : A < 180 && A > 0 ? 3 : 0} dy={A === 0 || A === 180 ? 3 : A < 180 ? -3 : 11}
          fontSize={main ? 11 : 8} fontWeight={main ? 700 : 400} fill={main ? ink : mut} textAnchor="middle">{t}</text>; })}
    </svg>
  );
}
