import React, { useEffect, useRef } from 'react';

// схема зонирования участка (вид сверху): юг — огород, север/края — посадки, центр — газон
export default function ZoneMap({ poly }) {
  const cv = useRef(null);
  useEffect(() => {
    const c = cv.current, W = c.width = c.clientWidth, H = c.height = 300, g = c.getContext('2d');
    const base = (poly && poly.length >= 3) ? poly : [[-12, -12], [12, -12], [12, 12], [-12, 12]];
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    base.forEach(p => { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); });
    const ext = Math.max(mxx - mnx, mxy - mny) / 2 + 3, sc = Math.min(W, H) * 0.82 / (2 * ext), cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
    const w2s = (e, n) => [W / 2 + (e - cx) * sc, H / 2 - (n - cy) * sc];  // север вверх
    g.clearRect(0, 0, W, H); g.fillStyle = '#12161c'; g.fillRect(0, 0, W, H);
    // клип по участку
    g.save(); g.beginPath(); base.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.clip();
    // зоны по долям высоты (север=верх): север 0-35% посадки, центр 35-65% газон, юг 65-100% огород
    const bands = [[mny + (mxy - mny) * 0.65, mxy, 'rgba(232,163,61,.35)', 'ОГОРОД · юг'],
                   [mny + (mxy - mny) * 0.35, mny + (mxy - mny) * 0.65, 'rgba(74,163,120,.30)', 'ГАЗОН · центр'],
                   [mny, mny + (mxy - mny) * 0.35, 'rgba(46,110,64,.45)', 'ПОСАДКИ · север']];
    bands.forEach(([y0, y1, col]) => { const [, sy0] = w2s(0, y0), [, sy1] = w2s(0, y1); g.fillStyle = col; g.fillRect(0, Math.min(sy0, sy1), W, Math.abs(sy0 - sy1)); });
    g.restore();
    // контур участка
    g.strokeStyle = '#f5a623'; g.lineWidth = 2; g.beginPath(); base.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
    // подписи зон
    g.fillStyle = '#e8ece7'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center';
    bands.forEach(([y0, y1, , label]) => { const [, sy] = w2s(0, (y0 + y1) / 2); g.fillText(label, W / 2, sy + 4); });
    g.fillStyle = '#f85149'; g.font = 'bold 13px sans-serif'; g.fillText('С ↑', W / 2, 16);
  }, [poly]);
  return <canvas ref={cv} style={{ width: '100%', height: 300, borderRadius: 10, display: 'block' }} />;
}
