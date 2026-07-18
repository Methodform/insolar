import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { sunPosition, compassAz, RAD } from '../engine/astronomy.js';

const SUN_DIST = 400;

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

export default function Viewport({ utcMs, lat, lon, poly, fenceH, buildings, onBuildings }) {
  const mount = useRef(null);
  const api = useRef({});
  const bRef = useRef(buildings); bRef.current = buildings;
  const onRef = useRef(onBuildings); onRef.current = onBuildings;

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
        Object.assign(gd, { on: true, mode: g, orig: bd.pts.map(p => p.slice()), baseY: bd.baseY || 0, cE, cN, ux: ue / uL, uy: un / uL, sE: gp ? gp.x : 0, sN: gp ? -gp.z : 0, sy: e.clientY });
        e.preventDefault(); return; }
      const ci = pickBuilding(e);
      if (ci >= 0) { sel.ci = ci; makeGizmo(); const bd = bRef.current[ci]; const gp = gpoint(e);
        let cE = 0, cN = 0; bd.pts.forEach(p => { cE += p[0]; cN += p[1]; }); cE /= bd.pts.length; cN /= bd.pts.length;
        Object.assign(gd, { on: true, mode: 'move', orig: bd.pts.map(p => p.slice()), baseY: bd.baseY || 0, cE, cN, ux: 1, uy: 0, sE: gp ? gp.x : 0, sN: gp ? -gp.z : 0, sy: e.clientY });
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
    const shape = new THREE.Shape(); base.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])); shape.closePath();
    const plot = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xf5c451, roughness: 0.85, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    plot.rotation.x = -Math.PI / 2; plot.position.y = 0.05; plot.receiveShadow = true; dyn.add(plot);
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

  return <div ref={mount} style={{ position: 'absolute', inset: 0 }} />;
}
