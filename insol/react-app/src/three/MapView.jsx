import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import { sunPosition, compassAz, localToUTC } from '../engine/astronomy.js';
import { buildStreamlines, windSpeedField, windColor, COMET_K, updateComet } from '../engine/windviz.js';
import { fetchWindRose, fetchWindNow, prevailingDir } from '../engine/wind.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// подложка: OpenFreeMap (OSM, без ключа). В проде меняется на свой self-host PMTiles одной строкой.
const OFM_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const M_LAT = 110540;
const SUN_DIST = 400;
const SHADOW_R = 700;                     // радиус (м): в нём дома объёмные и с тенями, дальше — плоские

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

export default function MapView({ polyText, buildings = [], onBuildings, lat, lon, tz = 4, fenceH = 0, date, minutes = 720, windDeg = 315, windOn = false, insolOn = false, insolWalls = false, plotMarkers = [], reqH = 2.5, relief = false, embed = false, onClose }) {
  const box = useRef(null);
  const map = useRef(null);
  const t3 = useRef({});
  const live = useRef((buildings || []).map(b => ({ ...b, pts: (b.pts || []).map(p => p.slice()) })));
  const [dstr, setDstr] = useState(date || new Date().toISOString().slice(0, 10));
  const [mins, setMins] = useState(minutes);
  const [windShow, setWindShow] = useState(false);
  const [insolShow, setInsolShow] = useState(false);
  const [windSel, setWindSel] = useState('now');   // 'now' | '0'..'11' (месяц)
  const [monthDegs, setMonthDegs] = useState(null); // [12] градусы «откуда дует»
  const [nowDeg, setNowDeg] = useState(null);
  const [windDbg, setWindDbg] = useState('');
  const [sunAlt, setSunAlt] = useState(30);        // высота солнца, ° — для вуали день/ночь
  const skyVeil = alt => alt >= 8 ? 'transparent'
    : alt >= 0 ? `rgba(255,138,54,${0.16 * (1 - alt / 8)})`
    : `rgba(10,20,46,${(0.32 + 0.32 * Math.min(1, -alt / 8)).toFixed(3)})`;
  const windDegLocal = embed ? windDeg : (windSel === 'now' ? (nowDeg != null ? nowDeg : windDeg) : (monthDegs ? monthDegs[+windSel] : windDeg));
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
    const { az, alt } = sunAngles(); setSunAlt(alt);
    const a = az * Math.PI / 180, al = alt * Math.PI / 180, ca = Math.cos(al);
    const dir = [ca * Math.sin(a), Math.sin(al), -ca * Math.cos(a)];   // единичное направление на солнце
    s.sun.position.set(dir[0] * 200, Math.max(2, dir[1] * 200), dir[2] * 200); s.sun.target.position.set(0, 0, 0);
    // диск солнца в небе (далеко), виден когда над горизонтом
    if (s.sunSphere) { s.sunSphere.position.set(dir[0] * 480, dir[1] * 480, dir[2] * 480); s.sunSphere.visible = alt > -1;
      s.sunSphere.material.color.setHex(alt < 6 ? 0xff9a52 : 0xffe08a); }   // тёплый у горизонта
    // яркость по высоте солнца: день → полно, сумерки → приглушённо, ночь → почти темно
    const dayK = alt >= 8 ? 1 : alt > -6 ? Math.max(0, (alt + 6) / 14) : 0;
    s.sun.intensity = 1.9 * (alt > 0 ? (0.45 + 0.55 * Math.min(1, alt / 8)) : 0);
    s.sun.castShadow = alt > 0;                        // ночью (солнце за горизонтом) — тени нет совсем
    if (s.amb) s.amb.intensity = 0.12 + 0.3 * dayK;
    if (s.hemi) s.hemi.intensity = 0.08 + 0.28 * dayK;
    if (map.current) map.current.triggerRepaint();
  }
  useEffect(() => { if (embed) setWindShow(!!windOn); }, [embed, windOn]);      // холст: ветер/инсоляция от панели
  useEffect(() => { if (embed) setInsolShow(!!insolOn); }, [embed, insolOn]);
  useEffect(() => {                                 // климатические направления: помесячно + «сейчас»
    if (embed || !isFinite(lat) || !isFinite(lon)) return;
    fetchWindRose(lat, lon).then(d => setMonthDegs((d.months || []).map(mm => prevailingDir(mm).index * 45))).catch(() => setMonthDegs(null));
    fetchWindNow(lat, lon).then(n => setNowDeg(n.dirDeg)).catch(() => setNowDeg(null));
  }, [lat, lon]);
  useEffect(() => { if (embed) { if (date) setDstr(date); if (minutes != null) setMins(minutes); } }, [embed, date, minutes]);  // холст: солнце от таймбара панели
  useEffect(() => { applySun(); }, [dstr, mins]);
  useEffect(() => { const s = t3.current; if (s.rebuildWind) s.rebuildWind(windShow, windDegLocal, fenceH); }, [windShow, windDegLocal, fenceH]);
  useEffect(() => { const s = t3.current; if (!s.rebuildInsol) return; const [yy, mmo, dda] = dstr.split('-').map(Number); s.rebuildInsol(insolShow, yy, mmo, dda, plotMarkers, reqH, insolWalls); }, [insolShow, dstr, mins, plotMarkers, reqH, insolWalls]);
  // синхронизация с панелью приложения: новые объекты и высота забора → пересобрать на карте
  useEffect(() => {
    const s = t3.current; if (!s.rebuildObjects) return;
    live.current = (buildings || []).map(b => ({ ...b, pts: (b.pts || []).map(p => p.slice()) }));
    s.rebuildObjects(); if (s.buildGizmo) s.buildGizmo();
    if (s._w && s._w.show) s.rebuildWind(s._w.show, s._w.wDeg, s._w.fh);
    if (s._i && s._i.show) s.rebuildInsol(s._i.show, s._i.y, s._i.mo, s._i.da, s._i.plotMk, s._i.req);
  }, [buildings]);
  useEffect(() => {
    const s = t3.current; if (!s.buildFence) return;
    s.buildFence(fenceH);
    if (s._w && s._w.show) s.rebuildWind(s._w.show, s._w.wDeg, fenceH);
  }, [fenceH]);

  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

  // 3D-рельеф: поднимаем землю карты + строим ловец теней по форме DEM (тени падают на рельеф)
  useEffect(() => {
    const run = () => { const s = t3.current; if (s && s.applyTerrain) s.applyTerrain(relief); };
    const m = map.current;
    if (t3.current && t3.current.applyTerrain) run();
    else if (m) m.once('idle', run);                // ждём готовности 3D-слоя
  }, [relief]);

  useEffect(() => {
    if (ring.length < 3 || !isFinite(lat) || !isFinite(lon)) { setErr('Сначала постройте участок (≥ 3 точек «широта долгота»).'); return; }
    const coords = ring.concat([ring[0]]);
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    ring.forEach(([x, y]) => { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); });

    const m = new maplibregl.Map({ container: box.current, style: OFM_STYLE, center: [lon, lat], zoom: 18.5, pitch: 55, bearing: -20, attributionControl: true });
    map.current = m;

    m.on('load', () => {
      // источник рельефа: бесплатный открытый DEM AWS (terrarium, без ключа) — для 3D-terrain + отмывки.
      try {
        if (!m.getSource('dem')) m.addSource('dem', {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium', tileSize: 256, maxzoom: 15,
          attribution: '© Terrain: AWS Open Data / SRTM',
        });
        const firstSym = (m.getStyle().layers || []).find(l => l.type === 'symbol');
        if (!m.getLayer('hillshade')) m.addLayer({
          id: 'hillshade', type: 'hillshade', source: 'dem',
          layout: { visibility: 'none' },            // включается вместе с 3D-рельефом
          paint: {
            'hillshade-exaggeration': 0.45,
            'hillshade-shadow-color': '#5b5546',
            'hillshade-highlight-color': '#ffffff',
            'hillshade-accent-color': '#6b6350',
          },
        }, firstSym && firstSym.id);                 // под подписями, чтобы лейблы читались
      } catch (e) { /* рельеф не критичен — молча пропускаем */ }

      m.addSource('plot', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } } });
      m.addLayer({ id: 'plot-fill', type: 'fill', source: 'plot', paint: { 'fill-color': '#f5a623', 'fill-opacity': 0.15 } });
      m.addLayer({ id: 'plot-line', type: 'line', source: 'plot', paint: { 'line-color': '#f5a623', 'line-width': 3 } });
      m.fitBounds([[mnx, mny], [mxx, mxy]], { padding: 140, pitch: 55, bearing: -20, duration: 0 });
      m.addLayer(customLayer);
    });
    m.on('idle', rebuildNeighbors);
    m.on('error', e => setErr('Карта: ' + (e && e.error && e.error.message || '')));

    let mc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0);  // let: при 3D-рельефе поднимаем сцену на высоту центра
    const S = mc.meterInMercatorCoordinateUnits();
    const selIdx = { v: -1 };                       // индекс выделенного объекта
    // рельеф = отмывка (hillshade). Геометрический terrain не включаем: DEM ~30 м на масштабе
    // участка — грубые «ступени», тени на них дробятся. Тени рисуем на плоскости (корректно).
    function applyTerrain(on) {
      try {
        m.setTerrain(null);
        if (m.getLayer('hillshade')) m.setLayoutProperty('hillshade', 'visibility', on ? 'visible' : 'none');
      } catch (e) { /* рельеф не критичен */ }
    }

    const customLayer = {
      id: 'plot3d', type: 'custom', renderingMode: '3d',
      onAdd(mp, gl) {
        const scene = new THREE.Scene();
        const camera = new THREE.Camera();
        const amb = new THREE.AmbientLight(0xffffff, 0.4); scene.add(amb);
        const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x55603f, 0.32); scene.add(hemi);
        const sun = new THREE.DirectionalLight(0xfff1d6, 1.7);
        // видимое солнце-диск в небе (свечение), чтобы читалось время суток
        const sunSphere = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 16), new THREE.MeshBasicMaterial({ color: 0xffe08a, toneMapped: false })); sunSphere.frustumCulled = false; scene.add(sunSphere);
        sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
        // узкий кадр тени вокруг участка → высокая плотность текселей (резче), VSM даёт гладкое размытие
        // фиксированный кадр тени: покрывает квадрат 40×40 м вокруг участка + вынос теней от домов в нём
        const sc = sun.shadow.camera; sc.near = 1; sc.far = 500; sc.left = sc.bottom = -80; sc.right = sc.top = 80; sc.updateProjectionMatrix();
        sun.shadow.bias = -0.00006; sun.shadow.normalBias = 0.6;
        sun.shadow.radius = 3; sun.shadow.blurSamples = 16;
        scene.add(sun, sun.target);
        const objGroup = new THREE.Group(); scene.add(objGroup);
        const fenceGroup = new THREE.Group(); scene.add(fenceGroup);
        const neigh = new THREE.Group(); scene.add(neigh);
        const windGroup = new THREE.Group(); scene.add(windGroup);
        const insolGroup = new THREE.Group(); scene.add(insolGroup);
        const casterMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
        const catcher = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.ShadowMaterial({ opacity: 0.5 }));
        catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true; scene.add(catcher);
        const renderer = new THREE.WebGLRenderer({ canvas: mp.getCanvas(), context: gl, antialias: true });
        renderer.autoClear = false; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // мягкие тени без VSM light-bleeding
        t3.current = { scene, camera, renderer, sun, amb, hemi, sunSphere, objGroup, fenceGroup, neigh, windGroup, insolGroup, casterMat, neighborData: [], flatCatcher: catcher, terrainCatcher: null, applyTerrain, rebuildWind, rebuildInsol, rebuildObjects, buildFence, buildGizmo };
        buildFence(fenceH); rebuildObjects(); applySun();
      },
      render(gl, matrix) {
        const s = t3.current; if (!s.renderer) return;
        const l = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z)
          .multiply(new THREE.Matrix4().makeScale(S, -S, S)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        s.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l);
        if (s.comets && s.comets.length) s.comets.forEach(updateComet);   // анимация «комет» ветра
        s.renderer.resetState(); s.renderer.render(s.scene, s.camera); m.triggerRepaint();
      }
    };

    // забор по периметру участка (fh — текущая высота из панели)
    // нейтральный светло-серый как у зданий карты (без тёплого/бежевого оттенка)
    function mapBldColor() { return 0xdadcdc; }

    function buildFence(fh = fenceH) {
      const s = t3.current, g = s.fenceGroup; if (!g) return;
      while (g.children.length) { const c = g.children.pop(); if (c.geometry) c.geometry.dispose(); }
      if (!(fh > 0)) return;
      const mat = new THREE.MeshLambertMaterial({ color: mapBldColor() });   // матовый, без бликов
      const loc = ring.map(([lo, la]) => [(lo - lon) * mLon, (la - lat) * M_LAT]);
      for (let i = 0; i < loc.length; i++) {
        const A = loc[i], B = loc[(i + 1) % loc.length];
        const ax = A[0], az = -A[1], bx = B[0], bz = -B[1], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 0.1) continue;
        const pl = new THREE.Mesh(new THREE.BoxGeometry(len, fh, 0.12), mat);   // объёмная тонкая стенка
        pl.position.set((ax + bx) / 2, fh / 2, (az + bz) / 2); pl.rotation.y = Math.atan2(-dz, dx); pl.castShadow = true; pl.receiveShadow = true; g.add(pl);
      }
    }

    // объекты пользователя (перестраиваются при перетаскивании)
    function rebuildObjects() {
      const s = t3.current, group = s.objGroup; if (!group) return;
      while (group.children.length) { const c = group.children.pop(); if (c.geometry) c.geometry.dispose(); }
      const C = mapBldColor();                        // цвет как у зданий карты
      const roofMat = new THREE.MeshLambertMaterial({ color: C, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const foliage = new THREE.MeshStandardMaterial({ color: 0x3f8f4a, roughness: 1 });
      const trunkM = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
      const plotLoc = ring && ring.length >= 3 ? ring.map(([lo, la]) => [(lo - lon) * mLon, (la - lat) * M_LAT]) : null;
      live.current.forEach((b, bi) => {
        const pts = b.pts; if (!pts || pts.length < 2) return;
        const kind = b.kind || 'house';
        const hl = bi === selIdx.v;                 // подсветка выделенного
        let cx = 0, cy = 0; pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
        const outside = plotLoc ? !pointInPoly([cx, cy], plotLoc) : false;   // вне участка → серый
        if (hl && pts.length >= 3) {                 // жёлтый контур выделения
          const ol = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], 0.12, -p[1]))), new THREE.LineBasicMaterial({ color: 0xffcc00 }));
          ol.renderOrder = 3; group.add(ol);
        }
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
        const walls = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false }), new THREE.MeshLambertMaterial({ color: outside ? 0x9aa0a8 : C, emissive: hl ? 0x2f6bd4 : 0x000000, emissiveIntensity: hl ? 0.4 : 0 }));
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

    // поток ветра (линии тока + зоны затишья/продувания) с учётом забора и соседей
    function rebuildWind(show, wDeg, fh) {
      const s = t3.current; s._w = { show, wDeg, fh }; const g = s.windGroup; if (!g) return;
      while (g.children.length) { const c = g.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
      s.comets = [];                                          // сброс до пересборки (меши уже удалены выше)
      if (!show) { m.triggerRepaint(); return; }
      const baseLocal = ring.map(([lo, la]) => [(lo - lon) * mLon, (la - lat) * M_LAT]);
      let ph = 6; baseLocal.forEach(p => ph = Math.max(ph, Math.hypot(p[0], p[1])));
      const nb = s.neighborData || [];
      // плавные зоны затишья/продувания: поле скорости → сглаженная (билинейная) текстура на земле
      const fld = windSpeedField(wDeg, baseLocal, live.current, fh, nb, 110);
      const N = fld.N, cv = document.createElement('canvas'); cv.width = cv.height = N; const cg = cv.getContext('2d');
      const img = cg.createImageData(N, N);
      const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const e = fld.mne + (i + 0.5) / N * (fld.mxe - fld.mne), n = fld.mnn + (j + 0.5) / N * (fld.mxn - fld.mnn), sp = fld.vals[j * N + i];
        let r = 0, gc = 0, bl = 0, al = 0;
        if (pointInPoly([e, n], baseLocal)) {
          if (sp < 0.6) { r = 30; gc = 110; bl = 240; al = 0.72 * smooth(0.6, 0.32, sp); }         // затишье (насыщенный синий)
          else if (sp > 1.25) { r = 240; gc = 74; bl = 34; al = 0.72 * smooth(1.25, 1.75, sp); }    // продувание (насыщенный оранжевый)
        }
        const o = ((N - 1 - j) * N + i) * 4;
        img.data[o] = r; img.data[o + 1] = gc; img.data[o + 2] = bl; img.data[o + 3] = Math.round(al * 255);
      }
      cg.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      const W = fld.mxe - fld.mne, H = fld.mxn - fld.mnn;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
      plane.rotation.x = -Math.PI / 2; plane.position.set((fld.mne + fld.mxe) / 2, 0.14, -((fld.mnn + fld.mxn) / 2)); plane.renderOrder = 2; g.add(plane);
      // «кометы» как во вьюпорте — движущиеся отрезки линий тока
      const { lines } = buildStreamlines(wDeg, baseLocal, live.current, ph, fh, nb);
      const K = COMET_K; s.comets = [];
      lines.forEach(ln => {
        const n = ln.pos.length / 3; if (n < 3) return;
        for (let ci = 0; ci < 2; ci++) {
          const positions = new Float32Array(K * 2 * 3), colors = new Float32Array(K * 2 * 4);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
          const idx = []; for (let i = 0; i < K - 1; i++) { const A = i * 2, B = i * 2 + 1, C = (i + 1) * 2, D = (i + 1) * 2 + 1; idx.push(A, B, C, B, D, C); }
          geo.setIndex(idx);
          const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
          const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 4; g.add(mesh);
          s.comets.push({ mesh, path: ln.pos, spd: ln.spd, n, phase: (ci * (n / 2) + Math.random() * 4) % (n - 1), speed: 0.9, spacing: 2.75, width: 0.9 });
        }
      });
      s._windDbg = `wDeg=${Math.round(wDeg)} lines=${lines.length} comets=${s.comets.length} pts=${baseLocal.length} ph=${Math.round(ph)}`;
      setWindDbg(s._windDbg);
      m.triggerRepaint();
    }

    // точки инсоляции: на участке (из приложения) + на крышах зданий выше 1 м (расчёт за день)
    function rebuildInsol(show, y, mo, da, plotMk, req, walls) {
      const s = t3.current; s._i = { show, y, mo, da, plotMk, req, walls }; const g = s.insolGroup; if (!g) return;
      while (g.children.length) { const c = g.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
      if (!show) { m.triggerRepaint(); return; }
      const green = new THREE.MeshBasicMaterial({ color: 0x1f9d45, toneMapped: false }), red = new THREE.MeshBasicMaterial({ color: 0xc0392b, toneMapped: false });
      const dot = (x, yy, z, mat) => { const sp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), mat); sp.position.set(x, yy, z); g.add(sp); };
      (plotMk || []).forEach(pm => { if (pm.e === undefined) return; dot(pm.e, 0.4, -pm.n, pm.ok ? green : red); });
      // солнечные направления за выбранный день
      const steps = [], stepMin = 20;
      for (let mm2 = 0; mm2 < 1440; mm2 += stepMin) { const utc = localToUTC(y, mo - 1, da, Math.floor(mm2 / 60), mm2 % 60, tz); const pos = sunPosition(utc, lat, lon); if (pos.altitude <= 0.03) continue; const az = compassAz(pos.azimuth) * Math.PI / 180, ca = Math.cos(pos.altitude); steps.push(new THREE.Vector3(ca * Math.sin(az), Math.sin(pos.altitude), -ca * Math.cos(az))); }
      const occ = []; s.objGroup.traverse(o => { if (o.isMesh) occ.push(o); }); s.neigh.traverse(o => { if (o.isMesh) occ.push(o); }); s.fenceGroup.traverse(o => { if (o.isMesh) occ.push(o); });
      const rc = new THREE.Raycaster();
      // часы солнца на площадке со стеновой нормалью: учитываем только солнце «в лицо» стене и без затенения
      const hoursN = (origin, nrm) => { let lit = 0; steps.forEach(v => { if (v.dot(nrm) <= 0) return; rc.set(origin.clone().addScaledVector(v, 0.3), v); rc.near = 0; rc.far = SUN_DIST; if (!rc.intersectObjects(occ, true).length) lit++; }); return lit * stepMin / 60; };
      if (walls) live.current.forEach(b => { const H = b.height || 3, kind = b.kind || 'house'; if (!(H > 1) || !b.pts || b.pts.length < 3 || kind === 'tree' || kind === 'bush') return;
        const pts = b.pts; let cx = 0, cy = 0; pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
        const hStep = Math.max(1, H / 3);
        for (let i = 0; i < pts.length; i++) {                     // точки по каждой стене-фасаду
          const A = pts[i], B = pts[(i + 1) % pts.length];
          let dx = B[0] - A[0], dy = B[1] - A[1]; const L = Math.hypot(dx, dy); if (L < 0.6) continue; dx /= L; dy /= L;
          let nx = dy, ny = -dx; const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
          if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }   // нормаль наружу
          const nrm = new THREE.Vector3(nx, 0, -ny);
          const nAlong = Math.max(1, Math.floor(L / 2.5));
          for (let a = 0; a < nAlong; a++) {
            const t = (a + 0.5) / nAlong, ex = A[0] + dx * L * t, ny2 = A[1] + dy * L * t;
            for (let hy = hStep * 0.6; hy < H; hy += hStep) {
              const org = new THREE.Vector3(ex + nx * 0.15, hy, -ny2 + (-ny) * 0.15);
              const h = hoursN(org, nrm); dot(org.x, org.y, org.z, h >= req ? green : red);
            }
          }
        }
      });
      m.triggerRepaint();
    }

    // здания карты → невидимые тене-отбрасыватели (+ данные для ветра)
    let lastKey = '';
    function rebuildNeighbors() {
      const s = t3.current; if (!s.neigh || !m.isStyleLoaded()) return;
      const key = m.getCenter().toArray().map(v => v.toFixed(4)).join() + '@' + m.getZoom().toFixed(1);
      if (key === lastKey) return; lastKey = key;
      const extLayers = m.getStyle().layers.filter(l => l.type === 'fill-extrusion').map(l => l.id); if (!extLayers.length) return;
      let feats; try { feats = m.queryRenderedFeatures({ layers: extLayers }); } catch (e) { return; }
      while (s.neigh.children.length) { const c = s.neigh.children.pop(); if (c.geometry) c.geometry.dispose(); }
      const nd = [];
      feats.forEach(f => {
        const p = f.properties || {}, g = f.geometry; if (!g) return;
        const h = (+p.render_height) || (+p.height) || 12, b0 = (+p.render_min_height) || 0;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null; if (!polys) return;
        polys.forEach(rings => {
          const outer = rings[0]; if (!outer || outer.length < 3) return;
          const loc = []; let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
          outer.forEach(c => { const ex = (c[0] - lon) * mLon, ny = (c[1] - lat) * M_LAT; loc.push([ex, ny]); mnx = Math.min(mnx, ex); mxx = Math.max(mxx, ex); mny = Math.min(mny, ny); mxy = Math.max(mxy, ny); });
          nd.push({ pts: loc, height: h });                                   // ветер учитывает всех соседей
          if (mnx > 20 || mxx < -20 || mny > 20 || mxy < -20) return;         // тень — домам, пересекающим квадрат 40×40 м
          const shape = new THREE.Shape(); loc.forEach((c2, i) => i ? shape.lineTo(c2[0], c2[1]) : shape.moveTo(c2[0], c2[1]));
          const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(2, h - b0), bevelEnabled: false });
          const mesh = new THREE.Mesh(geo, s.casterMat); mesh.rotation.x = -Math.PI / 2; mesh.position.y = b0; mesh.castShadow = true; s.neigh.add(mesh);
        });
      });
      s.neighborData = nd;
      if (s._w && s._w.show) rebuildWind(s._w.show, s._w.wDeg, s._w.fh);   // соседи влияют на ветер
      m.triggerRepaint();
    }

    // ===== гизмо как во вьюпорте: кольцо поворота + стрелки перемещения + кубы масштаба =====
    const toLocal = ll => [(ll.lng - lon) * mLon, (ll.lat - lat) * M_LAT];
    const centroidOf = pts => { let x = 0, y = 0; pts.forEach(p => { x += p[0]; y += p[1]; }); return [x / pts.length, y / pts.length]; };
    const radiusOf = (pts, c) => { let r = 1; pts.forEach(p => r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1]))); return r; };
    const rotatePts = (pts, c, a) => { const s = Math.sin(a), co = Math.cos(a); return pts.map(p => { const dx = p[0] - c[0], dy = p[1] - c[1]; return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co]; }); };
    const scaleAxis = (p, c, ax, f) => { const U = (p[0] - c[0]) * ax[0] + (p[1] - c[1]) * ax[1]; const rx = (p[0] - c[0]) - U * ax[0], ry = (p[1] - c[1]) - U * ax[1]; return [c[0] + ax[0] * U * f + rx, c[1] + ax[1] * U * f + ry]; };
    const hitTest = lp => live.current.findIndex(b => b.pts && b.pts.length >= 3 && pointInPoly(lp, b.pts));
    const commit = () => onBuildings && onBuildings(live.current.map(b => ({ ...b, pts: b.pts.map(p => p.slice()) })));

    let giz = null;      // { group, handles:[{mode, pts:[[x,y,z]...]}], c, u, v }
    // локальная точка [x,y,z] → экранные CSS-пиксели (через матрицу камеры карты)
    function toScreen(P) {
      const s = t3.current; if (!s.camera) return null;
      const v = new THREE.Vector4(P[0], P[1], P[2], 1).applyMatrix4(s.camera.projectionMatrix);
      if (v.w <= 0) return null;
      const cv = m.getCanvas();
      return [(v.x / v.w * 0.5 + 0.5) * cv.clientWidth, (1 - (v.y / v.w * 0.5 + 0.5)) * cv.clientHeight];
    }
    function gmat(color) { return new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }); }
    function arrow(dir, len, color) {
      const g = new THREE.Group();
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, len, 10), gmat(color)); sh.position.y = len / 2; sh.renderOrder = 999;
      const tp = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 14), gmat(color)); tp.position.y = len + 0.55; tp.renderOrder = 999;
      g.add(sh, tp); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()); return g;
    }
    function buildGizmo() {
      const s = t3.current; if (giz && giz.group) { giz.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); s.scene.remove(giz.group); } giz = null;
      const i = selIdx.v; if (i < 0) return;
      const b = live.current[i]; if (!b || !b.pts || b.pts.length < 3) return;
      const pts = b.pts, c = centroidOf(pts), ext = radiusOf(pts, c);
      const u = pts.length >= 4 ? (() => { const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; })() : [1, 0];
      const v = [-u[1], u[0]];
      let hu = 1, hv = 1; pts.forEach(p => { hu = Math.max(hu, Math.abs((p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1])); hv = Math.max(hv, Math.abs((p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1])); });
      const group = new THREE.Group(); const Y = 0.4;
      const lp3 = (e2, n2, y = Y) => [e2, y, -n2];               // [восток,север] → локальные 3D
      // кольцо поворота
      const Rr = ext + 1.7;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(Rr, 0.16, 8, 52), gmat(0xffc400)); ring.position.set(c[0], Y, -c[1]); ring.rotation.x = Math.PI / 2; ring.renderOrder = 998; group.add(ring);
      // стрелки перемещения (красная вдоль длины, синяя поперёк)
      const aL = ext + 2;
      const ar1 = arrow(new THREE.Vector3(u[0], 0, -u[1]), aL, 0xff2222); ar1.position.set(c[0], Y, -c[1]); group.add(ar1);
      const ar2 = arrow(new THREE.Vector3(v[0], 0, -v[1]), aL, 0x2b7bff); ar2.position.set(c[0], Y, -c[1]); group.add(ar2);
      // кубы масштаба
      const cube = (col, pos) => { const mm = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), gmat(col)); mm.position.set(pos[0], Y, pos[2]); mm.renderOrder = 999; group.add(mm); };
      const slPos = lp3(c[0] + u[0] * (hu + 1.3), c[1] + u[1] * (hu + 1.3)), swPos = lp3(c[0] + v[0] * (hv + 1.3), c[1] + v[1] * (hv + 1.3));
      cube(0xffffff, slPos); cube(0x00e6d0, swPos);
      // вертикальная ручка высоты (над зданием)
      const topY = (b.height || 3) + (b.roofH || 0) + 1;
      const har = arrow(new THREE.Vector3(0, 1, 0), 2.4, 0x9b6bff); har.position.set(c[0], topY, -c[1]); group.add(har);
      const tyPos = [c[0], topY + 3, -c[1]];
      const tyCube = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), gmat(0x9b6bff)); tyCube.position.set(tyPos[0], tyPos[1], tyPos[2]); tyCube.renderOrder = 999; group.add(tyCube);
      s.scene.add(group);
      // точки для попадания по экрану
      const ringPts = []; for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) ringPts.push(lp3(c[0] + Rr * Math.cos(a), c[1] + Rr * Math.sin(a)));
      giz = { group, c, u, v, handles: [
        { mode: 'ty', pts: [tyPos] },
        { mode: 'sl', pts: [slPos] }, { mode: 'sw', pts: [swPos] },
        { mode: 'tx', pts: [lp3(c[0] + u[0] * aL, c[1] + u[1] * aL)] },
        { mode: 'tz', pts: [lp3(c[0] + v[0] * aL, c[1] + v[1] * aL)] },
        { mode: 'rot', pts: ringPts },
      ] };
    }
    function select(idx) { selIdx.v = idx; rebuildObjects(); buildGizmo(); }

    function pickHandle(px, py) {
      if (!giz) return null; let best = null, bd = 18;
      giz.handles.forEach(h => h.pts.forEach(P => { const s = toScreen(P); if (!s) return; const d = Math.hypot(s[0] - px, s[1] - py); if (d < bd) { bd = d; best = h.mode; } }));
      return best;
    }

    let drag = null;
    const onDown = e => {
      if (drag) return;                                       // уже тащим (страховка от синтетических событий)
      const px = e.point.x, py = e.point.y, lp = toLocal(e.lngLat);
      if (selIdx.v >= 0) { const mode = pickHandle(px, py); if (mode) {
        const b = live.current[selIdx.v]; drag = { idx: selIdx.v, mode, start: lp, orig: b.pts.map(p => p.slice()), c: giz.c, u: giz.u, v: giz.v, startY: py, origH: b.height || 3 };
        m.dragPan.disable(); m.getCanvas().style.cursor = mode === 'ty' ? 'ns-resize' : 'grabbing'; e.preventDefault(); return; } }
      const idx = hitTest(lp);
      if (idx < 0) { if (selIdx.v >= 0) select(-1); return; }
      if (idx !== selIdx.v) select(idx);
      drag = { idx, mode: 'move', start: lp, orig: live.current[idx].pts.map(p => p.slice()) };
      m.dragPan.disable(); m.getCanvas().style.cursor = 'grabbing'; e.preventDefault();
    };
    const onMove = e => {
      if (!drag) { const px = e.point.x, py = e.point.y; m.getCanvas().style.cursor = (selIdx.v >= 0 && pickHandle(px, py)) ? 'grab' : (hitTest(toLocal(e.lngLat)) >= 0 ? 'grab' : ''); return; }
      const lp = toLocal(e.lngLat), o = drag.orig;
      if (drag.mode === 'move') { const dx = lp[0] - drag.start[0], dy = lp[1] - drag.start[1]; live.current[drag.idx].pts = o.map(p => [p[0] + dx, p[1] + dy]); }
      else if (drag.mode === 'tx' || drag.mode === 'tz') { const ax = drag.mode === 'tx' ? drag.u : drag.v; const t = (lp[0] - drag.start[0]) * ax[0] + (lp[1] - drag.start[1]) * ax[1]; live.current[drag.idx].pts = o.map(p => [p[0] + ax[0] * t, p[1] + ax[1] * t]); }
      else if (drag.mode === 'rot') { const a = Math.atan2(lp[1] - drag.c[1], lp[0] - drag.c[0]) - Math.atan2(drag.start[1] - drag.c[1], drag.start[0] - drag.c[0]); live.current[drag.idx].pts = rotatePts(o, drag.c, a); }
      else if (drag.mode === 'sl' || drag.mode === 'sw') { const ax = drag.mode === 'sl' ? drag.u : drag.v;
        const pS = (drag.start[0] - drag.c[0]) * ax[0] + (drag.start[1] - drag.c[1]) * ax[1], pN = (lp[0] - drag.c[0]) * ax[0] + (lp[1] - drag.c[1]) * ax[1];
        const f = Math.max(0.2, Math.min(6, pN / (Math.abs(pS) < 0.5 ? (pS < 0 ? -0.5 : 0.5) : pS))); live.current[drag.idx].pts = o.map(p => scaleAxis(p, drag.c, ax, f)); }
      else if (drag.mode === 'ty') { const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, m.getZoom()); const dh = (drag.startY - e.point.y) * mpp; live.current[drag.idx].height = Math.max(2, Math.round((drag.origH + dh) * 2) / 2); }
      rebuildObjects(); buildGizmo();
    };
    const onUp = () => {
      if (!drag) return;
      if (drag.mode === 'rot') {                              // прилипание поворота к шагу 90°
        const c = drag.c, o = drag.orig, cur = live.current[drag.idx].pts;
        const a = Math.atan2(cur[0][1] - c[1], cur[0][0] - c[0]) - Math.atan2(o[0][1] - c[1], o[0][0] - c[0]);
        const snap = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
        live.current[drag.idx].pts = rotatePts(o, c, snap); rebuildObjects();
      }
      drag = null; m.dragPan.enable(); m.getCanvas().style.cursor = ''; commit(); buildGizmo();
      const s = t3.current;                                   // объекты сдвинулись → пересчёт ветра/инсоляции
      if (s._w && s._w.show) rebuildWind(s._w.show, s._w.wDeg, s._w.fh);
      if (s._i && s._i.show) rebuildInsol(s._i.show, s._i.y, s._i.mo, s._i.da, s._i.plotMk, s._i.req, s._i.walls);
    };
    m.on('mousedown', onDown); m.on('mousemove', onMove); m.on('mouseup', onUp);

    // тач-управление (мобильные): 1 палец — тащим объект/ручку гизмо, 2+ пальцев — жест карты (зум/поворот)
    const multi = e => e.points && e.points.length > 1;
    const onTouchStart = e => { if (multi(e)) return; onDown(e); };
    const onTouchMove = e => { if (!drag || multi(e)) return; onMove(e); };
    m.on('touchstart', onTouchStart); m.on('touchmove', onTouchMove); m.on('touchend', onUp); m.on('touchcancel', onUp);

    // удаление выделенного объекта по Delete/Backspace
    const onKey = e => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      if (selIdx.v < 0) return;
      const idx = selIdx.v; selIdx.v = -1; buildGizmo();
      const arr = live.current.filter((_, k) => k !== idx).map(b => ({ ...b, pts: b.pts.map(p => p.slice()) }));
      onBuildings && onBuildings(arr);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);

    return () => { window.removeEventListener('keydown', onKey); m.remove(); map.current = null; t3.current = {}; };
  }, []);

  const bar = { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', background: '#161b18', color: '#e8ece7', borderBottom: '1px solid #2a322c', fontSize: 13 };
  const btn = { background: 'transparent', color: '#e8ece7', border: '1px solid #3a463c', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13 };
  const inp = { background: '#0e1116', color: '#e8ece7', border: '1px solid #3a463c', borderRadius: 6, padding: '5px 8px', fontSize: 13 };
  const windBtns = (
    <>
      <button style={{ ...btn, ...(windShow ? { borderColor: '#e6663d', color: '#e6663d' } : {}) }} onClick={() => setWindShow(v => !v)}>🌬 Ветер</button>
      {windShow && <select value={windSel} onChange={e => setWindSel(e.target.value)} style={inp} title="Направление ветра">
        <option value="now">Сейчас{nowDeg != null ? '' : ' (загрузка…)'}</option>
        {MONTHS.map((mn, i) => <option key={i} value={String(i)}>{mn}</option>)}
      </select>}
      <button style={{ ...btn, ...(insolShow ? { borderColor: '#4faa78', color: '#4faa78' } : {}) }} onClick={() => setInsolShow(v => !v)}>☀ Инсоляция</button>
      {windShow && <span style={{ color: '#8b968c', fontSize: 12 }}>ветер с {Math.round(windDegLocal)}°{(windSel === 'now' ? nowDeg == null : !monthDegs) ? ' · клим. данные…' : ''}</span>}
      {windShow && windDbg && <span style={{ color: '#ffb02e', fontSize: 11 }}>[{windDbg}]</span>}
    </>
  );
  if (embed) return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: skyVeil(sunAlt), transition: 'background .35s', zIndex: 1 }} />
      {sunAlt <= 0 && <div style={{ position: 'absolute', left: '50%', top: 14, transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 2, color: '#dfe6f2', background: 'rgba(10,20,46,.55)', border: '1px solid #2a3550', borderRadius: 999, padding: '4px 12px', fontSize: 12 }}>🌙 Ночь · солнце ниже горизонта</div>}
      {err && <div style={{ position: 'fixed', top: 60, right: 12, zIndex: 40, padding: '6px 10px', background: 'rgba(22,27,24,.94)', color: '#ff8a80', borderRadius: 10, fontSize: 12 }}>{err}</div>}
    </div>
  );
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: '#0e1116' }}>
      <div style={bar}>
        <b style={{ fontSize: 13 }}>Проект на карте · 3D + тени</b>
        <input type="date" value={dstr} onChange={e => setDstr(e.target.value)} style={inp} />
        <span style={{ minWidth: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{hhmm(mins)}</span>
        <input type="range" min={0} max={1439} step={5} value={mins} onChange={e => setMins(+e.target.value)} style={{ width: 220 }} />
        <button style={{ ...btn, ...(windShow ? { borderColor: '#e6663d', color: '#e6663d' } : {}) }} onClick={() => setWindShow(v => !v)}>🌬 Ветер</button>
        {windShow && <select value={windSel} onChange={e => setWindSel(e.target.value)} style={inp} title="Направление ветра">
          <option value="now">Сейчас{nowDeg != null ? '' : ' (загрузка…)'}</option>
          {MONTHS.map((mn, i) => <option key={i} value={String(i)}>{mn}</option>)}
        </select>}
        <button style={{ ...btn, ...(insolShow ? { borderColor: '#4faa78', color: '#4faa78' } : {}) }} onClick={() => setInsolShow(v => !v)}>☀ Инсоляция</button>
        <span style={{ color: '#8b968c', fontSize: 12 }}>клик — выделить · тащить — двигать · ↻ — повернуть</span>
        {err && <span style={{ color: '#ff8a80' }}>{err}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ color: '#8b968c' }}>© OpenStreetMap · OpenFreeMap</span>
        <button style={{ ...btn, borderColor: '#4faa78', color: '#4faa78' }} onClick={onClose}>Готово ✕</button>
      </div>
      <div ref={box} style={{ flex: 1 }} />
    </div>
  );
}
