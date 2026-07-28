import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';

// участок на реальной карте: схема OpenFreeMap (OSM, бесплатно, без ключа).
// В продакшене OFM_STYLE меняется на свой self-host PMTiles/OpenMapTiles — остальное не трогается.
const OFM_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const M_LAT = 110540;

// "широта долгота" по строкам → [lon,lat] для GeoJSON
function parseLonLat(txt) {
  const out = [];
  (txt || '').split(/\n+/).forEach(r => { const n = r.replace(/,/g, ' ').split(/\s+/).map(parseFloat).filter(x => !isNaN(x)); if (n.length >= 2) out.push([n[1], n[0]]); });
  return out;
}

export default function MapView({ polyText, buildings = [], lat, lon, azDeg = 150, altDeg = 30, onClose }) {
  const box = useRef(null);
  const map = useRef(null);
  const three = useRef({});
  const sunRef = useRef({ az: azDeg, alt: altDeg });
  const [err, setErr] = useState('');
  const ring = parseLonLat(polyText);

  // солнце в реальном времени из приложения
  useEffect(() => { sunRef.current = { az: azDeg, alt: altDeg }; const t = three.current;
    if (t.sun) { updateSun(t.sun); map.current && map.current.triggerRepaint(); } }, [azDeg, altDeg]);

  function updateSun(sun) {
    const R = 200, az = sunRef.current.az * Math.PI / 180, al = Math.max(2, sunRef.current.alt) * Math.PI / 180, ca = Math.cos(al);
    sun.position.set(R * ca * Math.sin(az), R * Math.sin(al), -R * ca * Math.cos(az));
    sun.target.position.set(0, 0, 0);
    sun.intensity = sunRef.current.alt > 0 ? 1.7 : 0;
  }

  useEffect(() => {
    if (ring.length < 3 || !isFinite(lat) || !isFinite(lon)) { setErr('Сначала постройте участок (≥ 3 точек «широта долгота»).'); return; }
    const coords = ring.concat([ring[0]]);
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    ring.forEach(([x, y]) => { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); });

    const m = new maplibregl.Map({ container: box.current, style: OFM_STYLE, center: [lon, lat], zoom: 18, pitch: 55, bearing: -20, attributionControl: true });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl(), 'top-left');

    m.on('load', () => {
      // контур участка (рисует движок карты — всегда синхронно)
      m.addSource('plot', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } } });
      m.addLayer({ id: 'plot-fill', type: 'fill', source: 'plot', paint: { 'fill-color': '#f5a623', 'fill-opacity': 0.18 } });
      m.addLayer({ id: 'plot-line', type: 'line', source: 'plot', paint: { 'line-color': '#f5a623', 'line-width': 3 } });
      m.fitBounds([[mnx, mny], [mxx, mxy]], { padding: 120, pitch: 55, bearing: -20, duration: 0 });
      m.addLayer(customLayer);
    });
    m.on('idle', rebuildNeighbors);
    m.on('error', e => setErr('Карта: ' + (e && e.error && e.error.message || '')));

    // ==== наш 3D как штатный кастомный слой MapLibre ====
    const mc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0);
    const S = mc.meterInMercatorCoordinateUnits();
    const cosLat = Math.cos(lat * Math.PI / 180);

    const customLayer = {
      id: 'plot3d', type: 'custom', renderingMode: '3d',
      onAdd(mp, gl) {
        const scene = new THREE.Scene();
        const camera = new THREE.Camera();
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x55603f, 0.4));
        const sun = new THREE.DirectionalLight(0xfff1d6, 1.7);
        sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
        const sc = sun.shadow.camera; sc.near = 1; sc.far = 900; sc.left = sc.bottom = -180; sc.right = sc.top = 180; sc.updateProjectionMatrix(); sun.shadow.bias = -0.0004;
        scene.add(sun, sun.target); updateSun(sun);

        const objGroup = new THREE.Group(); scene.add(objGroup);          // объекты пользователя
        const neigh = new THREE.Group(); scene.add(neigh);                 // тене-отбрасыватели карты
        const casterMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
        const catcher = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.33 }));
        catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true; scene.add(catcher);

        buildUserObjects(objGroup);

        const renderer = new THREE.WebGLRenderer({ canvas: mp.getCanvas(), context: gl, antialias: true });
        renderer.autoClear = false; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        three.current = { scene, camera, renderer, sun, neigh, casterMat, cosLat };
      },
      render(gl, matrix) {
        const t = three.current; if (!t.renderer) return;
        const rx = new THREE.Matrix4().makeRotationX(Math.PI / 2);
        const l = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z)
          .multiply(new THREE.Matrix4().makeScale(S, -S, S)).multiply(rx);
        t.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l);
        t.renderer.resetState();
        t.renderer.render(t.scene, t.camera);
        m.triggerRepaint();
      }
    };

    // объекты пользователя (в локальных метрах [восток,север]) → 3D
    function buildUserObjects(group) {
      const wall = { house: 0xeae7df, bath: 0xb08b57, gazebo: 0xcfc3a8, default: 0xd8d2c4 };
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x8f5a44, roughness: .8, side: THREE.DoubleSide });
      const foliage = new THREE.MeshStandardMaterial({ color: 0x3f8f4a, roughness: 1 });
      const trunkM = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
      (buildings || []).forEach(b => {
        const pts = b.pts; if (!pts || pts.length < 2) return;
        const kind = b.kind || 'house';
        let cx = 0, cy = 0; pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
        if (kind === 'tree' || kind === 'bush') {
          let rad = 0.7; pts.forEach(p => rad = Math.max(rad, Math.hypot(p[0] - cx, p[1] - cy)));
          const H = b.height || (kind === 'tree' ? 5 : 1.2);
          if (kind === 'tree') { const tr = new THREE.Mesh(new THREE.CylinderGeometry(.12, .18, H * .3, 8), trunkM); tr.position.set(cx, H * .15, -cy); tr.castShadow = true; group.add(tr);
            const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.max(1, rad), H * .85, 12), foliage); cone.position.set(cx, H * .55, -cy); cone.castShadow = true; group.add(cone); }
          else { const s = new THREE.Mesh(new THREE.SphereGeometry(Math.max(.6, rad), 12, 10), foliage); s.scale.y = .7; s.position.set(cx, rad * .6, -cy); s.castShadow = true; group.add(s); }
          return;
        }
        const H = b.height || 3;
        const shape = new THREE.Shape(); pts.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])); shape.closePath();
        const wallMat = new THREE.MeshStandardMaterial({ color: wall[kind] || wall.default, roughness: .85 });
        const walls = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false }), wallMat);
        walls.rotation.x = -Math.PI / 2; walls.castShadow = true; walls.receiveShadow = true; group.add(walls);
        // двускатная крыша для 4-угольного контура
        const rh = b.roofH || (kind === 'house' ? 2 : kind === 'bath' ? 1.4 : 0);
        if (pts.length === 4 && rh > 0) { const roof = gableRoof(pts, H, rh, roofMat); if (roof) group.add(roof); }
      });
    }
    function gableRoof(pts, base, rh, mat) {
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const alongA = (d(pts[0], pts[1]) + d(pts[2], pts[3])) >= (d(pts[1], pts[2]) + d(pts[3], pts[0]));
      let R1, R2, slopes, gables;
      if (alongA) { R1 = mid(pts[1], pts[2]); R2 = mid(pts[3], pts[0]); slopes = [[pts[0], pts[1], R1, R2], [pts[2], pts[3], R2, R1]]; gables = [[pts[1], pts[2], R1], [pts[3], pts[0], R2]]; }
      else { R1 = mid(pts[0], pts[1]); R2 = mid(pts[2], pts[3]); slopes = [[pts[1], pts[2], R2, R1], [pts[3], pts[0], R1, R2]]; gables = [[pts[0], pts[1], R1], [pts[2], pts[3], R2]]; }
      const top = base + rh, pos = [], isR = p => p === R1 || p === R2;
      const V = p => pos.push(p[0], isR(p) ? top : base, -p[1]);
      const tri = (a, b, c) => { V(a); V(b); V(c); };
      slopes.forEach(q => { tri(q[0], q[1], q[2]); tri(q[0], q[2], q[3]); });
      gables.forEach(g => tri(g[0], g[1], g[2]));
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
    }

    // здания карты → невидимые тене-отбрасыватели
    let lastKey = '';
    function rebuildNeighbors() {
      const t = three.current; if (!t.neigh || !m.isStyleLoaded()) return;
      const key = m.getCenter().toArray().map(v => v.toFixed(4)).join() + '@' + m.getZoom().toFixed(1);
      if (key === lastKey) return; lastKey = key;
      const extLayers = m.getStyle().layers.filter(l => l.type === 'fill-extrusion').map(l => l.id);
      if (!extLayers.length) return;
      let feats; try { feats = m.queryRenderedFeatures({ layers: extLayers }); } catch (e) { return; }
      while (t.neigh.children.length) { const c = t.neigh.children.pop(); if (c.geometry) c.geometry.dispose(); }
      feats.forEach(f => {
        const p = f.properties || {}, g = f.geometry; if (!g) return;
        const h = (+p.render_height) || (+p.height) || 12, b0 = (+p.render_min_height) || 0;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null; if (!polys) return;
        polys.forEach(rings => {
          const outer = rings[0]; if (!outer || outer.length < 3) return;
          const shape = new THREE.Shape();
          outer.forEach((c, i) => { const ex = (c[0] - lon) * 111320 * t.cosLat, ny = (c[1] - lat) * M_LAT; i ? shape.lineTo(ex, ny) : shape.moveTo(ex, ny); });
          const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(2, h - b0), bevelEnabled: false });
          const mesh = new THREE.Mesh(geo, t.casterMat); mesh.rotation.x = -Math.PI / 2; mesh.position.y = b0; mesh.castShadow = true; t.neigh.add(mesh);
        });
      });
      m.triggerRepaint();
    }

    return () => { m.remove(); map.current = null; three.current = {}; };
  }, []);

  const bar = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', background: '#161b18', color: '#e8ece7', borderBottom: '1px solid #2a322c', fontSize: 13 };
  const btn = { background: 'transparent', color: '#e8ece7', border: '1px solid #3a463c', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13 };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: '#0e1116' }}>
      <div style={bar}>
        <b style={{ fontSize: 13 }}>Участок на карте · 3D + тени</b>
        {err && <span style={{ color: '#ff8a80' }}>{err}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ color: '#8b968c' }}>© OpenStreetMap · OpenFreeMap</span>
        <button style={{ ...btn, borderColor: '#4faa78', color: '#4faa78' }} onClick={onClose}>Готово ✕</button>
      </div>
      <div ref={box} style={{ flex: 1 }} />
    </div>
  );
}
