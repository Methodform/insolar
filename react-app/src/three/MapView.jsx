import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// участок на реальной карте: схема OpenFreeMap (бесплатно, без ключа)
const OFM_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// разбор "широта долгота" по строкам → [lon,lat] для GeoJSON
function parseLonLat(txt) {
  const out = [];
  (txt || '').split(/\n+/).forEach(r => { const n = r.replace(/,/g, ' ').split(/\s+/).map(parseFloat).filter(x => !isNaN(x)); if (n.length >= 2) out.push([n[1], n[0]]); });
  return out;
}

export default function MapView({ polyText, onClose }) {
  const box = useRef(null);
  const map = useRef(null);
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

  const bar = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', background: '#161b18', color: '#e8ece7', borderBottom: '1px solid #2a322c', fontSize: 13 };
  const btn = { background: 'transparent', color: '#e8ece7', border: '1px solid #3a463c', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13 };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: '#0e1116' }}>
      <div style={bar}>
        <b style={{ fontSize: 13 }}>Участок на карте (схема)</b>
        {err && <span style={{ color: '#ff8a80' }}>{err}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ color: '#8b968c' }}>© OpenStreetMap · OpenFreeMap</span>
        <button style={{ ...btn, borderColor: '#4faa78', color: '#4faa78' }} onClick={onClose}>Готово ✕</button>
      </div>
      <div ref={box} style={{ flex: 1 }} />
    </div>
  );
}
