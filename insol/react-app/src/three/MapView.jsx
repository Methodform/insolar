import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import { sunPosition, compassAz, localToUTC } from '../engine/astronomy.js';

// подложка: OpenFreeMap (OSM, без ключа). В проде меняется на свой self-host PMTiles одной строкой.
const OFM_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const M_LAT = 110540;

function parseLonLat(txt) {
  const out = [];
  (txt || '').split(/\n+/).forEach(r => { const n = r.replace(/,/g, ' ').split(/\s+/).map(parseFloat).filter(x => !isNaN(x)); if (n.length >= 2) out.push([n[1], n[0]]); });
  return out;
}
function pointInPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

export default function MapView({ polyText, buildings = [], onBuildings, lat, lon, tz = 4, fenceH = 0, date, minutes = 720, onClose }) {
  const box = useRef(null);
  const map = useRef(null);
  const t3 = useRef({});
  const live = useRef((buildings || []).map(b => ({ ...b, pts: (b.pts || []).map(p => p.slice()) })));
  const [dstr, setDstr] = useState(date || new Date().toISOString().slice(0, 10));
  const [mins, setMins] = useState(minutes);
  const [err, setErr] = useState('');
  const ring = parseLonLat(polyText);
  const cosLat = Math.cos((lat || 0) * Math.PI / 180);
  const mLon = 111320 * cosLat;

  // солнце по дате/времени
  function sunAngles() {
    const [y, mo, da] = dstr.split('-').map(Number);
    const utc = localToUTC(y, mo - 1, da, Math.floor(mins / 60), mins % 60, tz);
    const pos = sunPosition(utc, lat, lon);
    return { az: compassAz(pos.azimuth), alt: pos.altitude * 180 / Math.PI };
  }
  function applySun() {
    const s = t3.current; if (!s.sun) return;
    const { az, alt } = sunAngles(); const R = 200, a = az * Math.PI / 180, al = Math.max(1, alt) * Math.PI / 180, ca = Math.cos(al);
    s.sun.position.set(R * ca * Math.sin(a), R * Math.sin(al), -R * ca * Math.cos(a)); s.sun.target.position.set(0, 0, 0);
    s.sun.intensity = alt > 0 ? 1.7 : 0;
    if (map.current) map.current.triggerRepaint();
  }
  useEffect(() => { applySun(); }, [dstr, mins]);

  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

  useEffect(() => {
    if (ring.length < 3 || !isFinite(lat) || !isFinite(lon)) { setErr('Сначала постройте участок (≥ 3 точек «широта долгота»).'); return; }
    const coords = ring.concat([ring[0]]);
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    ring.forEach(([x, y]) => { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); });

    const m = new maplibregl.Map({ container: box.current, style: OFM_STYLE, center: [lon, lat], zoom: 18.5, pitch: 55, bearing: -20, attributionControl: true });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl(), 'top-left');

    m.on('load', () => {
      m.addSource('plot', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } } });
      m.addLayer({ id: 'plot-fill', type: 'fill', source: 'plot', paint: { 'fill-color': '#f5a623', 'fill-opacity': 0.15 } });
      m.addLayer({ id: 'plot-line', type: 'line', source: 'plot', paint: { 'line-color': '#f5a623', 'line-width': 3 } });
      m.fitBounds([[mnx, mny], [mxx, mxy]], { padding: 140, pitch: 55, bearing: -20, duration: 0 });
      m.addLayer(customLayer);
    });
    m.on('idle', rebuildNeighbors);
    m.on('error', e => setErr('Карта: ' + (e && e.error && e.error.message || '')));

    const mc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0);
    const S = mc.meterInMercatorCoordinateUnits();

    const customLayer = {
      id: 'plot3d', type: 'custom', renderingMode: '3d',
      onAdd(mp, gl) {
        const scene = new THREE.Scene();
        const camera = new THREE.Camera();
        scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x55603f, 0.32));
        const sun = new THREE.DirectionalLight(0xfff1d6, 1.7);
        sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
        const sc = sun.shadow.camera; sc.near = 1; sc.far = 900; sc.left = sc.bottom = -180; sc.right = sc.top = 180; sc.updateProjectionMatrix(); sun.shadow.bias = -0.0004;
        scene.add(sun, sun.target);
        const objGroup = new THREE.Group(); scene.add(objGroup);
        const fenceGroup = new THREE.Group(); scene.add(fenceGroup);
        const neigh = new THREE.Group(); scene.add(neigh);
        const casterMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
        const catcher = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.ShadowMaterial({ opacity: 0.5 }));
        catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true; scene.add(catcher);
        const renderer = new THREE.WebGLRenderer({ canvas: mp.getCanvas(), context: gl, antialias: true });
        renderer.autoClear = false; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        t3.current = { scene, camera, renderer, sun, objGroup, fenceGroup, neigh, casterMat };
        buildFence(); rebuildObjects(); applySun();
      },
      render(gl, matrix) {
        const s = t3.current; if (!s.renderer) return;
        const l = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z)
          .multiply(new THREE.Matrix4().makeScale(S, -S, S)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        s.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l);
        s.renderer.resetState(); s.renderer.render(s.scene, s.camera); m.triggerRepaint();
      }
    };

    // забор по периметру участка
    function buildFence() {
      const s = t3.current, g = s.fenceGroup; if (!g) return;
      while (g.children.length) { const c = g.children.pop(); if (c.geometry) c.geometry.dispose(); }
      if (!(fenceH > 0)) return;
      const mat = new THREE.MeshStandardMaterial({ color: 0xcdd1d6, roughness: .85, side: THREE.DoubleSide });
      const loc = ring.map(([lo, la]) => [(lo - lon) * mLon, (la - lat) * M_LAT]);
      for (let i = 0; i < loc.length; i++) {
        const A = loc[i], B = loc[(i + 1) % loc.length];
        const ax = A[0], az = -A[1], bx = B[0], bz = -B[1], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 0.1) continue;
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(len, fenceH), mat);
        pl.position.set((ax + bx) / 2, fenceH / 2, (az + bz) / 2); pl.rotation.y = Math.atan2(-dz, dx); pl.castShadow = true; pl.receiveShadow = true; g.add(pl);
      }
    }

    // объекты пользователя (перестраиваются при перетаскивании)
    function rebuildObjects() {
      const s = t3.current, group = s.objGroup; if (!group) return;
      while (group.children.length) { const c = group.children.pop(); if (c.geometry) c.geometry.dispose(); }
      const wall = { house: 0xeae7df, bath: 0xb08b57, gazebo: 0xcfc3a8, default: 0xd8d2c4 };
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x8f5a44, roughness: .8, side: THREE.DoubleSide });
      const foliage = new THREE.MeshStandardMaterial({ color: 0x3f8f4a, roughness: 1 });
      const trunkM = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
      live.current.forEach(b => {
        const pts = b.pts; if (!pts || pts.length < 2) return;
        const kind = b.kind || 'house';
        let cx = 0, cy = 0; pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
        if (kind === 'tree' || kind === 'bush') {
          let rad = 0.7; pts.forEach(p => rad = Math.max(rad, Math.hypot(p[0] - cx, p[1] - cy)));
          const H = b.height || (kind === 'tree' ? 5 : 1.2);
          if (kind === 'tree') { const tr = new THREE.Mesh(new THREE.CylinderGeometry(.12, .18, H * .3, 8), trunkM); tr.position.set(cx, H * .15, -cy); tr.castShadow = true; group.add(tr);
            const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.max(1, rad), H * .85, 12), foliage); cone.position.set(cx, H * .55, -cy); cone.castShadow = true; group.add(cone); }
          else { const sp = new THREE.Mesh(new THREE.SphereGeometry(Math.max(.6, rad), 12, 10), foliage); sp.scale.y = .7; sp.position.set(cx, rad * .6, -cy); sp.castShadow = true; group.add(sp); }
          return;
        }
        const H = b.height || 3;
        const shape = new THREE.Shape(); pts.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])); shape.closePath();
        const walls = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: wall[kind] || wall.default, roughness: .85 }));
        walls.rotation.x = -Math.PI / 2; walls.castShadow = true; walls.receiveShadow = true; group.add(walls);
        const rh = b.roofH || (kind === 'house' ? 2 : kind === 'bath' ? 1.4 : 0);
        if (pts.length === 4 && rh > 0) { const roof = gableRoof(pts, H, rh, roofMat); if (roof) group.add(roof); }
      });
      if (map.current) map.current.triggerRepaint();
    }
    function gableRoof(pts, base, rh, mat) {
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const alongA = (d(pts[0], pts[1]) + d(pts[2], pts[3])) >= (d(pts[1], pts[2]) + d(pts[3], pts[0]));
      let R1, R2, slopes, gables;
      if (alongA) { R1 = mid(pts[1], pts[2]); R2 = mid(pts[3], pts[0]); slopes = [[pts[0], pts[1], R1, R2], [pts[2], pts[3], R2, R1]]; gables = [[pts[1], pts[2], R1], [pts[3], pts[0], R2]]; }
      else { R1 = mid(pts[0], pts[1]); R2 = mid(pts[2], pts[3]); slopes = [[pts[1], pts[2], R2, R1], [pts[3], pts[0], R1, R2]]; gables = [[pts[0], pts[1], R1], [pts[2], pts[3], R2]]; }
      const top = base + rh, pos = [], isR = p => p === R1 || p === R2;
      const V = p => pos.push(p[0], isR(p) ? top : base, -p[1]);
      const tri = (a, b, c) => { V(a); V(b); V(c); };
      slopes.forEach(q => { tri(q[0], q[1], q[2]); tri(q[0], q[2], q[3]); }); gables.forEach(g => tri(g[0], g[1], g[2]));
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
    }

    // здания карты → невидимые тене-отбрасыватели
    let lastKey = '';
    function rebuildNeighbors() {
      const s = t3.current; if (!s.neigh || !m.isStyleLoaded()) return;
      const key = m.getCenter().toArray().map(v => v.toFixed(4)).join() + '@' + m.getZoom().toFixed(1);
      if (key === lastKey) return; lastKey = key;
      const extLayers = m.getStyle().layers.filter(l => l.type === 'fill-extrusion').map(l => l.id); if (!extLayers.length) return;
      let feats; try { feats = m.queryRenderedFeatures({ layers: extLayers }); } catch (e) { return; }
      while (s.neigh.children.length) { const c = s.neigh.children.pop(); if (c.geometry) c.geometry.dispose(); }
      feats.forEach(f => {
        const p = f.properties || {}, g = f.geometry; if (!g) return;
        const h = (+p.render_height) || (+p.height) || 12, b0 = (+p.render_min_height) || 0;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null; if (!polys) return;
        polys.forEach(rings => {
          const outer = rings[0]; if (!outer || outer.length < 3) return;
          const shape = new THREE.Shape();
          outer.forEach((c, i) => { const ex = (c[0] - lon) * mLon, ny = (c[1] - lat) * M_LAT; i ? shape.lineTo(ex, ny) : shape.moveTo(ex, ny); });
          const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(2, h - b0), bevelEnabled: false });
          const mesh = new THREE.Mesh(geo, s.casterMat); mesh.rotation.x = -Math.PI / 2; mesh.position.y = b0; mesh.castShadow = true; s.neigh.add(mesh);
        });
      });
      m.triggerRepaint();
    }

    // перетаскивание объектов: unproject точки на землю → локальные метры → сдвиг контура
    const toLocal = ll => [(ll.lng - lon) * mLon, (ll.lat - lat) * M_LAT];
    let drag = null;
    const onDown = e => {
      const lp = toLocal(e.lngLat);
      const idx = live.current.findIndex(b => b.pts && b.pts.length >= 3 && pointInPoly(lp, b.pts));
      if (idx < 0) return;
      drag = { idx, start: lp, orig: live.current[idx].pts.map(p => p.slice()) };
      m.dragPan.disable(); m.getCanvas().style.cursor = 'grabbing'; e.preventDefault();
    };
    const onMove = e => {
      if (!drag) { const lp = toLocal(e.lngLat); const over = live.current.some(b => b.pts && b.pts.length >= 3 && pointInPoly(lp, b.pts)); m.getCanvas().style.cursor = over ? 'grab' : ''; return; }
      const lp = toLocal(e.lngLat), dx = lp[0] - drag.start[0], dy = lp[1] - drag.start[1];
      live.current[drag.idx].pts = drag.orig.map(p => [p[0] + dx, p[1] + dy]);
      rebuildObjects();
    };
    const onUp = () => { if (!drag) return; drag = null; m.dragPan.enable(); m.getCanvas().style.cursor = ''; onBuildings && onBuildings(live.current.map(b => ({ ...b, pts: b.pts.map(p => p.slice()) }))); };
    m.on('mousedown', onDown); m.on('mousemove', onMove); m.on('mouseup', onUp);

    return () => { m.remove(); map.current = null; t3.current = {}; };
  }, []);

  const bar = { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', background: '#161b18', color: '#e8ece7', borderBottom: '1px solid #2a322c', fontSize: 13 };
  const btn = { background: 'transparent', color: '#e8ece7', border: '1px solid #3a463c', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13 };
  const inp = { background: '#0e1116', color: '#e8ece7', border: '1px solid #3a463c', borderRadius: 6, padding: '5px 8px', fontSize: 13 };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: '#0e1116' }}>
      <div style={bar}>
        <b style={{ fontSize: 13 }}>Проект на карте · 3D + тени</b>
        <input type="date" value={dstr} onChange={e => setDstr(e.target.value)} style={inp} />
        <span style={{ minWidth: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{hhmm(mins)}</span>
        <input type="range" min={0} max={1439} step={5} value={mins} onChange={e => setMins(+e.target.value)} style={{ width: 220 }} />
        <span style={{ color: '#8b968c', fontSize: 12 }}>тащите дом мышью</span>
        {err && <span style={{ color: '#ff8a80' }}>{err}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ color: '#8b968c' }}>© OpenStreetMap · OpenFreeMap</span>
        <button style={{ ...btn, borderColor: '#4faa78', color: '#4faa78' }} onClick={onClose}>Готово ✕</button>
      </div>
      <div ref={box} style={{ flex: 1 }} />
    </div>
  );
}
