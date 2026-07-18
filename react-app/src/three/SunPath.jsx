import React, { useEffect, useRef } from 'react';
import { sunPosition, compassAz, localToUTC } from '../engine/astronomy.js';

// полярная диаграмма пути солнца (азимут/высота)
export default function SunPath({ y, mo, da, tz, lat, lon, curAz, curAlt }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current, W = cv.width, H = cv.height, sx = cv.getContext('2d');
    const cx = W / 2, cy = H / 2, R = W / 2 - 22;
    const proj = (azDeg, altDeg) => { const r = R * (1 - altDeg / 90), a = (azDeg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const dayCurve = (Y, Mo, Da) => { const pts = []; const base = localToUTC(Y, Mo, Da, 0, 0, tz);
      for (let m = 0; m <= 1440; m += 6) { const p = sunPosition(base + m * 60000, lat, lon), alt = p.altitude * 180 / Math.PI;
        pts.push(alt >= 0 ? [compassAz(p.azimuth), alt] : null); } return pts; };
    const curve = (pts, col, w) => { sx.strokeStyle = col; sx.lineWidth = w; sx.beginPath(); let started = false;
      pts.forEach(p => { if (!p) { started = false; return; } const [x, yy] = proj(p[0], p[1]); if (!started) { sx.moveTo(x, yy); started = true; } else sx.lineTo(x, yy); }); sx.stroke(); };

    sx.clearRect(0, 0, W, H);
    sx.fillStyle = '#f0efe9'; sx.beginPath(); sx.roundRect ? sx.roundRect(0, 0, W, H, 10) : sx.rect(0, 0, W, H); sx.fill();
    sx.strokeStyle = '#c9cabf'; sx.fillStyle = '#8a8f84'; sx.font = '13px sans-serif'; sx.textAlign = 'center';
    [0, 30, 60].forEach(el => { const r = R * (1 - el / 90); sx.beginPath(); sx.arc(cx, cy, r, 0, 7); sx.stroke(); if (el > 0) sx.fillText(el + '°', cx + 5, cy - r + 12); });
    sx.strokeStyle = '#e0e0d6';
    for (let a = 0; a < 360; a += 30) { const [x, yy] = proj(a, 0); sx.beginPath(); sx.moveTo(cx, cy); sx.lineTo(x, yy); sx.stroke(); }
    sx.fillStyle = '#3a423b'; sx.font = 'bold 15px sans-serif';
    [['С', 0], ['В', 90], ['Ю', 180], ['З', 270]].forEach(([t, a]) => { const [x, yy] = proj(a, -6); sx.fillText(t, x, yy + 6); });

    curve(dayCurve(y, 5, 21), '#b9c2cc', 2.5);   // лето
    curve(dayCurve(y, 11, 21), '#b9c2cc', 2.5);  // зима
    curve(dayCurve(y, mo - 1, da), '#e08a2b', 4); // выбранная дата

    sx.fillStyle = '#8a8f84'; sx.font = '11px sans-serif';
    for (let hh = 0; hh < 24; hh += 3) { const p = sunPosition(localToUTC(y, mo - 1, da, hh, 0, tz), lat, lon), alt = p.altitude * 180 / Math.PI;
      if (alt > 0) { const [x, yy] = proj(compassAz(p.azimuth), alt); sx.beginPath(); sx.arc(x, yy, 2.5, 0, 7); sx.fill(); sx.fillText(hh + ':00', x + 5, yy - 5); } }
    if (curAlt > 0) { const [x, yy] = proj(curAz, curAlt); sx.fillStyle = '#ffcf3a'; sx.strokeStyle = '#111'; sx.lineWidth = 2; sx.beginPath(); sx.arc(x, yy, 8, 0, 7); sx.fill(); sx.stroke(); }
  }, [y, mo, da, tz, lat, lon, curAz, curAlt]);
  return <canvas ref={ref} width={520} height={520} style={{ width: '100%', borderRadius: 10, display: 'block' }} />;
}
