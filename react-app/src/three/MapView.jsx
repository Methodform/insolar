import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// участок на реальной карте: улицы OpenFreeMap (бесплатно, без ключа) + спутник MapTiler (по ключу)
const OFM_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// разбор "широта долгота" по строкам → [lon,lat] для GeoJSON
function parseLonLat(txt) {
  const out = [];
  (txt || '').split(/\n+/).forEach(r => { const n = r.replace(/,/g, ' ').split(/\s+/).map(parseFloat).filter(x => !isNaN(x)); if (n.length >= 2) out.push([n[1], n[0]]); });
  return out;
}

export default function MapView({ polyText, apiKey = '', onKey, onClose }) {
  const box = useRef(null);
  const map = useRef(null);
  const [sat, setSat] = useState(false);
  const key = apiKey;
  const setKey = k => onKey && onKey(k);
  const [err, setErr] = useState('');
  const ring = parseLonLat(polyText);

  useEffect(() => {
    if (ring.length < 3) { setErr('Сначала постройте участок (нужно ≥ 3 точек «широта долгота»).'); return; }
    const coords = ring.concat([ring[0]]);
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    ring.forEach(([x, y]) => { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); });
    const m = new maplibregl.Map({ container: box.current, style: OFM_STYLE, center: [(mnx + mxx) / 2, (mny + mxy) / 2], zoom: 17, attributionControl: true });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl(), 'top-left');
    m.on('load', () => {
      m.addSource('plot', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } } });
      m.addLayer({ id: 'plot-fill', type: 'fill', source: 'plot', paint: { 'fill-color': '#f5a623', 'fill-opacity': 0.25 } });
      m.addLayer({ id: 'plot-line', type: 'line', source: 'plot', paint: { 'line-color': '#f5a623', 'line-width': 3 } });
      m.fitBounds([[mnx, mny], [mxx, mxy]], { padding: 80, duration: 0 });
    });
    return () => { m.remove(); map.current = null; };
  }, []);

  function toggleSat(on) {
    const m = map.current; if (!m || !m.isStyleLoaded()) return;
    if (on) {
      if (!key) { setErr('Введите ключ MapTiler для спутникового слоя.'); return; }
      setErr('');
      try { localStorage.setItem('maptiler_key', key); } catch (e) {}
      if (m.getLayer('sat')) { m.removeLayer('sat'); m.removeSource('sat'); }
      m.addSource('sat', { type: 'raster', tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`], tileSize: 256, attribution: '© MapTiler © OpenStreetMap' });
      m.addLayer({ id: 'sat', type: 'raster', source: 'sat' }, 'plot-fill');
    } else if (m.getLayer('sat')) { m.removeLayer('sat'); m.removeSource('sat'); }
    setSat(on);
  }

  const bar = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', background: '#161b18', color: '#e8ece7', borderBottom: '1px solid #2a322c', fontSize: 13 };
  const btn = { background: 'transparent', color: '#e8ece7', border: '1px solid #3a463c', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13 };
  const onBtn = { ...btn, background: '#2b6a45', borderColor: '#2b6a45' };
  const inp = { background: '#1d251f', color: '#e8ece7', border: '1px solid #3a463c', borderRadius: 6, padding: '6px 8px', width: 220 };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: '#0e1116' }}>
      <div style={bar}>
        <b style={{ fontSize: 13 }}>Участок на карте</b>
        <button style={!sat ? onBtn : btn} onClick={() => toggleSat(false)}>Схема</button>
        <button style={sat ? onBtn : btn} onClick={() => toggleSat(true)}>Спутник</button>
        <input style={inp} type="text" placeholder="Ключ MapTiler (для спутника)" value={key} onChange={e => setKey(e.target.value)} />
        {err && <span style={{ color: '#ff8a80' }}>{err}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ color: '#8b968c' }}>© OpenStreetMap · OpenFreeMap</span>
        <button style={{ ...btn, borderColor: '#4faa78', color: '#4faa78' }} onClick={onClose}>Готово ✕</button>
      </div>
      <div ref={box} style={{ flex: 1 }} />
    </div>
  );
}
