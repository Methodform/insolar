import React, { useEffect, useRef, useState } from 'react';
import { pointInPoly, offsetInward, rectFromDrag, clampToPoly, plotBasis, polyArea } from '../engine/astronomy.js';

// редактор плана (вид сверху): прямоугольник / контур, перетаскивание, подложка
export default function PlanEditor({ poly, fenceH, buildings, onBuildings, onClose }) {
  const cvRef = useRef(null);
  const st = useRef({ pts: [], preview: null, rect: null, drag: null, hover: -1, ul: null, view: null });
  const [mode, setMode] = useState('rect');   // rect | contour
  const [ortho, setOrtho] = useState(true);
  const [height, setHeight] = useState(6);
  const [roofH, setRoofH] = useState(2.5);
  const [ulOpacity, setUlOpacity] = useState(55);
  const [ulW, setUlW] = useState(40);
  const fileRef = useRef(null);

  const base = () => (poly && poly.length >= 3) ? poly : [[-12, -12], [12, -12], [12, 12], [-12, 12]];

  function fit() {
    const cv = cvRef.current, W = cv.width, H = cv.height, b = base();
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    const acc = p => { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); };
    b.forEach(acc); buildings.forEach(bd => bd.pts.forEach(acc));
    const ext = Math.max(mxx - mnx, mxy - mny, 20) / 2 + 6, sc = Math.min(W, H) * 0.86 / (2 * ext);
    st.current.view = { cx: W / 2, cy: H / 2, sc };
  }
  const w2s = (e, n) => { const v = st.current.view; return [v.cx + e * v.sc, v.cy - n * v.sc]; };
  const s2w = (px, py) => { const v = st.current.view, r = cvRef.current.getBoundingClientRect(); return [(px - r.left - v.cx) / v.sc, (v.cy - (py - r.top)) / v.sc]; };

  function constrain(e, n) {
    let pt = [e, n];
    if (mode === 'contour' && ortho && st.current.pts.length >= 2) {
      const [ax, ay] = st.current.pts[st.current.pts.length - 2], [bx, by] = st.current.pts[st.current.pts.length - 1];
      let ux = bx - ax, uy = by - ay; const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
      const vx = -uy, vy = ux, t = (e - bx) * vx + (n - by) * vy; pt = [bx + vx * t, by + vy * t];
    }
    return clampToPoly(pt, base());
  }

  function draw() {
    const cv = cvRef.current; if (!cv) return; const W = cv.width, H = cv.height, g = cv.getContext('2d');
    g.clearRect(0, 0, W, H); g.fillStyle = '#12161c'; g.fillRect(0, 0, W, H);
    const b = base(), s = st.current;
    // подложка
    if (s.ul) { const wm = ulW, hm = wm * s.ul.height / s.ul.width, [cx, cy] = w2s(0, 0), wpx = wm * s.view.sc, hpx = hm * s.view.sc;
      g.save(); g.globalAlpha = ulOpacity / 100; g.drawImage(s.ul, cx - wpx / 2, cy - hpx / 2, wpx, hpx); g.restore(); }
    // сетка
    g.strokeStyle = '#1e252e'; g.lineWidth = 1;
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9; b.forEach(p => { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); });
    for (let e = Math.floor(mnx / 5) * 5 - 5; e <= mxx + 5; e += 5) { const [x] = w2s(e, 0); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let n = Math.floor(mny / 5) * 5 - 5; n <= mxy + 5; n += 5) { const [, y] = w2s(0, n); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.fillStyle = '#f85149'; g.font = 'bold 14px sans-serif'; g.fillText('С ↑', 10, 20);
    // участок + маска снаружи
    g.fillStyle = 'rgba(8,10,14,.6)'; g.beginPath(); g.rect(0, 0, W, H); b.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill('evenodd');
    g.strokeStyle = '#f5a623'; g.lineWidth = 2; g.fillStyle = 'rgba(245,166,35,.1)';
    g.beginPath(); b.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill(); g.stroke();
    // линии отступов 1/3 м
    [[1, '#ff8a80'], [3, '#ff3b30']].forEach(([d, col]) => { const o = offsetInward(b, d); if (!o) return;
      g.strokeStyle = col; g.lineWidth = 1.4; g.setLineDash(d === 1 ? [6, 4] : []); g.beginPath();
      o.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke(); g.setLineDash([]); });
    // здания
    buildings.forEach((bd, idx) => { const active = idx === s.hover;
      g.fillStyle = active ? 'rgba(74,163,255,.35)' : 'rgba(199,205,212,.5)'; g.strokeStyle = active ? '#4aa3ff' : '#9aa4b0'; g.lineWidth = active ? 2 : 1.5;
      g.beginPath(); bd.pts.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill(); g.stroke();
      const cx = bd.pts.reduce((a, p) => a + p[0], 0) / bd.pts.length, cy = bd.pts.reduce((a, p) => a + p[1], 0) / bd.pts.length, [tx, ty] = w2s(cx, cy);
      g.fillStyle = '#111'; g.textAlign = 'center'; g.font = '11px sans-serif'; if (bd.name) g.fillText(bd.name, tx, ty - 5);
      g.font = '10px sans-serif'; g.fillText('S=' + polyArea(bd.pts).toFixed(1) + ' м²', tx, ty + 8); g.textAlign = 'left'; });
    // текущий контур
    if (s.pts.length) { const chain = s.preview ? s.pts.concat([s.preview]) : s.pts;
      g.strokeStyle = '#4aa3ff'; g.lineWidth = 2; g.beginPath(); chain.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
      s.pts.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); g.fillStyle = i === 0 ? '#3fb950' : '#4aa3ff'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }); }
    // превью прямоугольника
    if (s.rect) { const r = rectFromDrag(b, s.rect.start, s.rect.end), c = r.corners;
      g.fillStyle = 'rgba(74,163,255,.22)'; g.strokeStyle = '#4aa3ff'; g.lineWidth = 2; g.beginPath();
      c.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill(); g.stroke();
      const [mx, my] = w2s((c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2); g.fillStyle = '#ffd257'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
      g.fillText(`${r.w.toFixed(1)}×${r.h.toFixed(1)} м · S=${(r.w * r.h).toFixed(1)} м²`, mx, my); g.textAlign = 'left'; }
  }

  useEffect(() => { const cv = cvRef.current; cv.width = cv.clientWidth; cv.height = cv.clientHeight; fit(); draw();
    const onResize = () => { cv.width = cv.clientWidth; cv.height = cv.clientHeight; fit(); draw(); };
    addEventListener('resize', onResize); return () => removeEventListener('resize', onResize); }, []);
  useEffect(() => { fit(); draw(); }, [buildings, poly, fenceH, mode, ortho, ulOpacity, ulW]);

  function buildingAt(e, n) { for (let i = buildings.length - 1; i >= 0; i--) if (pointInPoly(e, n, buildings[i].pts)) return i; return -1; }

  const onDown = ev => { const [e, n] = s2w(ev.clientX, ev.clientY), s = st.current;
    const i = buildingAt(e, n);
    if (s.pts.length === 0 && i >= 0) { s.drag = { i, sx: e, sy: n, orig: buildings[i].pts.map(p => p.slice()) }; return; }
    if (s.pts.length === 0 && mode === 'rect') { s.rect = { start: clampToPoly([e, n], base()), end: clampToPoly([e, n], base()) }; return; } };
  const onMove = ev => { const [e, n] = s2w(ev.clientX, ev.clientY), s = st.current;
    if (s.drag) { const dx = e - s.drag.sx, dy = n - s.drag.sy; const cand = s.drag.orig.map(p => [p[0] + dx, p[1] + dy]);
      onBuildings(buildings.map((b, k) => k === s.drag.i ? { ...b, pts: cand } : b)); s.moved = true; return; }
    if (s.rect) { s.rect.end = clampToPoly([e, n], base()); draw(); return; }
    if (mode === 'contour') { s.preview = constrain(e, n); draw(); return; }
    const h = buildingAt(e, n); if (h !== s.hover) { s.hover = h; draw(); } };
  const onUp = () => { const s = st.current;
    if (s.rect) { const r = rectFromDrag(base(), s.rect.start, s.rect.end); s.rect = null;
      if (r.w > 0.5 && r.h > 0.5) onBuildings([...buildings, { pts: r.corners, height: Math.max(0.5, height), roofH: Math.max(0, roofH), name: 'Прямоугольник' }]);
      draw(); return; }
    if (s.drag) { s.drag = null; setTimeout(() => s.moved = false, 0); } };
  const onClick = ev => { const s = st.current; if (mode !== 'contour') return; if (s.moved) { s.moved = false; return; }
    const [e, n] = s2w(ev.clientX, ev.clientY); s.pts.push(constrain(e, n)); draw(); };
  const onDbl = () => { const s = st.current; if (s.pts.length >= 3) { onBuildings([...buildings, { pts: s.pts.slice(), height: Math.max(0.5, height), roofH: Math.max(0, roofH) }]); s.pts = []; s.preview = null; draw(); } };
  function closeContour() { const s = st.current; if (s.pts.length >= 3) { onBuildings([...buildings, { pts: s.pts.slice(), height: Math.max(0.5, height), roofH: Math.max(0, roofH) }]); s.pts = []; s.preview = null; draw(); } }
  function loadUnderlay(file) { const rd = new FileReader(); rd.onload = () => { const img = new Image(); img.onload = () => { st.current.ul = img; draw(); }; img.src = rd.result; }; rd.readAsDataURL(file); }

  useEffect(() => { const key = e => { const s = st.current;
    if ((e.key === 'r' || e.key === 'R' || e.key === 'к') && s.hover >= 0) {
      const b = buildings[s.hover]; let cx = 0, cy = 0; b.pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= b.pts.length; cy /= b.pts.length;
      const rot = b.pts.map(([x, y]) => { const dx = x - cx, dy = y - cy; return [cx - dy, cy + dx]; });
      onBuildings(buildings.map((bb, k) => k === s.hover ? { ...bb, pts: rot } : bb)); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && s.hover >= 0) { onBuildings(buildings.filter((_, k) => k !== s.hover)); s.hover = -1; }
    if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key); }, [buildings]);

  const bar = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', background: '#161b18', color: '#e8ece7', borderBottom: '1px solid #2a322c', fontSize: 13 };
  const inp = { width: 56, background: '#1d251f', color: '#e8ece7', border: '1px solid #3a463c', borderRadius: 6, padding: '5px 7px' };
  const btn = { background: 'transparent', color: '#e8ece7', border: '1px solid #3a463c', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13 };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: '#0e1116' }}>
      <div style={bar}>
        <b style={{ fontSize: 13 }}>План · вид сверху</b>
        <label><input type="radio" checked={mode === 'rect'} onChange={() => setMode('rect')} /> ▭ прямоугольник</label>
        <label><input type="radio" checked={mode === 'contour'} onChange={() => setMode('contour')} /> контур</label>
        {mode === 'contour' && <label><input type="checkbox" checked={ortho} onChange={e => setOrtho(e.target.checked)} /> углы 90°</label>}
        <span>Высота <input style={inp} type="number" step="0.5" value={height} onChange={e => setHeight(+e.target.value)} /></span>
        <span>Крыша <input style={inp} type="number" step="0.5" value={roofH} onChange={e => setRoofH(+e.target.value)} /></span>
        {mode === 'contour' && <>
          <button style={btn} onClick={() => { st.current.pts.pop(); draw(); }}>↶ Отменить</button>
          <button style={btn} onClick={closeContour}>✓ Замкнуть</button>
          <button style={btn} onClick={() => { st.current.pts = []; st.current.preview = null; draw(); }}>Очистить</button>
        </>}
        <span style={{ opacity: .5 }}>|</span>
        <button style={btn} onClick={() => fileRef.current.click()}>🖼 Подложка</button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) loadUnderlay(e.target.files[0]); e.target.value = ''; }} />
        {st.current.ul && <>
          <span>ширина,м <input style={inp} type="number" value={ulW} onChange={e => setUlW(+e.target.value)} /></span>
          <span>прозр <input type="range" min="10" max="100" value={ulOpacity} onChange={e => setUlOpacity(+e.target.value)} /></span>
        </>}
        <span style={{ flex: 1 }} />
        <span style={{ color: '#8b968c' }}>R — поворот · Del — удалить</span>
        <button style={{ ...btn, borderColor: '#4faa78', color: '#4faa78' }} onClick={onClose}>Готово ✕</button>
      </div>
      <canvas ref={cvRef} style={{ flex: 1, cursor: 'crosshair', display: 'block' }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onClick={onClick} onDoubleClick={onDbl} />
    </div>
  );
}
