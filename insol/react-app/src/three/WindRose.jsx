import React, { useEffect, useState } from 'react';
import { fetchWindRose, WIND_DIRS, SEASON_LABELS, prevailingDir } from '../engine/wind.js';

// цвет по средней скорости ветра (м/с): синий (тихо) → янтарный → красный (сильно)
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

const SEASONS = ['winter', 'spring', 'summer', 'autumn', 'year'];

export default function WindRose({ lat, lon }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [season, setSeason] = useState('year');

  useEffect(() => {
    let cancelled = false;
    setData(null); setErr('');
    fetchWindRose(lat, lon)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setErr('Не удалось загрузить климат-данные ветра. Проверьте интернет и попробуйте ещё раз.'); });
    return () => { cancelled = true; };
  }, [lat, lon]);

  if (err) return <div style={{ padding: '18px 0', color: 'var(--red-11, #c0392b)', fontSize: 14 }}>{err}</div>;
  if (!data) return <div style={{ padding: '18px 0', color: 'var(--gray-11)', fontSize: 14 }}>Считаю розу ветров по климат-данным…</div>;

  const s = data.seasons[season];
  const prev = prevailingDir(s);
  const W = 320, H = 260, cx = 160, cy = 128, R = 104;
  const pt = (deg, rad) => [cx + Math.sin(deg * Math.PI / 180) * rad, cy - Math.cos(deg * Math.PI / 180) * rad];
  const fmtPct = f => Math.round(f * 100);

  const petals = s.freq.map((f, i) => {
    const a = i * 45, r = Math.max(3, R * (f / s.maxFreq));
    const [x1, y1] = pt(a - 21, r), [x2, y2] = pt(a + 21, r);
    return `M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
  });
  const rings = [0.5, 1].map(k => R * k);
  const dirLabel = [['С', 0], ['В', 90], ['Ю', 180], ['З', 270]];

  const tabBtn = active => ({
    border: '1px solid var(--gray-a5)', background: active ? 'var(--gray-12)' : 'transparent',
    color: active ? 'var(--gray-1)' : 'var(--gray-11)', borderRadius: 8, padding: '5px 10px',
    font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {SEASONS.map(k => (
          <button key={k} style={tabBtn(season === k)} onClick={() => setSeason(k)}>{SEASON_LABELS[k]}</button>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {rings.map((r, i) => <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke="var(--gray-a5)" strokeWidth="1" strokeDasharray="3 3" />)}
        <line x1={cx} y1={cy - R - 8} x2={cx} y2={cy + R + 8} stroke="var(--gray-a4)" strokeWidth="1" />
        <line x1={cx - R - 8} y1={cy} x2={cx + R + 8} y2={cy} stroke="var(--gray-a4)" strokeWidth="1" />
        {petals.map((d, i) => (
          <path key={i} d={d} fill={speedColor(s.meanSpd[i])} fillOpacity="0.85" stroke="#fff" strokeWidth="0.6">
            <title>{`${WIND_DIRS[i]}: ${fmtPct(s.freq[i])}% времени, ср. ${s.meanSpd[i].toFixed(1)} м/с`}</title>
          </path>
        ))}
        {dirLabel.map(([t, a]) => { const [x, y] = pt(a, R + 16);
          return <text key={t} x={x} y={y + 4} fontSize="13" fontWeight="700" textAnchor="middle"
            fill={t === 'С' ? '#d0453b' : 'var(--gray-11)'}>{t}</text>; })}
        <circle cx={cx} cy={cy} r="3" fill="var(--gray-9)" />
      </svg>

      <div style={{ fontSize: 13, color: 'var(--gray-11)', marginTop: 6, lineHeight: 1.5 }}>
        <div><b>Господствующий ветер:</b> {prev.dir} ({fmtPct(prev.freq)}% времени). Средняя скорость {s.avgSpd.toFixed(1)} м/с, штиль {fmtPct(s.calm)}%.</div>
        <div style={{ color: 'var(--gray-10)', marginTop: 4 }}>
          Длинный луч — откуда чаще дует: прикройте с этой стороны дом и зону отдыха. Короткий — затишье:
          удобно для террасы, беседки, грядок. Цвет — средняя скорость (синий тихо → красный сильно).
        </div>
        <div style={{ color: 'var(--gray-9)', marginTop: 6, fontSize: 11.5 }}>
          Климат-данные Open-Meteo за {data.period}. Модельно: климатическая частота направлений, не прогноз.
        </div>
      </div>
    </div>
  );
}
