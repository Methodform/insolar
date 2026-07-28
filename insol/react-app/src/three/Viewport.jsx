import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { sunPosition, compassAz, RAD, offsetInward, pointInPoly, nearestOnSeg, getTimes, localToUTC, plotBasis, clampToPoly } from '../engine/astronomy.js';

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
// параметрическое остекление дома: окна по фасадам + дверь (для прямоугольных контуров)
const GLASS_MAT = new THREE.MeshStandardMaterial({ color: 0xbcd6ec, roughness: 0.12, metalness: 0.0, emissive: 0x33506e, emissiveIntensity: 0.14, side: THREE.DoubleSide });
const FRAME_MAT = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.8, side: THREE.DoubleSide });
function addGlazing(dyn, pts, by, height, ci) {
  if (!pts || pts.length < 4 || !(height > 1.5)) return;
  let cx = 0, cz = 0; pts.forEach(p => { cx += p[0]; cz += -p[1]; }); cx /= pts.length; cz /= pts.length;
  for (let e = 0; e < pts.length; e++) {
    const A = pts[e], B = pts[(e + 1) % pts.length];
    const ax = A[0], az = -A[1], bx = B[0], bz = -B[1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 1.4) continue;
    const ux = dx / L, uz = dz / L;
    let nx = uz, nz = -ux;                                   // нормаль наружу
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
    const rotY = Math.atan2(nx, nz);
    const n = Math.max(1, Math.min(5, Math.floor(L / 2.6)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const door = e === 0 && i === (n >> 1);
      const w = Math.min(1.3, (L / n) * 0.62), h = door ? Math.min(2.1, height * 0.9) : Math.min(1.4, height * 0.5);
      const yy = door ? by + h / 2 + 0.05 : by + height * 0.5;
      const bxp = ax + ux * L * t, bzp = az + uz * L * t;
      const fr = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.14, h + 0.14), FRAME_MAT);
      fr.position.set(bxp + nx * 0.03, yy, bzp + nz * 0.03); fr.rotation.y = rotY; fr.userData.ci = ci; fr.castShadow = false; dyn.add(fr);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), GLASS_MAT);
      gl.position.set(bxp + nx * 0.05, yy, bzp + nz * 0.05); gl.rotation.y = rotY; gl.userData.ci = ci; dyn.add(gl);
    }
  }
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

// ===== детальный «типовой дом» (пресет), масштабируется под контур W×D =====
const SIDING_MAT = new THREE.MeshStandardMaterial({ color: 0xe8e3d7, roughness: 0.85 });
const SHINGLE_MAT = new THREE.MeshStandardMaterial({ color: 0x7d5f52, roughness: 0.8, side: THREE.DoubleSide });
const DARKTRIM_MAT = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.7, side: THREE.DoubleSide });
const GUTTER_MAT = new THREE.MeshStandardMaterial({ color: 0x50565c, roughness: 0.6 });
function hipRoofGeo(w, d, rh, capW, capD) {
  const b = [[-w / 2, 0, d / 2], [w / 2, 0, d / 2], [w / 2, 0, -d / 2], [-w / 2, 0, -d / 2]];
  const t = [[-capW / 2, rh, capD / 2], [capW / 2, rh, capD / 2], [capW / 2, rh, -capD / 2], [-capW / 2, rh, -capD / 2]];
  const pos = []; const quad = (p1, p2, p3, p4) => { pos.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4); };
  quad(b[0], b[1], t[1], t[0]); quad(b[1], b[2], t[2], t[1]); quad(b[2], b[3], t[3], t[2]); quad(b[3], b[0], t[0], t[3]);
  pos.push(...t[0], ...t[1], ...t[2], ...t[0], ...t[2], ...t[3]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}
function buildTypicalHouse(W, D, H) {
  const g = new THREE.Group(); const ov = 0.5, rh = Math.max(1.2, Math.min(W, D) * 0.32);
  const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.3, D + 0.3), DARKTRIM_MAT); base.position.y = 0.15; base.receiveShadow = true; g.add(base);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), SIDING_MAT); walls.position.y = 0.15 + H / 2; walls.castShadow = true; walls.receiveShadow = true; g.add(walls);
  const roof = new THREE.Mesh(hipRoofGeo(W + ov * 2, D + ov * 2, rh, W * 0.28, D * 0.28), SHINGLE_MAT); roof.position.y = 0.15 + H; roof.castShadow = true; roof.receiveShadow = true; g.add(roof);
  const ey = 0.15 + H, eW = W + ov * 2, eD = D + ov * 2;
  const fasc = (bw, bd, px, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.34, bd), DARKTRIM_MAT); m.position.set(px, ey, pz); g.add(m); };
  fasc(eW, 0.16, 0, eD / 2); fasc(eW, 0.16, 0, -eD / 2); fasc(0.16, eD, eW / 2, 0); fasc(0.16, eD, -eW / 2, 0);
  const wy = 0.15 + H * 0.5;
  const addWin = (px, pz, rotY, w, h, yy) => {
    const fr = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.14, h + 0.14), FRAME_MAT); fr.position.set(px, yy, pz); fr.rotation.y = rotY; g.add(fr);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), GLASS_MAT); gl.position.set(px + Math.sin(rotY) * 0.02, yy, pz + Math.cos(rotY) * 0.02); gl.rotation.y = rotY; g.add(gl);
  };
  const nx = Math.max(1, Math.min(5, Math.floor(W / 2.6)));
  for (let i = 0; i < nx; i++) { const x = -W / 2 + (i + 0.5) * W / nx;
    if (i === (nx >> 1)) { const dh = Math.min(2.1, H * 0.92); addWin(x, D / 2 + 0.04, 0, 1.0, dh, 0.15 + dh / 2); }
    else addWin(x, D / 2 + 0.04, 0, Math.min(1.3, (W / nx) * 0.62), Math.min(1.4, H * 0.5), wy);
    addWin(x, -D / 2 - 0.04, Math.PI, Math.min(1.3, (W / nx) * 0.62), Math.min(1.4, H * 0.5), wy); }
  const nz = Math.max(1, Math.min(5, Math.floor(D / 2.6)));
  for (let i = 0; i < nz; i++) { const z = -D / 2 + (i + 0.5) * D / nz;
    addWin(W / 2 + 0.04, z, Math.PI / 2, Math.min(1.3, (D / nz) * 0.62), Math.min(1.4, H * 0.5), wy);
    addWin(-W / 2 - 0.04, z, -Math.PI / 2, Math.min(1.3, (D / nz) * 0.62), Math.min(1.4, H * 0.5), wy); }
  [[W / 2, D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [-W / 2, -D / 2]].forEach(([cxp, czp]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, H + rh * 0.4, 8), GUTTER_MAT);
    p.position.set(cxp, (H + rh * 0.4) / 2 + 0.15, czp); p.castShadow = true; g.add(p); });
  return g;
}

// ===== ГОТОВАЯ детальная модель дома (точный порт uploads/index.html) =====
// текстуры и материалы строятся один раз (синглтон), геометрия — на каждый инстанс
let READY_MATS = null;
function readyMats() {
  if (READY_MATS) return READY_MATS;
  const tex = (w, h, draw, rx = 1, ry = 1) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const sidingTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#f2f3f1'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { g.fillStyle = '#e0e2df'; g.fillRect(x, 0, 2, h); g.fillStyle = '#fafbf9'; g.fillRect(x + 2, 0, 1, h); }
  }, 4, 1.6);
  const woodTexture = (rx, ry) => tex(256, 256, (g, w, h) => {
    const shades = ['#6d4f36', '#75563b', '#654830', '#7c5c40'];
    for (let y = 0, i = 0; y < h; y += 22, i++) {
      g.fillStyle = shades[i % shades.length]; g.fillRect(0, y, w, 22);
      g.fillStyle = 'rgba(40,25,12,.85)'; g.fillRect(0, y, w, 2);
      g.strokeStyle = 'rgba(30,18,8,.25)';
      for (let k = 0; k < 6; k++) { g.beginPath(); const yy = y + 3 + Math.random() * 17; g.moveTo(0, yy); g.lineTo(w, yy + Math.random() * 2 - 1); g.stroke(); }
    }
  }, rx, ry);
  const woodTex = woodTexture(2.2, 1.6);
  const deckTex = tex(512, 512, (g, w, h) => {
    const shades = ['#8a6b4d', '#93745a', '#7e6045', '#886849'];
    for (let y = 0, i = 0; y < h; y += 32, i++) {
      g.fillStyle = shades[i % shades.length]; g.fillRect(0, y, w, 32);
      g.fillStyle = 'rgba(35,22,10,.9)'; g.fillRect(0, y, w, 3);
      g.strokeStyle = 'rgba(40,25,12,.3)';
      for (let k = 0; k < 8; k++) { g.beginPath(); const yy = y + 4 + Math.random() * 26; g.moveTo(0, yy); g.lineTo(w, yy); g.stroke(); }
    }
  }, 1.2, 3);
  const shingleTex = tex(512, 512, (g, w, h) => {
    g.fillStyle = '#4a3d33'; g.fillRect(0, 0, w, h);
    const pal = ['#8a6a4f', '#7b5a42', '#6e564b', '#5f5148', '#93705a', '#55483f', '#7d6553'];
    const sw = 42, sh = 30;
    for (let row = -1; row < h / sh + 1; row++) {
      const off = (row % 2) ? sw / 2 : 0;
      for (let x = -1; x < w / sw + 1; x++) {
        const cx = x * sw + off, cy = row * sh;
        g.fillStyle = pal[Math.floor(Math.random() * pal.length)];
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + sw, cy); g.lineTo(cx + sw, cy + sh - 10);
        g.arc(cx + sw / 2, cy + sh - 10, sw / 2, 0, Math.PI); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(30,24,18,.5)'; g.stroke();
      }
    }
  }, 1, 1);
  READY_MATS = {
    siding: new THREE.MeshStandardMaterial({ map: sidingTex, roughness: .85 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: .8 }),
    deck: new THREE.MeshStandardMaterial({ map: deckTex, roughness: .85 }),
    shingle: new THREE.MeshStandardMaterial({ map: shingleTex, roughness: .95 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: .6, metalness: .25 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: .5, metalness: .3 }),
    glass: new THREE.MeshPhongMaterial({ color: 0x30414d, specular: 0xcfe0ee, shininess: 180, reflectivity: .6, transparent: true, opacity: .94 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf4f5f3, roughness: .9 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x9aa0a3, roughness: .95 }),
    woodTexture,
  };
  return READY_MATS;
}
function buildReadyHouse() {
  const M = readyMats();
  const h = new THREE.Group();
  const box = (w, ht, d, mat, x, y, z, parent = h) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  const hipRoof = (w, d, hh, capW, capD, y, x = 0, z = 0) => {
    const g = new THREE.BufferGeometry();
    const b = [[-w / 2, 0, d / 2], [w / 2, 0, d / 2], [w / 2, 0, -d / 2], [-w / 2, 0, -d / 2]];
    const t = [[-capW / 2, hh, capD / 2], [capW / 2, hh, capD / 2], [capW / 2, hh, -capD / 2], [-capW / 2, hh, -capD / 2]];
    const pos = [], uv = [], s = 1.6;
    const quad = (p1, p2, p3, p4) => {
      const eb = Math.hypot(p2[0] - p1[0], p2[2] - p1[2]);
      const sl = Math.hypot((p4[0] + p3[0]) / 2 - (p1[0] + p2[0]) / 2, hh, (p4[2] + p3[2]) / 2 - (p1[2] + p2[2]) / 2);
      const et = Math.hypot(p4[0] - p3[0], p4[2] - p3[2]);
      const o = (eb - et) / 2;
      const P = [p1, p2, p3, p1, p3, p4];
      const U = [[0, 0], [eb / s, 0], [(o + et) / s, sl / s], [0, 0], [(o + et) / s, sl / s], [o / s, sl / s]];
      P.forEach(p => pos.push(...p)); U.forEach(u => uv.push(...u));
    };
    quad(b[0], b[1], t[1], t[0]); quad(b[1], b[2], t[2], t[1]); quad(b[2], b[3], t[3], t[2]); quad(b[3], b[0], t[0], t[3]);
    pos.push(...t[0], ...t[1], ...t[2], ...t[0], ...t[2], ...t[3]);
    uv.push(0, 0, capW / s, 0, capW / s, capD / s, 0, 0, capW / s, capD / s, 0, capD / s);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, M.shingle);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; h.add(m);
    box(capW + .15, .12, capD + .15, M.dark, x, y + hh + .04, z);
    return m;
  };
  const fascia = (w, d, y, x = 0, z = 0) => {
    const t = .16, hh = .38;
    box(w, hh, t, M.dark, x, y, z + d / 2 - t / 2);
    box(w, hh, t, M.dark, x, y, z - d / 2 + t / 2);
    box(t, hh, d, M.dark, x - w / 2 + t / 2, y, z);
    box(t, hh, d, M.dark, x + w / 2 - t / 2, y, z);
    const sof = box(w - .2, .06, d - .2, M.white, x, y + .14, z); sof.castShadow = false;
  };
  const glazing = (x, y, z, w, ht, rot, divs = 2, door = false) => {
    const gr = new THREE.Group();
    const fd = .14, ft = .09;
    const mk = (bw, bh, bd, px, py, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), M.frame); m.position.set(px, py, pz); m.castShadow = true; gr.add(m); };
    mk(w, ft, fd, 0, ht / 2 - ft / 2, 0); mk(w, ft, fd, 0, -ht / 2 + ft / 2, 0);
    mk(ft, ht, fd, -w / 2 + ft / 2, 0, 0); mk(ft, ht, fd, w / 2 - ft / 2, 0, 0);
    for (let i = 1; i < divs; i++) mk(.06, ht - .1, fd - .02, -w / 2 + i * w / divs, 0, 0);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(w - .12, ht - .12), M.glass);
    gl.position.z = .01; gr.add(gl);
    if (door) { const hd = new THREE.Mesh(new THREE.BoxGeometry(.03, .5, .05), M.frame); hd.position.set(w / 2 - .22, 0, .09); gr.add(hd); }
    gr.position.set(x, y, z); gr.rotation.y = [0, Math.PI / 2, Math.PI, -Math.PI / 2][rot];
    h.add(gr); return gr;
  };
  const panel = (x, y, z, w, ht, rot) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, ht, .07), new THREE.MeshStandardMaterial({ map: M.woodTexture(w / 1.4, ht / 1.4), roughness: .8 }));
    m.position.set(x, y, z); m.rotation.y = [0, Math.PI / 2, Math.PI, -Math.PI / 2][rot];
    m.castShadow = true; m.receiveShadow = true; h.add(m);
    const e = new THREE.Mesh(new THREE.BoxGeometry(w + .1, ht + .1, .05), M.dark);
    e.position.copy(m.position); e.rotation.copy(m.rotation); e.translateZ(-.02); h.add(e);
  };
  const lamp = (x, y, z, rot) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .26, 12), M.frame);
    m.position.set(x, y, z); m.rotation.y = [0, Math.PI / 2, Math.PI, -Math.PI / 2][rot];
    m.translateZ(.07); h.add(m);
  };
  const pipe = (x, z, top) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, top - .2, 10), M.dark);
    m.position.set(x, (top + .2) / 2, z); m.castShadow = true; h.add(m);
  };
  const vent = (x, y, z) => {
    const v = new THREE.Mesh(new THREE.CylinderGeometry(.11, .13, .75, 12), M.frame); v.position.set(x, y, z); v.castShadow = true; h.add(v);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .1, 12), M.frame); c.position.set(x, y + .42, z); h.add(c);
  };
  const deckPlat = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, .16, d), M.deck);
    m.position.set(x, .1, z); m.receiveShadow = true; m.castShadow = true; h.add(m);
  };
  const WALL_Y0 = .2;
  // фундамент-цоколь
  box(12.7, .25, 11.7, M.concrete, 0, .125, 0);
  box(5.7, .25, 8.2, M.concrete, 9, .125, 0);
  // объёмы стен
  box(12.5, 3.0, 11.5, M.siding, 0, WALL_Y0 + 1.5, 0);
  box(5.5, 2.55, 8.0, M.siding, 9, WALL_Y0 + 1.275, 0);
  // крыши
  fascia(14.3, 13.3, 3.13);
  hipRoof(14.3, 13.3, 2.25, 2.6, 1.3, 3.32);
  fascia(7.1, 9.6, 2.67, 9, 0);
  hipRoof(7.1, 9.6, 1.35, 1.1, 3.4, 2.86, 9, 0);
  // фронт основного объёма
  panel(0.4, WALL_Y0 + 1.5, 5.79, 7.4, 2.9, 0);
  glazing(-1.6, WALL_Y0 + 1.5, 5.85, 2.7, 2.6, 0, 3, true);
  glazing(2.1, WALL_Y0 + 1.55, 5.85, 2.2, 2.3, 0, 2);
  glazing(-5.2, WALL_Y0 + 1.35, 5.85, 1.0, 2.3, 0, 1, true);
  lamp(-4.45, WALL_Y0 + 2.05, 5.83, 0); lamp(-.05, WALL_Y0 + 2.05, 5.83, 0); lamp(3.3, WALL_Y0 + 2.05, 5.83, 0);
  // левый фасад
  panel(-6.29, WALL_Y0 + 1.5, -.2, 5.4, 2.9, 3);
  glazing(-6.35, WALL_Y0 + 1.7, 1.5, 1.8, 1.5, 3, 2);
  glazing(-6.35, WALL_Y0 + 1.7, -1.9, 1.8, 1.5, 3, 2);
  lamp(-6.33, WALL_Y0 + 2.05, -.2, 3);
  // задний фасад
  panel(-2, WALL_Y0 + 1.5, -5.79, 6.0, 2.9, 2);
  glazing(-3.6, WALL_Y0 + 1.55, -5.85, 2.0, 2.3, 2, 2);
  glazing(-.6, WALL_Y0 + 1.7, -5.85, 1.6, 1.5, 2, 2);
  glazing(3.9, WALL_Y0 + 1.7, -5.85, 1.6, 1.5, 2, 2);
  lamp(-2.1, WALL_Y0 + 2.05, -5.83, 2);
  // пристройка
  panel(9.3, WALL_Y0 + 1.27, 4.04, 4.4, 2.45, 0);
  glazing(9.3, WALL_Y0 + 1.35, 4.1, 3.2, 2.25, 0, 3, true);
  lamp(7.4, WALL_Y0 + 1.85, 4.08, 0); lamp(11.2, WALL_Y0 + 1.85, 4.08, 0);
  glazing(11.81, WALL_Y0 + 1.5, 0, 1.6, 1.4, 1, 2);
  glazing(9.3, WALL_Y0 + 1.5, -4.05, 1.6, 1.4, 2, 2);
  // водостоки
  pipe(-6.05, 5.55, 3.25); pipe(-6.05, -5.55, 3.25); pipe(6.05, -5.55, 3.25);
  pipe(11.55, 3.8, 2.8); pipe(11.55, -3.8, 2.8);
  // вентвыходы
  vent(-2.2, 5.35, -1.5); vent(1.8, 5.45, .6); vent(9.6, 4.3, -.8);
  // террасы
  deckPlat(9.0, 3.6, -2.6, 7.7);
  deckPlat(3.4, 7.6, -8.1, 2.2);
  deckPlat(5.6, 2.8, 9.2, 5.6);
  deckPlat(1.6, .5, -5.2, 9.7);
  return h;
}
function inferKind(name) { const n = (name || '').toLowerCase();
  if (/бан/.test(n)) return 'bath'; if (/бесед/.test(n)) return 'gazebo'; if (/навес/.test(n)) return 'canopy';
  if (/шат/.test(n)) return 'tent'; if (/дерев/.test(n)) return 'tree'; if (/куст/.test(n)) return 'bush';
  if (/дорож/.test(n)) return 'path'; return 'house'; }
const rotPt = (p, c, a) => { const s = Math.sin(a), co = Math.cos(a), dx = p[0] - c[0], dy = p[1] - c[1]; return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co]; };
const scaleAxis = (p, c, ax, f) => { const U = (p[0] - c[0]) * ax[0] + (p[1] - c[1]) * ax[1]; const px = (p[0] - c[0]) - U * ax[0], py = (p[1] - c[1]) - U * ax[1]; return [c[0] + ax[0] * U * f + px, c[1] + ax[1] * U * f + py]; };

// --- процедурные текстуры (без внешних файлов) для более реалистичной сцены ---
function makeGrassTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#5f7a43'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { const s = Math.random();
    g.fillStyle = `rgba(${60 + s * 45 | 0},${95 + s * 65 | 0},${48 + s * 40 | 0},0.5)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(80, 80);
  t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makePlasterTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#eae7e0'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2400; i++) { const v = Math.random() * 22 - 11;
    g.fillStyle = `rgba(${212 + v | 0},${208 + v | 0},${200 + v | 0},0.5)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeSkyTexture(day) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256; const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  if (day) { grd.addColorStop(0, '#3f7fce'); grd.addColorStop(0.55, '#8fb6e6'); grd.addColorStop(1, '#dce8f2'); }
  else { grd.addColorStop(0, '#0b1a33'); grd.addColorStop(0.7, '#20344f'); grd.addColorStop(1, '#3a4a5e'); }
  g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

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

// --- линии тока ветра: упрощённое потенциальное обтекание строений-цилиндров (качественно) ---
// градиент: обычная скорость — жёлтый, ускорение у боков препятствий — красный
const WSTOPS = [[0, [0.96, 0.80, 0.25]], [0.5, [0.95, 0.58, 0.25]], [1, [0.90, 0.26, 0.24]]];
function windColor(t) { t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < WSTOPS.length; i++) { if (t <= WSTOPS[i][0]) { const a = WSTOPS[i - 1], b = WSTOPS[i], k = (t - a[0]) / ((b[0] - a[0]) || 1);
    return [a[1][0] + (b[1][0] - a[1][0]) * k, a[1][1] + (b[1][1] - a[1][1]) * k, a[1][2] + (b[1][2] - a[1][2]) * k]; } }
  return WSTOPS[WSTOPS.length - 1][1];
}
// возвращает { lines:[{pos[x,y,z...], spd[]}] } — линии тока, обрезанные по границам участка (+отступ)
// расстояние от точки P внутри участка ВВЕРХ по ветру до наветренного забора (пересечение луча с полигоном, сцен. коорд.)
function rayExitDist(px, pz, dx, dz, polyS) {
  let best = Infinity;
  for (let i = 0; i < polyS.length; i++) {
    const A = polyS[i], B = polyS[(i + 1) % polyS.length];
    const ex = B[0] - A[0], ez = B[1] - A[1], den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((A[0] - px) * ez - (A[1] - pz) * ex) / den;
    const u = ((A[0] - px) * dz - (A[1] - pz) * dx) / den;
    if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.min(best, t);
  }
  return best;
}
// забор — проницаемый барьер: не отклоняет поток, а гасит скорость у земли с подветренной стороны.
// ветер идёт поверх забора (выше fenceH влияния нет); затишье тянется вглубь участка ~7·высот, затухая.
function fenceShelter(x, z, y, polyS, fenceH, fx, fz) {
  if (!(fenceH > 0) || y >= fenceH) return 1;
  const shelterLen = fenceH * 7;
  const du = rayExitDist(x, z, -fx, -fz, polyS);   // как далеко вглубь от наветренного забора
  if (!isFinite(du) || du >= shelterLen) return 1;
  const k = 1 - du / shelterLen;                   // 1 у забора → 0 на глубине shelterLen
  const hf = 1 - y / fenceH;                        // 1 у земли → 0 на верху забора
  return 1 - 0.85 * k * hf;                         // у земли прямо за забором скорость падает до ~15%
}

function buildStreamlines(dirDeg, base, buildings, plotHalf, fenceH, neighbors) {
  const flowA = (dirDeg + 180) * Math.PI / 180, fx = Math.sin(flowA), fz = -Math.cos(flowA), px = -fz, pz = fx;
  const polyS = base.map(p => [p[0], -p[1]]);
  const obs = [];
  (buildings || []).forEach(b => { if (!b.pts || b.pts.length < 3) return; const k = b.kind;
    if (k === 'path' || k === 'bush') return;
    let cx = 0, cy = 0; b.pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= b.pts.length; cy /= b.pts.length;
    let a = 1.5; b.pts.forEach(p => a = Math.max(a, Math.hypot(p[0] - cx, p[1] - cy)));
    const top = k === 'tree' ? (b.height || 5) : (b.height || 3) + (b.roofH || 0);
    obs.push({ x: cx, z: -cy, a: a * 1.15, top }); });
  (neighbors || []).forEach(b => { if (!b.pts || b.pts.length < 3) return;
    let cx = 0, cy = 0; b.pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= b.pts.length; cy /= b.pts.length;
    let a = 1.5; b.pts.forEach(p => a = Math.max(a, Math.hypot(p[0] - cx, p[1] - cy)));
    obs.push({ x: cx, z: -cy, a: a * 1.1, top: b.height || 5 }); });
  const maxH = obs.length ? Math.max(3, ...obs.map(o => o.top)) : 6;
  // границы участка в координатах сцены (x=e, z=-n) + отступ; линии рисуем только внутри
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  base.forEach(p => { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, -p[1]); maxz = Math.max(maxz, -p[1]); });
  const mg = 7; minx -= mg; maxx += mg; minz -= mg; maxz += mg;
  const inside = (x, z) => x >= minx && x <= maxx && z >= minz && z <= maxz;
  const U = 1;
  const vel = (x, z, y) => { let vx = U * fx, vz = U * fz;
    for (const o of obs) { if (y > o.top) continue;
      const dx = x - o.x, dz = z - o.z, X = dx * fx + dz * fz, Y = dx * px + dz * pz, r2 = X * X + Y * Y;
      if (r2 < 1e-3) continue; const a2 = o.a * o.a, dux = -U * a2 * (X * X - Y * Y) / (r2 * r2), duy = -U * 2 * a2 * X * Y / (r2 * r2);
      vx += dux * fx + duy * px; vz += dux * fz + duy * pz; }
    const sf = fenceShelter(x, z, y, polyS, fenceH, fx, fz); return [vx * sf, vz * sf]; };
  const R = plotHalf + 14, N = 200, ds = (2 * R) / N;
  const spread = plotHalf + 1;
  const L = Math.max(2, Math.min(4, Math.round(maxH / 3))), M = 13;
  const lines = [];
  for (let l = 0; l < L; l++) {
    const y = 1.4 + (maxH - 1.4) * (L === 1 ? 0 : l / (L - 1));
    for (let m = 0; m < M; m++) {
      const t = (m / (M - 1)) * 2 - 1; let x = -fx * R + px * t * spread, z = -fz * R + pz * t * spread;
      const pos = [], spd = [];
      for (let s = 0; s < N; s++) {
        for (const o of obs) { if (y > o.top) continue; const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz) || 1e-6; if (d < o.a) { x = o.x + dx / d * o.a; z = o.z + dz / d * o.a; } }
        const [vx, vz] = vel(x, z, y); const sp = Math.hypot(vx, vz) || 1e-6;
        if (inside(x, z)) { pos.push(x, y, z); spd.push(sp); }   // только в пределах участка
        x += vx / sp * ds; z += vz / sp * ds;
      }
      if (pos.length >= 6) lines.push({ pos, spd });
    }
  }
  return { lines };
}

// зоны комфорта по ветру: затишье (за постройками) и продувание (по бокам, ускорение)
// возвращает { pos[x,y,z...], col[r,g,b...] } — плоская сетка-оверлей на земле в пределах участка
function buildWindComfort(dirDeg, base, buildings, fenceH, neighbors) {
  const flowA = (dirDeg + 180) * Math.PI / 180, fx = Math.sin(flowA), fz = -Math.cos(flowA), px = -fz, pz = fx;
  const polyS = base.map(p => [p[0], -p[1]]);
  const obs = [];
  (buildings || []).forEach(b => { if (!b.pts || b.pts.length < 3) return; const k = b.kind; if (k === 'path' || k === 'bush') return;
    let cx = 0, cy = 0; b.pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= b.pts.length; cy /= b.pts.length;
    let a = 1.5; b.pts.forEach(p => a = Math.max(a, Math.hypot(p[0] - cx, p[1] - cy)));
    const top = k === 'tree' ? (b.height || 5) : (b.height || 3) + (b.roofH || 0);
    obs.push({ x: cx, z: -cy, a: a * 1.15, top }); });
  (neighbors || []).forEach(b => { if (!b.pts || b.pts.length < 3) return;
    let cx = 0, cy = 0; b.pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= b.pts.length; cy /= b.pts.length;
    let a = 1.5; b.pts.forEach(p => a = Math.max(a, Math.hypot(p[0] - cx, p[1] - cy)));
    obs.push({ x: cx, z: -cy, a: a * 1.1, top: b.height || 5 }); });
  if (!obs.length && !(fenceH > 0) && !(neighbors && neighbors.length)) return { pos: [], col: [] };
  const U = 1;
  const spd = (x, z) => { let vx = U * fx, vz = U * fz;
    for (const o of obs) { const dx = x - o.x, dz = z - o.z, X = dx * fx + dz * fz, Y = dx * px + dz * pz, r2 = X * X + Y * Y;
      if (r2 < 1e-3) continue; const a2 = o.a * o.a, dux = -U * a2 * (X * X - Y * Y) / (r2 * r2), duy = -U * 2 * a2 * X * Y / (r2 * r2);
      vx += dux * fx + duy * px; vz += dux * fz + duy * pz; }
    return Math.hypot(vx, vz) / U * fenceShelter(x, z, 0, polyS, fenceH, fx, fz); };
  let mne = 1e9, mxe = -1e9, mnn = 1e9, mxn = -1e9;
  base.forEach(p => { mne = Math.min(mne, p[0]); mxe = Math.max(mxe, p[0]); mnn = Math.min(mnn, p[1]); mxn = Math.max(mxn, p[1]); });
  const step = Math.max(1.2, Math.min(2.5, Math.max(mxe - mne, mxn - mnn) / 26));
  const CALM = [0.30, 0.55, 0.90], WINDY = [0.90, 0.40, 0.24], pos = [], col = [], y = 0.13;
  for (let e = mne; e < mxe; e += step) for (let nn = mnn; nn < mxn; nn += step) {
    const ce = e + step / 2, cn = nn + step / 2; if (!pointInPoly(ce, cn, base)) continue;
    const s = spd(ce, -cn); let c = null;
    if (s < 0.55) c = CALM; else if (s > 1.3) c = WINDY; else continue;
    const q = [[e, -nn], [e + step, -nn], [e + step, -(nn + step)], [e, -(nn + step)]];
    const tri = (A, B, C) => { [A, B, C].forEach(P => { pos.push(P[0], y, P[1]); col.push(c[0], c[1], c[2]); }); };
    tri(q[0], q[1], q[2]); tri(q[0], q[2], q[3]);
  }
  return { pos, col };
}

// «кометы»: движущийся отрезок линии тока с затуханием прозрачности к хвосту (шейдер) и скруглением
const COMET_K = 16;
const COMET_VS = 'attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const COMET_FS = 'uniform vec3 uColor; uniform float uOpacity; varying float vT; void main(){ float a = pow(1.0 - vT, 1.3) * uOpacity; if (a < 0.01) discard; gl_FragColor = vec4(uColor, a); }';
function updateComet(c) {
  const n = c.n; if (n < 2) return;
  c.phase += c.speed; if (c.phase > n - 1) c.phase -= (n - 1);
  const pos = c.mesh.geometry.attributes.position.array, path = c.path, K = COMET_K;
  for (let i = 0; i < K; i++) {
    let idx = c.phase - i * c.spacing; if (idx < 0) idx = 0; else if (idx > n - 1) idx = n - 1;
    const i0 = Math.floor(idx), f = idx - i0, i1 = Math.min(n - 1, i0 + 1);
    const x = path[i0 * 3] + (path[i1 * 3] - path[i0 * 3]) * f;
    const y = path[i0 * 3 + 1];
    const z = path[i0 * 3 + 2] + (path[i1 * 3 + 2] - path[i0 * 3 + 2]) * f;
    let dxx = path[i1 * 3] - path[i0 * 3], dzz = path[i1 * 3 + 2] - path[i0 * 3 + 2];
    let pxx = -dzz, pzz = dxx; const pl = Math.hypot(pxx, pzz) || 1; pxx /= pl; pzz /= pl;
    const w = c.width * (0.25 + 0.75 * (1 - i / (K - 1)));   // сужение к хвосту (скруглённый вид)
    const o = i * 6;
    pos[o] = x + pxx * w; pos[o + 1] = y; pos[o + 2] = z + pzz * w;
    pos[o + 3] = x - pxx * w; pos[o + 4] = y; pos[o + 5] = z - pzz * w;
  }
  c.mesh.geometry.attributes.position.needsUpdate = true;
  const hi = Math.min(n - 1, Math.round(c.phase)), col = windColor((c.spd[hi] / 1 - 1) / 0.9);
  c.mesh.material.uniforms.uColor.value.setRGB(col[0], col[1], col[2]);
}

export default function Viewport({ utcMs, lat, lon, poly, fenceH, buildings, onBuildings,
  analytics = false, anM1 = 1, anM2 = 12, anDiff = false, year, onAnalyticsStats, windows = [], plotMarkers = [], plantMode = null,
  groundKey = '', groundStyle = 'off', wind = { on: false, dirDeg: 315 }, neighbors = [] }) {
  const mount = useRef(null);
  const api = useRef({});
  const bRef = useRef(buildings); bRef.current = buildings;
  const onRef = useRef(onBuildings); onRef.current = onBuildings;
  const polyRef = useRef(poly); polyRef.current = poly;
  const plantRef = useRef(plantMode); plantRef.current = plantMode;
  const [treeReady, setTreeReady] = useState(false);   // готова ли внешняя GLTF-модель дерева

  // загрузка опциональной CC0-модели дерева (models/tree.glb). Нет файла — тихо остаёмся на ёлках-конусах.
  useEffect(() => {
    let cancelled = false;
    const url = (import.meta.env && import.meta.env.BASE_URL ? import.meta.env.BASE_URL : './') + 'models/tree.glb';
    new GLTFLoader().load(url, gltf => {
      if (cancelled) return;
      if (api.current) api.current.treeModel = gltf.scene;
      setTreeReady(true);
    }, undefined, () => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { const c = mount.current && mount.current.querySelector('canvas'); if (c) c.style.cursor = plantMode ? 'crosshair' : ''; }, [plantMode]);
  // ветер: «кометы» — движущиеся отрезки линий тока со скруглением и затуханием прозрачности к хвосту
  useEffect(() => {
    const a = api.current; if (!a.scene || !a.windGroup) return;
    const g = a.windGroup;
    while (g.children.length) { const c = g.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); g.remove(c); }
    g.visible = !!wind.on;
    a.comets = [];
    if (!wind.on) return;
    const base = (poly && poly.length >= 3) ? poly : [[-12, -12], [12, -12], [12, 12], [-12, 12]];
    const ph = Math.max(...base.map(p => Math.hypot(p[0], p[1])), 12);
    // оверлей зон комфорта: затишье (синий) / продувание (оранжевый)
    const cf = buildWindComfort(wind.dirDeg, base, buildings, fenceH, neighbors);
    if (cf.pos.length) {
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cf.pos, 3));
      cg.setAttribute('color', new THREE.Float32BufferAttribute(cf.col, 3));
      const cmesh = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      cmesh.renderOrder = 1; g.add(cmesh);
    }
    const { lines } = buildStreamlines(wind.dirDeg, base, buildings, ph, fenceH, neighbors);
    const K = COMET_K;
    lines.forEach(ln => {
      const n = ln.pos.length / 3; if (n < 3) return;
      for (let ci = 0; ci < 2; ci++) {              // по 2 кометы на линию → выше частота
        const positions = new Float32Array(K * 2 * 3), aT = new Float32Array(K * 2);
        for (let i = 0; i < K; i++) { aT[i * 2] = i / (K - 1); aT[i * 2 + 1] = i / (K - 1); }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
        const idx = []; for (let i = 0; i < K - 1; i++) { const A = i * 2, B = i * 2 + 1, C = (i + 1) * 2, D = (i + 1) * 2 + 1; idx.push(A, B, C, B, D, C); }
        geo.setIndex(idx);
        const mat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(0.95, 0.8, 0.25) }, uOpacity: { value: 0.95 } },
          vertexShader: COMET_VS, fragmentShader: COMET_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 2; g.add(mesh);
        a.comets.push({ mesh, path: ln.pos, spd: ln.spd, n, phase: (ci * (n / 2) + Math.random() * 4) % (n - 1), speed: 0.9, spacing: 2.75, width: 0.28 });
      }
    });
  }, [wind.on, wind.dirDeg, poly, fenceH, buildings, neighbors]);

  useEffect(() => {
    const el = mount.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const skyDay = makeSkyTexture(true), skyNight = makeSkyTexture(false);
    const plasterTex = makePlasterTexture();
    scene.background = new THREE.Color(0xdfe7f2);    // плоское небо, без облаков и тумана
    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);

    // IBL: мягкое заполняющее освещение и лёгкие отражения от окружения — материалы выглядят
    // «объёмнее» и реалистичнее. Солнце ниже даёт направленный свет и тени.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // ambient/hemi приглушены, т.к. окружение теперь добавляет заполнение
    const ambient = new THREE.AmbientLight(0xffffff, 0.12); scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a5a3a, 0.16); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera; sc.near = 1; sc.far = SUN_DIST * 2 + 200; sc.left = sc.bottom = -60; sc.right = sc.top = 60;
    sun.shadow.bias = -0.00015; sun.shadow.normalBias = 0.006; sun.shadow.radius = 1;
    scene.add(sun, sun.target);

    // базовая земля — большая и нейтральная под цвет карты OSM (без травы), край за дальней плоскостью камеры → без обрезки
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: 0xeceae3, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(400, 40, 0x3a4a30, 0x3a4a30); grid.material.opacity = 0.25; grid.material.transparent = true; grid.position.y = 0.02; scene.add(grid);
    const sunSphere = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 20), new THREE.MeshBasicMaterial({ color: 0xffd257 })); scene.add(sunSphere);

    // компас-надписи С/Ю/В/З (ось: X=восток, Z=юг, север=-Z)
    const compassSprites = [];
    [['С', 0, -1, '#f85149'], ['Ю', 0, 1, '#eef2f7'], ['В', 1, 0, '#eef2f7'], ['З', -1, 0, '#eef2f7']].forEach(([txt, dx, dz, col]) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
      g.fillStyle = col; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 32, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false })); sp.renderOrder = 900;
      scene.add(sp); compassSprites.push({ sp, dx, dz }); });

    const windGroup = new THREE.Group(); windGroup.visible = false; scene.add(windGroup);   // линии тока ветра

    const dyn = new THREE.Group(); scene.add(dyn);
    const gizmo = new THREE.Group(); scene.add(gizmo);

    const orbit = { az: -0.9, el: 0.6, r: 150, drag: false, px: 0, py: 0 };
    const rc = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const cvs = renderer.domElement;
    const sel = { ci: -1 }; const gd = { on: false };

    function ndc(e) { const r = cvs.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }; }
    function gpoint(e) { rc.setFromCamera(ndc(e), camera); const p = new THREE.Vector3(); return rc.ray.intersectPlane(groundPlane, p) ? p : null; }
    function pickBuilding(e) { rc.setFromCamera(ndc(e), camera); const hs = rc.intersectObjects(dyn.children, true); for (const it of hs) { let o = it.object; while (o) { if (o.userData.ci !== undefined) return o.userData.ci; if (o.userData.plot || o.userData.neighbor) break; o = o.parent; } } return -1; }
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
      const B = plotBasis((polyRef.current && polyRef.current.length >= 3) ? polyRef.current : [[-12, -12], [12, -12], [12, 12], [-12, 12]]);
      gizmo.add(arrow(new THREE.Vector3(B.ux, 0, -B.uy), L, 0xff1f1f, 'tx'));   // вдоль стороны участка
      gizmo.add(arrow(new THREE.Vector3(B.vx, 0, -B.vy), L, 0x1f8bff, 'tz'));   // поперёк участка
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

    const plotB = () => plotBasis((polyRef.current && polyRef.current.length >= 3) ? polyRef.current : [[-12, -12], [12, -12], [12, 12], [-12, 12]]);
    function plant(kind, E, N) {
      const base = (polyRef.current && polyRef.current.length >= 3) ? polyRef.current : [[-12, -12], [12, -12], [12, 12], [-12, 12]];
      const c = clampToPoly([E, N], base), s = kind === 'tree' ? 0.9 : 0.6;
      const pts = [[-s, -s], [s, -s], [s, s], [-s, s]].map(([x, y]) => [c[0] + x, c[1] + y]);
      const obj = kind === 'tree' ? { kind: 'tree', pts, height: 6, roofH: 0, name: 'Дерево' } : { kind: 'bush', pts, height: 1.2, roofH: 0, name: 'Куст' };
      onRef.current && onRef.current([...bRef.current, obj]);
    }
    const down = e => {
      if (plantRef.current) { const gp = gpoint(e); if (gp) plant(plantRef.current, gp.x, -gp.z); e.preventDefault(); return; }
      const g = pickGizmo(e);
      if (sel.ci >= 0 && g) { const bd = bRef.current[sel.ci]; const gp = gpoint(e); const B = plotB();
        let cE = 0, cN = 0; bd.pts.forEach(p => { cE += p[0]; cN += p[1]; }); cE /= bd.pts.length; cN /= bd.pts.length;
        const ue = bd.pts.length === 4 ? bd.pts[1][0] - bd.pts[0][0] : 1, un = bd.pts.length === 4 ? bd.pts[1][1] - bd.pts[0][1] : 0, uL = Math.hypot(ue, un) || 1;
        Object.assign(gd, { on: true, mode: g, name: bd.name, orig: bd.pts.map(p => p.slice()), baseY: bd.baseY || 0, cE, cN, ux: ue / uL, uy: un / uL, B, sE: gp ? gp.x : 0, sN: gp ? -gp.z : 0, sy: e.clientY });
        e.preventDefault(); return; }
      const ci = pickBuilding(e);
      if (ci >= 0) { sel.ci = ci; makeGizmo(); const bd = bRef.current[ci]; const gp = gpoint(e); const B = plotB();
        let cE = 0, cN = 0; bd.pts.forEach(p => { cE += p[0]; cN += p[1]; }); cE /= bd.pts.length; cN /= bd.pts.length;
        Object.assign(gd, { on: true, mode: 'move', name: bd.name, orig: bd.pts.map(p => p.slice()), baseY: bd.baseY || 0, cE, cN, ux: 1, uy: 0, B, sE: gp ? gp.x : 0, sN: gp ? -gp.z : 0, sy: e.clientY });
        e.preventDefault(); return; }
      sel.ci = -1; while (gizmo.children.length) gizmo.remove(gizmo.children[0]);
      orbit.drag = true; orbit.px = e.clientX; orbit.py = e.clientY;
    };
    const move = e => {
      if (gd.on) { const gp = gpoint(e); const E = gp ? gp.x : 0, N = gp ? -gp.z : 0, vx = -gd.uy, vy = gd.ux; let cand = null, baseY;
        if (gd.mode === 'move') { cand = gd.orig.map(p => [p[0] + (E - gd.sE), p[1] + (N - gd.sN)]); }
        else if (gd.mode === 'tx') { const t = (E - gd.sE) * gd.B.ux + (N - gd.sN) * gd.B.uy; cand = gd.orig.map(p => [p[0] + gd.B.ux * t, p[1] + gd.B.uy * t]); }
        else if (gd.mode === 'tz') { const t = (E - gd.sE) * gd.B.vx + (N - gd.sN) * gd.B.vy; cand = gd.orig.map(p => [p[0] + gd.B.vx * t, p[1] + gd.B.vy * t]); }
        else if (gd.mode === 'ty') { baseY = Math.max(0, gd.baseY + (gd.sy - e.clientY) * 0.08); }
        else if (gd.mode === 'rot') { let a = Math.atan2(N - gd.cN, E - gd.cE) - Math.atan2(gd.sN - gd.cN, gd.sE - gd.cE);
          a = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);   // прилипание к шагу 90°
          cand = gd.orig.map(p => rotPt(p, [gd.cE, gd.cN], a)); }
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
    // touch: 1 палец — вращение/перетаскивание, 2 пальца — пинч-зум
    let pinchD = 0;
    const dist2 = e => { const a = e.touches[0], b = e.touches[1]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); };
    const tShim = e => { const t = e.touches[0] || e.changedTouches[0]; return { clientX: t.clientX, clientY: t.clientY, target: e.target, button: 0, preventDefault: () => {} }; };
    const tstart = e => { if (e.touches.length === 2) { pinchD = dist2(e); return; } down(tShim(e)); };
    const tmove = e => { if (e.touches.length === 2) { const d = dist2(e); if (pinchD) { orbit.r *= pinchD / d; orbit.r = Math.max(60, Math.min(500, orbit.r)); } pinchD = d; e.preventDefault(); return; } if (orbit.drag || gd.on) e.preventDefault(); move(tShim(e)); };
    const tend = () => { pinchD = 0; upH(); };
    cvs.addEventListener('touchstart', tstart, { passive: false }); addEventListener('touchmove', tmove, { passive: false }); addEventListener('touchend', tend);
    // удаление выбранного объекта клавишей Delete/Backspace
    const keyH = e => { const t = e.target, tag = t && t.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.ci >= 0) { const i = sel.ci; sel.ci = -1; while (gizmo.children.length) gizmo.remove(gizmo.children[0]);
        onRef.current && onRef.current(bRef.current.filter((_, k) => k !== i)); } };
    addEventListener('keydown', keyH);

    const sizeRef = { w: 1, h: 1 };
    function resize() { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      sizeRef.w = w; sizeRef.h = h; windGroup.children.forEach(o => { if (o.material && o.material.resolution) o.material.resolution.set(w, h); }); }
    resize(); addEventListener('resize', resize);
    let raf; (function loop() { raf = requestAnimationFrame(loop);
      const { az, el: e2, r } = orbit; camera.position.set(r * Math.cos(e2) * Math.sin(az), r * Math.sin(e2), r * Math.cos(e2) * Math.cos(az)); camera.lookAt(0, 6, 0);
      const R = (api.current.plotHalf || 12) + 8 + r * 0.14, csc = Math.max(8, Math.min(22, r * 0.055));
      compassSprites.forEach(c => { c.sp.position.set(c.dx * R, 3, c.dz * R); c.sp.scale.set(csc, csc, 1); });
      if (windGroup.visible && api.current.comets) { for (let i = 0; i < api.current.comets.length; i++) updateComet(api.current.comets[i]); }
      renderer.render(scene, camera); })();

    api.current = { scene, sun, sunSphere, ambient, dyn, sel, makeGizmo, gizmo, grid, skyDay, skyNight, plasterTex, windGroup, comets: [], size: sizeRef, dispose() {
      cancelAnimationFrame(raf); removeEventListener('mousemove', move); removeEventListener('mouseup', upH); removeEventListener('resize', resize); removeEventListener('keydown', keyH); removeEventListener('touchmove', tmove); removeEventListener('touchend', tend);
      if (scene.environment) scene.environment.dispose();
      skyDay.dispose(); skyNight.dispose(); plasterTex.dispose();
      windGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
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
    if (a.sun) { const R = Math.max(20, a.plotHalf + 12); const sc = a.sun.shadow.camera;
      sc.left = sc.bottom = -R; sc.right = sc.top = R;
      sc.near = Math.max(1, SUN_DIST - R - 40); sc.far = SUN_DIST + R + 40;   // узкий диапазон глубины → выше точность → нет зазора
      sc.updateProjectionMatrix(); }
    const shape = new THREE.Shape(); base.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])); shape.closePath();
    const plot = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0x82a860, roughness: 0.95, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
    plot.rotation.x = -Math.PI / 2; plot.position.y = 0.05; plot.receiveShadow = true; plot.userData.plot = true; dyn.add(plot);
    if (fenceH > 0) { const fmat = new THREE.MeshStandardMaterial({ color: 0xcdd1d6, roughness: .85, metalness: 0, side: THREE.DoubleSide });
      for (let i = 0; i < base.length; i++) { const A = base[i], B = base[(i + 1) % base.length]; const ax = A[0], az = -A[1], bx = B[0], bz = -B[1], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 0.05) continue;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len, fenceH), fmat); m.position.set((ax + bx) / 2, fenceH / 2, (az + bz) / 2); m.rotation.y = Math.atan2(-dz, dx); m.castShadow = true; m.receiveShadow = true; dyn.add(m); } }
    const cmat = new THREE.MeshStandardMaterial({ map: a.plasterTex, color: 0xffffff, roughness: 0.85 });
    const rmat = new THREE.MeshStandardMaterial({ color: 0x8f4a34, roughness: 0.75, side: THREE.DoubleSide });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xb08b57, roughness: 0.85 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3c, roughness: 0.8 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x3f8f4a, roughness: 1 });
    const fabricMat = new THREE.MeshStandardMaterial({ color: 0xdcd3bf, roughness: 0.9, side: THREE.DoubleSide });
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xb7a375, roughness: 1 });
    (buildings || []).forEach((bd, ci) => {
      if (!bd.pts || bd.pts.length < 2) return;
      const kind = bd.kind || inferKind(bd.name), by = bd.baseY || 0;
      const tag = m => { m.castShadow = true; m.receiveShadow = true; m.userData.ci = ci; dyn.add(m); return m; };

      if (kind === 'house3d') {
        const p = bd.pts; if (!p || p.length < 4) return;
        let cxl = 0, cyl = 0; p.forEach(q => { cxl += q[0]; cyl += q[1]; }); cxl /= p.length; cyl /= p.length;
        const W = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) || 10;
        const D = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]) || 8;
        const ux = (p[1][0] - p[0][0]) / W, uy = (p[1][1] - p[0][1]) / W;
        // готовая модель строится в своих натуральных размерах; масштабируем под контур.
        // габарит корпуса+кровли: X≈19.7 (осн.объём+пристройка), Z≈13.3, центр по X ≈ 2.7
        const CW = 19.7, CD = 13.3, CX = 2.7;
        const model = buildReadyHouse();
        model.position.x = -CX;                      // центр корпуса → в начало координат
        const pivot = new THREE.Group();
        pivot.add(model);
        pivot.scale.set(W / CW, (bd.height || 3) / 3.0, D / CD);
        pivot.position.set(cxl, by, -cyl);
        pivot.rotation.y = Math.atan2(uy, ux);
        pivot.traverse(o => { if (o.isMesh) o.userData.ci = ci; });
        pivot.userData.ci = ci; dyn.add(pivot);
        return;
      }
      if (kind === 'path') {
        for (let i = 0; i < bd.pts.length - 1; i++) { const A = bd.pts[i], B = bd.pts[i + 1];
          const ax = A[0], az = -A[1], bx = B[0], bz = -B[1], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 0.05) continue;
          const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, bd.width || 1), pathMat);
          m.position.set((ax + bx) / 2, by + 0.07, (az + bz) / 2); m.rotation.y = Math.atan2(-dz, dx); m.receiveShadow = true; m.userData.ci = ci; dyn.add(m); }
        return;
      }
      let cx = 0, cy = 0; bd.pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= bd.pts.length; cy /= bd.pts.length;
      if (kind === 'tree' || kind === 'bush') {
        let rad = 0.8; bd.pts.forEach(p => rad = Math.max(rad, Math.hypot(p[0] - cx, p[1] - cy)));
        const H = bd.height || (kind === 'tree' ? 5 : 1.2);
        if (kind === 'tree') {
          if (a.treeModel) {   // внешняя CC0-модель, если загрузилась
            const m = a.treeModel.clone(true);
            const box = new THREE.Box3().setFromObject(m), size = new THREE.Vector3(); box.getSize(size);
            const s = H / (size.y || 1); m.scale.setScalar(s);
            m.position.set(cx, by - box.min.y * s, -cy); m.rotation.y = ci * 1.3;
            m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.ci = ci; } });
            m.userData.ci = ci; dyn.add(m); return;
          }
          // ель ярусами: ствол + несколько конусов убывающего радиуса (фолбэк)
          const trunkH = H * 0.22;
          const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, trunkH, 8), trunkMat); tr.position.set(cx, by + trunkH / 2, -cy); tag(tr);
          const baseR = Math.max(0.85, rad * 1.05), tiers = 4;
          const crownBottom = by + trunkH * 0.6, crownH = H - trunkH * 0.6, tierH = crownH / tiers * 1.6;
          for (let i = 0; i < tiers; i++) {
            const t = i / tiers;
            const cr = baseR * (1 - t * 0.72);
            const cone = new THREE.Mesh(new THREE.ConeGeometry(cr, tierH, 12), foliageMat);
            cone.position.set(cx, crownBottom + crownH * t + tierH * 0.32, -cy); tag(cone);
          }
        } else { const r = Math.max(0.6, rad); const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), foliageMat); s.position.set(cx, by + r * 0.65, -cy); s.scale.y = 0.7; tag(s); }
        return;
      }
      if ((kind === 'gazebo' || kind === 'canopy' || kind === 'tent') && bd.pts.length === 4) {
        const c = bd.pts, H = bd.height, rh = bd.roofH || 1.5;
        if (kind !== 'tent') c.forEach(p => { const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, H, 8), postMat); pm.position.set(p[0], by + H / 2, -p[1]); tag(pm); });
        if (kind === 'gazebo') { const sh = new THREE.Shape(); c.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])); sh.closePath();
          const fl = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: false }), woodMat); fl.rotation.x = -Math.PI / 2; fl.position.y = by + 0.14; tag(fl); }
        const baseRoofY = kind === 'tent' ? by : by + H, apexY = baseRoofY + rh;
        const apex = new THREE.Vector3(cx, apexY, -cy), pos = [];
        for (let i = 0; i < 4; i++) { const A = c[i], B = c[(i + 1) % 4]; pos.push(A[0], baseRoofY, -A[1], B[0], baseRoofY, -B[1], apex.x, apex.y, apex.z); }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
        tag(new THREE.Mesh(geo, kind === 'tent' ? fabricMat : rmat));
        return;
      }
      // дом / баня / произвольный контур: стены-экструзия + двускатная крыша
      if (bd.pts.length < 3) return;
      const wallMat = kind === 'bath' ? woodMat : cmat;
      const sh = new THREE.Shape(); bd.pts.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])); sh.closePath();
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: bd.height, bevelEnabled: false }), wallMat);
      m.rotation.x = -Math.PI / 2; m.position.y = by; m.castShadow = true; m.receiveShadow = true; m.userData.ci = ci; dyn.add(m);
      const rh = bd.roofH || 0;
      if (bd.pts.length === 4 && rh > 0) { const roof = gableRoofMesh(bd.pts, bd.height, rh, rmat, !!bd.ridge); if (roof) { roof.position.y = by; roof.userData.ci = ci; dyn.add(roof); } }
      addGlazing(dyn, bd.pts, by, bd.height, ci);   // окна и дверь по фасадам
    });
    // соседние здания с карты (OSM) — серые коробки + двускатная/шатровая крыша 1.5 м, отбрасывают тень
    if (neighbors && neighbors.length) {
      const nmat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.9 });
      const nRoof = new THREE.MeshStandardMaterial({ color: 0x7e848c, roughness: 0.85, side: THREE.DoubleSide });
      const RH = 1.5;
      neighbors.forEach(nb => {
        if (!nb.pts || nb.pts.length < 3) return;
        const h = nb.height || 5;
        const sh = new THREE.Shape(); nb.pts.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])); sh.closePath();
        const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }), nmat);
        m.rotation.x = -Math.PI / 2; m.position.y = 0; m.castShadow = true; m.receiveShadow = true; m.userData.neighbor = true; dyn.add(m);
        // крыша по количеству точек: 4 → двускатная, иначе → шатёр к центроиду
        if (nb.pts.length === 4) {
          const roof = gableRoofMesh(nb.pts, h, RH, nRoof, false);
          if (roof) { roof.userData.neighbor = true; dyn.add(roof); }
        } else {
          let cx = 0, cy = 0; nb.pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= nb.pts.length; cy /= nb.pts.length;
          const apex = new THREE.Vector3(cx, h + RH, -cy), pos = [];
          for (let i = 0; i < nb.pts.length; i++) { const A = nb.pts[i], B = nb.pts[(i + 1) % nb.pts.length];
            pos.push(A[0], h, -A[1], B[0], h, -B[1], apex.x, apex.y, apex.z); }
          const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
          const rm = new THREE.Mesh(geo, nRoof); rm.castShadow = true; rm.receiveShadow = true; rm.userData.neighbor = true; dyn.add(rm);
        }
      });
    }
    if (a.sel && a.sel.ci >= 0 && a.sel.ci < (buildings || []).length) a.makeGizmo(); else if (a.gizmo) { while (a.gizmo.children.length) a.gizmo.remove(a.gizmo.children[0]); }
  }, [poly, fenceH, buildings, treeReady, neighbors]);

  // sun update
  useEffect(() => {
    const a = api.current; if (!a.scene) return;
    const p = sunPosition(utcMs, lat, lon), altDeg = p.altitude * 180 / Math.PI, az = compassAz(p.azimuth) * RAD, ca = Math.cos(p.altitude);
    const v = new THREE.Vector3(Math.sin(az) * ca, Math.sin(p.altitude), -Math.cos(az) * ca);
    a.sun.position.copy(v.clone().multiplyScalar(SUN_DIST)); a.sun.target.position.set(0, 0, 0);
    a.sunSphere.position.copy(v.clone().multiplyScalar(SUN_DIST));
    const up = altDeg > 0; a.sun.intensity = up ? (altDeg < 8 ? 1.15 : 2.0) : 0; a.ambient.intensity = up ? 0.1 : 0.04; a.sunSphere.visible = altDeg > -2;
    a.scene.background = new THREE.Color(altDeg <= 0 ? 0x243244 : altDeg < 8 ? 0xb8c6d6 : 0xdfe7f2);
  }, [utcMs, lat, lon]);

  // 3D-аналитика поверхностей
  useEffect(() => {
    const a = api.current; if (!a.scene) return;
    if (a.analyticsGroup) { a.scene.remove(a.analyticsGroup); a.analyticsGroup = null; }
    if (a.grid) a.grid.visible = !analytics;   // прячем сетку сцены, чтобы её линии не просвечивали сквозь слой аналитики
    if (!analytics) return;
    const base = (poly && poly.length >= 3) ? poly : [[-12, -12], [12, -12], [12, 12], [-12, 12]];
    const rc = new THREE.Raycaster(); const occ = a.dyn.children.filter(o => !o.userData.plot);
    // шаги солнца по выбранным месяцам
    let m1 = Math.max(1, Math.min(12, anM1)), m2 = Math.max(1, Math.min(12, anM2)); if (m2 < m1) [m1, m2] = [m2, m1];
    const stepMin = 20, days = []; for (let m = m1 - 1; m <= m2 - 1; m++) { const t = getTimes(localToUTC(year, m, 21, 12, 0, 0), lat, lon), steps = [];
      for (let ms = t.rise; ms <= t.set; ms += stepMin * 60000) { const p = sunPosition(ms, lat, lon), alt = p.altitude * 180 / Math.PI; if (alt > 5) steps.push(sunVec(compassAz(p.azimuth), alt)); } days.push(steps); }
    const nDays = days.length || 1;
    const sampleHours = (origin, normal) => { let sunMin = 0; days.forEach(steps => steps.forEach(v => { if (normal && v.dot(normal) <= 0) return; rc.set(origin, v); rc.far = SUN_DIST; if (!occ.length || rc.intersectObjects(occ, false).length === 0) sunMin += stepMin; })); return sunMin / 60 / nDays; };
    const skyOpen = (origin, normal) => { let open = 0, tot = 0; for (let az = 0; az < 360; az += 45) for (let el = 20; el <= 70; el += 25) { const aa = az * RAD, ee = el * RAD; const v = new THREE.Vector3(Math.sin(aa) * Math.cos(ee), Math.sin(ee), -Math.cos(aa) * Math.cos(ee)); if (normal && v.dot(normal) <= 0) continue; tot++; rc.set(origin, v); rc.far = SUN_DIST; if (!occ.length || rc.intersectObjects(occ, false).length === 0) open++; } return tot ? open / tot : 0; };
    const surfVal = (origin, normal) => { let v = sampleHours(origin, normal); if (anDiff) v += skyOpen(origin, normal) * 2; return v; };
    const up = new THREE.Vector3(0, 1, 0), surfaces = [];
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9; base.forEach(p => { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); });
    const span = Math.max(mxx - mnx, mxy - mny), gs = Math.max(0.7, Math.min(1.6, span / 44)), feather = Math.max(1.2, gs * 1.8);
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

  // маркеры окон (фасады) в 3D — зелёный/красный шар по норме
  useEffect(() => {
    const a = api.current; if (!a.scene) return;
    if (a.winGroup) { a.scene.remove(a.winGroup); a.winGroup = null; }
    if (!windows || !windows.length) return;
    const grp = new THREE.Group();
    windows.forEach(w => { const col = w.ok ? 0x1f9d45 : 0xc0392b;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 12), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
      m.position.set(w.e, 1.5, -w.n); grp.add(m); });
    a.scene.add(grp); a.winGroup = grp;
  }, [windows]);

  // маркеры инсоляции по участку (контрольные точки территории) — зелёный/красный
  useEffect(() => {
    const a = api.current; if (!a.scene) return;
    if (a.plotGroup) { a.scene.remove(a.plotGroup); a.plotGroup = null; }
    if (!plotMarkers || !plotMarkers.length) return;
    const grp = new THREE.Group();
    plotMarkers.forEach(m => { const col = m.ok ? 0x1f9d45 : 0xc0392b;
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 12), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
      s.position.set(m.e, 0.45, -m.n); s.castShadow = false; s.receiveShadow = false; grp.add(s); });
    a.scene.add(grp); a.plotGroup = grp;
  }, [plotMarkers]);

  // реальная карта как текстура земли — сшивка растровых тайлов MapTiler (бесплатный тариф)
  useEffect(() => {
    const a = api.current; if (!a.scene) return;
    const clear = () => { if (a.groundMap) { a.scene.remove(a.groundMap); if (a.groundMap.material.map) a.groundMap.material.map.dispose(); a.groundMap.material.dispose(); a.groundMap.geometry.dispose(); a.groundMap = null; }
      if (a.groundOutline) { a.scene.remove(a.groundOutline); a.groundOutline = null; } };
    clear();
    const key = (groundKey || '').trim();
    if (!groundStyle || groundStyle === 'off' || !key || !poly || poly.length < 3) return;
    const latR = lat * Math.PI / 180, mLat = 110540, mLon = 111320 * Math.cos(latR);
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9; poly.forEach(p => { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); });
    const cE = (mnx + mxx) / 2, cN = (mny + mxy) / 2, spanE = Math.max((mxx - mnx) * 3, 180), spanN = Math.max((mxy - mny) * 3, 180);
    const lonMin = lon + (cE - spanE / 2) / mLon, lonMax = lon + (cE + spanE / 2) / mLon, latMin = lat + (cN - spanN / 2) / mLat, latMax = lat + (cN + spanN / 2) / mLat;
    const lon2tx = (L, z) => Math.floor((L + 180) / 360 * Math.pow(2, z));
    const lat2ty = (D, z) => { const r = D * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); };
    const tx2lon = (x, z) => x / Math.pow(2, z) * 360 - 180;
    const ty2lat = (y, z) => { const n = Math.PI * (1 - 2 * y / Math.pow(2, z)); return Math.atan(Math.sinh(n)) * 180 / Math.PI; };
    let z = 19, xmin, xmax, ymin, ymax;
    for (; z >= 1; z--) { xmin = lon2tx(lonMin, z); xmax = lon2tx(lonMax, z); ymin = lat2ty(latMax, z); ymax = lat2ty(latMin, z);
      if ((xmax - xmin + 1) * (ymax - ymin + 1) <= 36) break; }
    const nx = xmax - xmin + 1, ny = ymax - ymin + 1;
    const TS = 512;                                   // тайлы 512px (retina) → выше резкость
    const cv = document.createElement('canvas'); cv.width = nx * TS; cv.height = ny * TS; const g = cv.getContext('2d');
    // только MapTiler (ключ зашит): basic — дороги/кварталы (512px), satellite — снимок
    const styleUrl = (x, y) => groundStyle === 'streets'
      ? `https://api.maptiler.com/maps/basic-v2/${z}/${x}/${y}@2x.png?key=${encodeURIComponent(key)}`
      : `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}@2x.jpg?key=${encodeURIComponent(key)}`;
    let done = 0, total = nx * ny, cancelled = false;
    const build = () => {
      if (cancelled) return;
      try {
      const left = tx2lon(xmin, z), right = tx2lon(xmax + 1, z), top = ty2lat(ymin, z), bot = ty2lat(ymax + 1, z);
      const lE = (left - lon) * mLon, rE = (right - lon) * mLon, tN = (top - lat) * mLat, bN = (bot - lat) * mLat;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const pos = [lE, 0, -tN, lE, 0, -bN, rE, 0, -bN, lE, 0, -tN, rE, 0, -bN, rE, 0, -tN];
      const uv = [0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1], nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, side: THREE.DoubleSide }));
      m.position.y = 0.06; m.receiveShadow = true; a.scene.add(m); a.groundMap = m;
      const olp = poly.concat([poly[0]]).map(p => new THREE.Vector3(p[0], 0.1, -p[1]));
      const ol = new THREE.Line(new THREE.BufferGeometry().setFromPoints(olp), new THREE.LineBasicMaterial({ color: 0xffd257, toneMapped: false }));
      a.scene.add(ol); a.groundOutline = ol;
      } catch (e) { /* тайлы без CORS «портят» канвас — оставляем нейтральную землю */ }
    };
    for (let x = xmin; x <= xmax; x++) for (let y = ymin; y <= ymax; y++) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      const ox = (x - xmin) * TS, oy = (y - ymin) * TS;
      img.onload = () => { g.drawImage(img, ox, oy, TS, TS); if (++done === total) build(); };
      img.onerror = () => { if (++done === total) build(); };
      img.src = styleUrl(x, y);
    }
    return () => { cancelled = true; };
  }, [groundKey, groundStyle, poly, lat, lon]);

  return <div ref={mount} style={{ position: 'absolute', inset: 0 }} />;
}
