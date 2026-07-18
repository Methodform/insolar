import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { sunPosition, compassAz, RAD, offsetInward, pointInPoly, nearestOnSeg, getTimes, localToUTC } from '../engine/astronomy.js';

const SUN_DIST = 400;
// нормативный отступ от границы участка (дом ≥3 м, прочее ≥1 м)
const setbackFor = name => /дом/i.test(name || '') ? 3 : 1;
function fitsPlot(pts, poly, setback) {
  const base = (poly && poly.length >= 3) ? poly : [[-12, -12], [12, -12], [12, 12], [-12, 12]];
  const allow = offsetInward(base, setback) || base;
  return pts.every(p => pointInPoly(p[0], p[1], allow));
}

function ridgeAlongA(pts, flip) {
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const A = (d(pts[0], pts[1]) + d(pts[2], pts[3])) / 2, B = (d(pts[1], pts[2]) + d(pts[3], pts[0])) / 2;
  const useA = A >= B; return flip ? !useA : useA;
}
function gableRoofMesh(pts, base, rh, mat, flip) {
  if (pts.length !== 4) return null;
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let slopes, gables, R1, R2;
  if (ridgeAlongA(pts, flip)) {
    R1 = mid(pts[1], pts[2]); R2 = mid(pts[3], pts[0]);
    slopes = [[pts[0], pts[1], R1, R2], [pts[2], pts[3], R2, R1]]; gables = [[pts[1], pts[2], R1], [pts[3], pts[0], R2]];
  } else {
    R1 = mid(pts[0], pts[1]); R2 = mid(pts[2], pts[3]);
    slopes = [[pts[1], pts[2], R2, R1], [pts[3], pts[0], R1, R2]]; gables = [[pts[0], pts[1], R1], [pts[2], pts[3], R2]];
  }
  const top = base + rh, pos = [], isR = p => (p === R1 || p === R2);
  const V = p => pos.push(p[0], isR(p) ? top : base, -p[1]);
  const tri = (a, b, c) => { V(a); V(b); V(c); };
  slopes.forEach(q => { tri(q[0], q[1], q[2]); tri(q[0], q[2], q[3]); });
  gables.forEach(g => tri(g[0], g[1], g[2]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m;
}
const rotPt = (p, c, a) => { const s = Math.sin(a), co = Math.cos(a), dx = p[0] - c[0], dy = p[1] - c[1]; return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co]; };
const scaleAxis = (p, c, ax, f) => { const U = (p[0] - c[0]) * ax[0] + (p[1] - c[1]) * ax[1]; const px = (p[0] - c[0]) - U * ax[0], py = (p[1] - c[1]) - U * ax[1]; return [c[0] + ax[0] * U * f + px, c[1] + ax[1] * U * f + py]; };

// --- 3D-аналитика поверхностей («тепловизор») ---
const sunVec = (azDeg, altDeg) => { const a = azDeg * RAD, al = altDeg * RAD, ca = Math.cos(al); return new THREE.Vector3(Math.sin(a) * ca, Math.sin(al), -Math.cos(a) * ca); };
const THERMAL = [[0, '#3a1f5c'], [0.18, '#6d2f79'], [0.36, '#a8446f'], [0.54, '#d95f4e'], [0.7, '#f0842f'], [0.84, '#ffb02e'], [0.94, '#ffd84d'], [1, '#fff6c8']];
function lerpHex(a, b, t) { const r = x => parseInt(x, 16), h = n => Math.round(n).toString(16).padStart(2, '0');
  const ar = r(a.slice(1, 3)), ag = r(a.slice(3, 5)), ab = r(a.slice(5, 7)), br = r(b.slice(1, 3)), bg = r(b.slice(3, 5)), bb = r(b.slice(5, 7));
  return '#' + h(ar + (br - ar) * t) + h(ag + (bg - ag) * t) + h(ab + (bb - ab) * t); }
export function thermalColor(t) { t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < THERMAL.length; i++) { if (t <= THERMAL[i][0]) { const a = THERMAL[i - 1], b = THERMAL[i]; return lerpHex(a[1], b[1], (t - a[0]) / ((b[0] - a[0]) || 1)); } }
  return THERMAL[THERMAL.length - 1][1]; }
function gridSurface(ni, nj, nodeFn, cellOk) { const nodes = [], idx = (i, j) => i * (nj + 1) + j;
  for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) nodes.push(nodeFn(i, j));
  const cells = []; for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) { if (cellOk && !cellOk(i, j)) continue; cells.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)]); }
  return { nodes, cells }; }
function signedDistPoly(x, y, poly) { let dmin = 1e9;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const q = nearestOnSeg([x, y], poly[j], poly[i]); const d = Math.hypot(q[0] - x, q[1] - y); if (d < dmin) dmin = d; }
  return pointInPoly(x, y, poly) ? dmin : -dmin; }
function roofSlopes3D(pts, base, rh, flip) { if (pts.length !== 4) return [];
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; let R1, R2, quads;
  if (ridgeAlongA(pts, flip)) { R1 = mid(pts[1], pts[2]); R2 = mid(pts[3], pts[0]); quads = [[pts[0], pts[1], R1, R2], [pts[2], pts[3], R2, R1]]; }
  else { R1 = mid(pts[0], pts[1]); R2 = mid(pts[2], pts[3]); quads = [[pts[1], pts[2], R2, R1], [pts[3], pts[0], R1, R2]]; }
  const isR = p => (p === R1 || p === R2);
  return quads.map(q => { const c = q.map(p => new THREE.Vector3(p[0], isR(p) ? base + rh : base, -p[1]));
    const n = new THREE.Vector3().subVectors(c[1], c[0]).cross(new THREE.Vector3().subVectors(c[2], c[0])).normalize(); if (n.y < 0) n.negate();
    return { corners: c, normal: n }; }); }

export default function Viewport({ utcMs, lat, lon, poly, fenceH, buildings, onBuildings,
  analytics = false, anM1 = 1, anM2 = 12, anDiff = false, year, onAnalyticsStats }) {
  const mount = useRef(null);
  const api = useRef({});
  const bRef = useRef(buildings); bRef.current = buildings;
  const onRef = useRef(onBuildings); onRef.current = onBuildings;
  const polyRef = useRef(poly); polyRef.current = poly;

  useEffect(() => {
    const el = mount.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fc0e8);
    scene.fog = new THREE.Fog(0x9fc0e8, 300, 800);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);

    const ambient = new THREE.AmbientLight(0xffffff, 0.3); scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a5a3a, 0.5); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.near = 1; sc.far = SUN_DIST * 2 + 200; sc.left = sc.bottom = -90; sc.right = sc.top = 90;
    sun.shadow.bias = -0.0001; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    scene.add(sun, sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshStandardMaterial({ color: 0x5a7043, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(400, 40, 0x3a4a30, 0x3a4a30); grid.material.opacity = 0.25; grid.material.transparent = true; grid.position.y = 0.02; scene.add(grid);
    const sunSphere = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 20), new THREE.MeshBasicMaterial({ color: 0xffd257 })); scene.add(sunSphere);

    // псевдо-облака
    const cloudCv = document.createElement('canvas'); cloudCv.width = cloudCv.height = 128;
    const cg = cloudCv.getContext('2d'); const gr = cg.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(.5, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    cg.fillStyle = gr; cg.fillRect(0, 0, 128, 128);
    const cloudTex = new THREE.CanvasTexture(cloudCv), cloudGroup = new THREE.Group();
    for (let i = 0; i < 16; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: .6, depthWrite: false }));
      const sz = 40 + Math.random() * 70; s.scale.set(sz * 1.7, sz, 1);
      s.position.set((Math.random() - .5) * 760, 95 + Math.random() * 80, (Math.random() - .5) * 760); s.userData.spd = .03 + Math.random() * .06; cloudGroup.add(s); }
    scene.add(cloudGroup);

    // компас-надписи С/Ю/В/З (ось: X=восток, Z=юг, север=-Z)
    const compassSprites = [];
    [['С', 0, -1, '#f85149'], ['Ю', 0, 1, '#eef2f7'], ['В', 1, 0, '#eef2f7'], ['З', -1, 0, '#eef2f7']].forEach(([txt, dx, dz, col]) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
      g.fillStyle = col; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 32, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false })); sp.renderOrder = 900;
      scene.add(sp); compassSprites.push({ sp, dx, dz }); });

    const dyn = new THREE.Group(); scene.add(dyn);
    const gizmo = new THREE.Group(); scene.add(gizmo);

    const orbit = { az: -0.9, el: 0.6, r: 150, drag: false, px: 0, py: 0 };
    const rc = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const cvs = renderer.domElement;
    const sel = { ci: -1 }; const gd = { on: false };

    function ndc(e) { const r = cvs.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }; }
    function gpoint(e) { rc.setFromCamera(ndc(e), camera); const p = new THREE.Vector3(); return rc.ray.intersectPlane(groundPlane, p) ? p : null; }
    function pickBuilding(e) { rc.setFromCamera(ndc(e), camera); const t = dyn.children.filter(o => o.userData.ci !== undefined); const h = rc.intersectObjects(t, false)[0]; return h ? h.object.userData.ci : -1; }
    function pickGizmo(e) { if (!gizmo.children.length) return null; rc.setFromCamera(ndc(e), camera); const h = rc.intersectObjects(gizmo.children, true)[0]; let o = h && h.object; while (o) { if (o.userData.giz) return o.userData.giz; o = o.parent; } return null; }

    function gmat(c) { return new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, toneMapped: false }); }
    function arrow(dir, len, color, tag) {
      const g = new THREE.Group();
      const part = (rad, cr, ch, col, ro) => { const gg = new THREE.Group();
        const sh = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 12), gmat(col)); sh.position.y = len / 2; sh.renderOrder = ro;
        const tp = new THREE.Mesh(new THREE.ConeGeometry(cr, ch, 14), gmat(col)); tp.position.y = len + ch / 2; tp.renderOrder = ro; gg.add(sh, tp); return gg; };
      g.add(part(0.36, 1.05, 2.1, 0x0a0a0a, 998)); g.add(part(0.22, 0.7, 1.5, color, 999));
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      g.traverse(o => o.userData.giz = tag); return g;
    }
    function makeGizmo() {
      while (gizmo.children.length) gizmo.remove(gizmo.children[0]);
      const bd = bRef.current[sel.ci]; if (!bd) return;
      let cE = 0, cN = 0; bd.pts.forEach(p => { cE += p[0]; cN += p[1]; }); cE /= bd.pts.length; cN /= bd.pts.length;
      let ext = 5; bd.pts.forEach(p => ext = Math.max(ext, Math.hypot(p[0] - cE, p[1] - cN)));
      gizmo.position.set(cE, (bd.baseY || 0) + 0.3, -cN); const L = ext * 0.75 + 3;
      gizmo.add(arrow(new THREE.Vector3(1, 0, 0), L, 0xff1f1f, 'tx'));
      gizmo.add(arrow(new THREE.Vector3(0, 0, -1), L, 0x1f8bff, 'tz'));
      gizmo.add(arrow(new THREE.Vector3(0, 1, 0), L * 0.7, 0x16d13a, 'ty'));
      const ringB = new THREE.Mesh(new THREE.TorusGeometry(ext + 1.7, 0.28, 10, 56), gmat(0x0a0a0a)); ringB.rotation.x = Math.PI / 2; ringB.userData.giz = 'rot'; ringB.renderOrder = 998; gizmo.add(ringB);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(ext + 1.7, 0.18, 10, 56), gmat(0xffc400)); ring.rotation.x = Math.PI / 2; ring.userData.giz = 'rot'; ring.renderOrder = 999; gizmo.add(ring);
      if (bd.pts.length === 4) {
        const ue = bd.pts[1][0] - bd.pts[0][0], un = bd.pts[1][1] - bd.pts[0][1], uL = Math.hypot(ue, un) || 1, ux = ue / uL, uy = un / uL, vx = -uy, vy = ux;
        let hu = 0, hv = 0; bd.pts.forEach(p => { hu = Math.max(hu, Math.abs((p[0] - cE) * ux + (p[1] - cN) * uy)); hv = Math.max(hv, Math.abs((p[0] - cE) * vx + (p[1] - cN) * vy)); });
        const cube = (dx, dy, color, tag) => {
          const b0 = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), gmat(0x0a0a0a)); b0.position.set(dx, 0, -dy); b0.userData.giz = tag; b0.renderOrder = 998; gizmo.add(b0);
          const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), gmat(color)); b.position.set(dx, 0, -dy); b.userData.giz = tag; b.renderOrder = 999; gizmo.add(b);
        };
        cube(ux * (hu + 1.4), uy * (hu + 1.4), 0xffffff, 'sl'); cube(vx * (hv + 1.4), vy * (hv + 1.4), 0x00e6d0, 'sw');
      }
    }
    function commit(pts, baseY) {
      const arr = bRef.current.map((b, i) => i === sel.ci ? { ...b, pts: pts || b.pts, baseY: baseY !== undefined ? baseY : b.baseY } : b);
      onRef.current && onRef.current(arr);
    }

    const down = e => {
      const g = pickGizmo(e);
      if (sel.ci >= 0 && g) { const bd = bRef.current[sel.ci]; const gp = gpoint(e);
        let cE = 0, cN = 0; bd.pts.forEach(p => { cE += p[0]; cN += p[1]; }); cE /= bd.pts.length; cN /= bd.pts.length;
        const ue = bd.pts.length === 4 ? bd.pts[1][0] - bd.pts[0][0] : 1, un = bd.pts.length === 4 ? bd.pts[1][1] - bd.pts[0][1] : 0, uL = Math.hypot(ue, un) || 1;
        Object.assign(gd, { on: true, mode: g, name: bd.name, orig: bd.pts.map(p => p.slice()), baseY: bd.baseY || 0, cE, cN, ux: ue / uL, uy: un / uL, sE: gp ? gp.x : 0, sN: gp ? -gp.z : 0, sy: e.clientY });
        e.preventDefault(); return; }
      const ci = pickBuilding(e);
      if (ci >= 0) { sel.ci = ci; makeGizmo(); const bd = bRef.current[ci]; const gp = gpoint(e);
        let cE = 0, cN = 0; bd.pts.forEach(p => { cE += p[0]; cN += p[1]; }); cE /= bd.pts.length; cN /= bd.pts.length;
        Object.assign(gd, { on: true, mode: 'move', name: bd.name, orig: bd.pts.map(p => p.slice()), baseY: bd.baseY || 0, cE, cN, ux: 1, uy: 0, sE: gp ? gp.x : 0, sN: gp ? -gp.z : 0, sy: e.clientY });
        e.preventDefault(); return; }
      sel.ci = -1; while (gizmo.children.length) gizmo.remove(gizmo.children[0]);
      orbit.drag = true; orbit.px = e.clientX; orbit.py = e.clientY;
    };
    const move = e => {
      if (gd.on) { const gp = gpoint(e); const E = gp ? gp.x : 0, N = gp ? -gp.z : 0, vx = -gd.uy, vy = gd.ux; let cand = null, baseY;
        if (gd.mode === 'move') { cand = gd.orig.map(p => [p[0] + (E - gd.sE), p[1] + (N - gd.sN)]); }
        else if (gd.mode === 'tx') { cand = gd.orig.map(p => [p[0] + (E - gd.sE), p[1]]); }
        else if (gd.mode === 'tz') { cand = gd.orig.map(p => [p[0], p[1] + (N - gd.sN)]); }
        else if (gd.mode === 'ty') { baseY = Math.max(0, gd.baseY + (gd.sy - e.clientY) * 0.08); }
        else if (gd.mode === 'rot') { const a = Math.atan2(N - gd.cN, E - gd.cE) - Math.atan2(gd.sN - gd.cN, gd.sE - gd.cE); cand = gd.orig.map(p => rotPt(p, [gd.cE, gd.cN], a)); }
        else if (gd.mode === 'sl' || gd.mode === 'sw') { const ax = gd.mode === 'sl' ? [gd.ux, gd.uy] : [vx, vy];
          const pS = (gd.sE - gd.cE) * ax[0] + (gd.sN - gd.cN) * ax[1], pN = (E - gd.cE) * ax[0] + (N - gd.cN) * ax[1];
          const f = Math.max(0.15, Math.min(6, pN / (Math.abs(pS) < 0.5 ? (pS < 0 ? -0.5 : 0.5) : pS))); cand = gd.orig.map(p => scaleAxis(p, [gd.cE, gd.cN], ax, f)); }
        // ограничение: объект остаётся в участке с нормативным отступом
        if (cand && !fitsPlot(cand, polyRef.current, setbackFor(gd.name))) { e.preventDefault(); return; }
        commit(cand, baseY); e.preventDefault(); return; }
      if (!orbit.drag) return;
      orbit.az -= (e.clientX - orbit.px) * 0.006; orbit.el += (e.clientY - orbit.py) * 0.006;
      orbit.el = Math.max(0.08, Math.min(1.5, orbit.el)); orbit.px = e.clientX; orbit.py = e.clientY;
    };
    const upH = () => { gd.on = false; orbit.drag = false; };
    cvs.addEventListener('mousedown', down); addEventListener('mousemove', move); addEventListener('mouseup', upH);
    cvs.addEventListener('wheel', e => { orbit.r *= (1 + Math.sign(e.deltaY) * 0.08); orbit.r = Math.max(60, Math.min(500, orbit.r)); e.preventDefault(); }, { passive: false });

    function resize() { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    resize(); addEventListener('resize', resize);
    let raf; (function loop() { raf = requestAnimationFrame(loop);
      const { az, el: e2, r } = orbit; camera.position.set(r * Math.cos(e2) * Math.sin(az), r * Math.sin(e2), r * Math.cos(e2) * Math.cos(az)); camera.lookAt(0, 6, 0);
      cloudGroup.children.forEach(c => { c.position.x += c.userData.spd; if (c.position.x > 400) c.position.x = -400; });
      const R = (api.current.plotHalf || 12) + 8 + r * 0.14, csc = Math.max(8, Math.min(22, r * 0.055));
      compassSprites.forEach(c => { c.sp.position.set(c.dx * R, 3, c.dz * R); c.sp.scale.set(csc, csc, 1); });
      renderer.render(scene, camera); })();

    api.current = { scene, sun, sunSphere, ambient, dyn, sel, makeGizmo, gizmo, dispose() {
      cancelAnimationFrame(raf); removeEventListener('mousemove', move); removeEventListener('mouseup', upH); removeEventListener('resize', resize);
      renderer.dispose(); el.removeChild(renderer.domElement);
    } };
    return () => api.current.dispose();
  }, []);

  // rebuild plot + fence + buildings (+ gizmo)
  useEffect(() => {
    const a = api.current; if (!a.scene) return;
    const dyn = a.dyn; while (dyn.children.length) dyn.remove(dyn.children[0]);
    const base = (poly && poly.length >= 3) ? poly : [[-12, -12], [12, -12], [12, 12], [-12, 12]];
    a.plotHalf = Math.max(...base.map(p => Math.hypot(p[0], p[1])), 12);
    const shape = new THREE.Shape(); base.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])); shape.closePath();
    const plot = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xf5c451, roughness: 0.85, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    plot.rotation.x = -Math.PI / 2; plot.position.y = 0.05; plot.receiveShadow = true; plot.userData.plot = true; dyn.add(plot);
    if (fenceH > 0) { const fmat = new THREE.MeshStandardMaterial({ color: 0x8a7d5a, roughness: .95 });
      for (let i = 0; i < base.length; i++) { const A = base[i], B = base[(i + 1) % base.length]; const ax = A[0], az = -A[1], bx = B[0], bz = -B[1], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 0.05) continue;
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, fenceH, 0.12), fmat); m.position.set((ax + bx) / 2, fenceH / 2, (az + bz) / 2); m.rotation.y = Math.atan2(-dz, dx); m.castShadow = true; m.receiveShadow = true; dyn.add(m); } }
    const cmat = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.7 });
    const rmat = new THREE.MeshStandardMaterial({ color: 0x8f4a34, roughness: 0.75, side: THREE.DoubleSide });
    (buildings || []).forEach((bd, ci) => {
      if (!bd.pts || bd.pts.length < 3) return;
      const sh = new THREE.Shape(); bd.pts.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])); sh.closePath();
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: bd.height, bevelEnabled: false }), cmat);
      m.rotation.x = -Math.PI / 2; m.position.y = bd.baseY || 0; m.castShadow = true; m.receiveShadow = true; m.userData.ci = ci; dyn.add(m);
      const rh = bd.roofH || 0;
      if (bd.pts.length === 4 && rh > 0) { const roof = gableRoofMesh(bd.pts, bd.height, rh, rmat, !!bd.ridge); if (roof) { roof.position.y = bd.baseY || 0; roof.userData.ci = ci; dyn.add(roof); } }
    });
    if (a.sel && a.sel.ci >= 0 && a.sel.ci < (buildings || []).length) a.makeGizmo(); else if (a.gizmo) { while (a.gizmo.children.length) a.gizmo.remove(a.gizmo.children[0]); }
  }, [poly, fenceH, buildings]);

  // sun update
  useEffect(() => {
    const a = api.current; if (!a.scene) return;
    const p = sunPosition(utcMs, lat, lon), altDeg = p.altitude * 180 / Math.PI, az = compassAz(p.azimuth) * RAD, ca = Math.cos(p.altitude);
    const v = new THREE.Vector3(Math.sin(az) * ca, Math.sin(p.altitude), -Math.cos(az) * ca);
    a.sun.position.copy(v.clone().multiplyScalar(SUN_DIST)); a.sun.target.position.set(0, 0, 0);
    a.sunSphere.position.copy(v.clone().multiplyScalar(SUN_DIST));
    const up = altDeg > 0; a.sun.intensity = up ? (altDeg < 8 ? 0.9 : 1.5) : 0; a.ambient.intensity = up ? 0.3 : 0.12; a.sunSphere.visible = altDeg > -2;
    const top = altDeg <= 0 ? 0x11161f : altDeg < 8 ? 0x6a80a0 : 0x9fc0e8; a.scene.background.setHex(top); a.scene.fog.color.setHex(top);
  }, [utcMs, lat, lon]);

  // 3D-аналитика поверхностей
  useEffect(() => {
    const a = api.current; if (!a.scene) return;
    if (a.analyticsGroup) { a.scene.remove(a.analyticsGroup); a.analyticsGroup = null; }
    if (!analytics) return;
    const base = (poly && poly.length >= 3) ? poly : [[-12, -12], [12, -12], [12, 12], [-12, 12]];
    const rc = new THREE.Raycaster(); const occ = a.dyn.children.filter(o => !o.userData.plot);
    // шаги солнца по выбранным месяцам
    let m1 = Math.max(1, Math.min(12, anM1)), m2 = Math.max(1, Math.min(12, anM2)); if (m2 < m1) [m1, m2] = [m2, m1];
    const stepMin = 20, days = []; for (let m = m1 - 1; m <= m2 - 1; m++) { const t = getTimes(localToUTC(year, m, 21, 12, 0, 0), lat, lon), steps = [];
      for (let ms = t.rise; ms <= t.set; ms += stepMin * 60000) { const p = sunPosition(ms, lat, lon), alt = p.altitude * 180 / Math.PI; if (alt > 0) steps.push(sunVec(compassAz(p.azimuth), alt)); } days.push(steps); }
    const nDays = days.length || 1;
    const sampleHours = (origin, normal) => { let sunMin = 0; days.forEach(steps => steps.forEach(v => { if (normal && v.dot(normal) <= 0) return; rc.set(origin, v); rc.far = SUN_DIST; if (!occ.length || rc.intersectObjects(occ, false).length === 0) sunMin += stepMin; })); return sunMin / 60 / nDays; };
    const skyOpen = (origin, normal) => { let open = 0, tot = 0; for (let az = 0; az < 360; az += 45) for (let el = 20; el <= 70; el += 25) { const aa = az * RAD, ee = el * RAD; const v = new THREE.Vector3(Math.sin(aa) * Math.cos(ee), Math.sin(ee), -Math.cos(aa) * Math.cos(ee)); if (normal && v.dot(normal) <= 0) continue; tot++; rc.set(origin, v); rc.far = SUN_DIST; if (!occ.length || rc.intersectObjects(occ, false).length === 0) open++; } return tot ? open / tot : 0; };
    const surfVal = (origin, normal) => { let v = sampleHours(origin, normal); if (anDiff) v += skyOpen(origin, normal) * 2; return v; };
    const up = new THREE.Vector3(0, 1, 0), surfaces = [];
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9; base.forEach(p => { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); });
    const span = Math.max(mxx - mnx, mxy - mny), gs = Math.max(0.9, Math.min(2.2, span / 34)), feather = Math.max(1.5, gs * 2);
    const gmnx = mnx - feather, gmny = mny - feather, gmxx = mxx + feather, gmxy = mxy + feather;
    const gi = Math.max(1, Math.ceil((gmxx - gmnx) / gs)), gj = Math.max(1, Math.ceil((gmxy - gmny) / gs));
    surfaces.push(gridSurface(gi, gj, (i, j) => { const x = gmnx + (gmxx - gmnx) * i / gi, y = gmny + (gmxy - gmny) * j / gj;
      const alpha = Math.max(0, Math.min(1, signedDistPoly(x, y, base) / feather)); return { pos: new THREE.Vector3(x, 0.09, -y), origin: new THREE.Vector3(x, 0.12, -y), normal: up, alpha }; }));
    (buildings || []).forEach(bd => { if (!bd.pts || bd.pts.length < 3) return;
      let cx = 0, cy = 0; bd.pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= bd.pts.length; cy /= bd.pts.length; const by = bd.baseY || 0, H = bd.height;
      for (let e = 0; e < bd.pts.length; e++) { const A = bd.pts[e], B = bd.pts[(e + 1) % bd.pts.length]; const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1;
        let nx = dy / len, ny = -dx / len; if (nx * ((A[0] + B[0]) / 2 - cx) + ny * ((A[1] + B[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; } const nrm = new THREE.Vector3(nx, 0, -ny).normalize();
        const nu = Math.max(1, Math.round(len / 1.1)), nv = Math.max(1, Math.round(H / 1.1));
        surfaces.push(gridSurface(nu, nv, (i, j) => { const u = i / nu, v = j / nv * H; const bpt = new THREE.Vector3(A[0] + dx * u, by + v, -(A[1] + dy * u));
          const origin = bpt.clone().add(nrm.clone().multiplyScalar(0.15)); origin.y = Math.max(0.3, by + v); return { pos: bpt.clone().add(nrm.clone().multiplyScalar(0.04)), origin, normal: nrm }; })); }
      const rh = bd.roofH || 0;
      if (bd.pts.length === 4 && rh > 0) roofSlopes3D(bd.pts, by + H, rh, !!bd.ridge).forEach(sl => { const c = sl.corners, n = sl.normal, off = n.clone().multiplyScalar(0.05), ori = n.clone().multiplyScalar(0.25);
        const ns = Math.max(1, Math.round(c[1].distanceTo(c[0]) / 1.1)), nt = Math.max(1, Math.round(c[3].distanceTo(c[0]) / 1.1));
        surfaces.push(gridSurface(ns, nt, (i, j) => { const s = i / ns, t = j / nt; const p = new THREE.Vector3().addScaledVector(c[0], (1 - s) * (1 - t)).addScaledVector(c[1], s * (1 - t)).addScaledVector(c[2], s * t).addScaledVector(c[3], (1 - s) * t);
          return { pos: p.clone().add(off), origin: p.clone().add(ori), normal: n }; })); }); });
    if (fenceH > 0) { let cx = 0, cy = 0; base.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= base.length; cy /= base.length;
      for (let e = 0; e < base.length; e++) { const A = base[e], B = base[(e + 1) % base.length]; const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1;
        let ox = dy / len, oy = -dx / len; if (ox * ((A[0] + B[0]) / 2 - cx) + oy * ((A[1] + B[1]) / 2 - cy) < 0) { ox = -ox; oy = -oy; }
        [1, -1].forEach(side => { const nx = ox * side, ny = oy * side, nrm = new THREE.Vector3(nx, 0, -ny).normalize();
          const nu = Math.max(1, Math.round(len / 1.1)), nv = Math.max(2, Math.round(fenceH / 0.7));
          surfaces.push(gridSurface(nu, nv, (i, j) => { const u = i / nu, v = j / nv * fenceH; const bpt = new THREE.Vector3(A[0] + dx * u, v, -(A[1] + dy * u));
            const origin = bpt.clone().add(nrm.clone().multiplyScalar(0.1)); origin.y = Math.max(0.2, v); return { pos: bpt.clone().add(nrm.clone().multiplyScalar(0.05)), origin, normal: nrm }; })); }); } }
    let minV = 1e9, maxV = -1e9;
    surfaces.forEach(sf => { sf.vals = sf.nodes.map(nd => { if (nd.alpha !== undefined && nd.alpha <= 0.02) return 0; const v = surfVal(nd.origin, nd.normal); if (v < minV) minV = v; if (v > maxV) maxV = v; return v; }); });
    if (!(maxV > minV)) { minV = 0; maxV = Math.max(0.001, maxV); }
    const norm = v => Math.max(0, Math.min(1, (v - minV) / (maxV - minV)));
    const grp = new THREE.Group();
    surfaces.forEach(sf => { if (!sf.cells.length) return; const pos = [], col = [];
      const push = k => { const p = sf.nodes[k].pos; pos.push(p.x, p.y, p.z); const c = new THREE.Color(thermalColor(norm(sf.vals[k]))); const al = sf.nodes[k].alpha !== undefined ? sf.nodes[k].alpha : 1; col.push(c.r, c.g, c.b, al); };
      sf.cells.forEach(q => { push(q[0]); push(q[1]); push(q[2]); push(q[0]); push(q[2]); push(q[3]); });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
      grp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }))); });
    a.scene.add(grp); a.analyticsGroup = grp;
    onAnalyticsStats && onAnalyticsStats({ minV, maxV, m1, m2, diff: anDiff });
  }, [analytics, anM1, anM2, anDiff, buildings, poly, fenceH, lat, lon, year]);

  return <div ref={mount} style={{ position: 'absolute', inset: 0 }} />;
}
