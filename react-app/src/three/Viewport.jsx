import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { sunPosition, compassAz, RAD } from '../engine/astronomy.js';

const SUN_DIST = 400;

export default function Viewport({ utcMs, lat, lon, poly, fenceH }) {
  const mount = useRef(null);
  const api = useRef({});

  // init once
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
    const sc = sun.shadow.camera; sc.near = 1; sc.far = SUN_DIST * 2 + 200; sc.left = sc.bottom = -80; sc.right = sc.top = 80;
    sun.shadow.bias = -0.0001; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    scene.add(sun, sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshStandardMaterial({ color: 0x5a7043, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(400, 40, 0x3a4a30, 0x3a4a30);
    grid.material.opacity = 0.25; grid.material.transparent = true; grid.position.y = 0.02; scene.add(grid);

    const sunSphere = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 20), new THREE.MeshBasicMaterial({ color: 0xffd257 }));
    scene.add(sunSphere);

    const dyn = new THREE.Group(); scene.add(dyn); // участок/забор

    // орбита
    const orbit = { az: -0.9, el: 0.6, r: 150, drag: false, px: 0, py: 0 };
    const cvs = renderer.domElement;
    const down = e => { orbit.drag = true; orbit.px = e.clientX; orbit.py = e.clientY; };
    const move = e => { if (!orbit.drag) return; orbit.az -= (e.clientX - orbit.px) * 0.006; orbit.el += (e.clientY - orbit.py) * 0.006; orbit.el = Math.max(0.08, Math.min(1.5, orbit.el)); orbit.px = e.clientX; orbit.py = e.clientY; };
    const up = () => orbit.drag = false;
    cvs.addEventListener('mousedown', down); addEventListener('mousemove', move); addEventListener('mouseup', up);
    cvs.addEventListener('wheel', e => { orbit.r *= (1 + Math.sign(e.deltaY) * 0.08); orbit.r = Math.max(60, Math.min(500, orbit.r)); e.preventDefault(); }, { passive: false });

    function resize() { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    resize(); addEventListener('resize', resize);

    let raf;
    function loop() {
      raf = requestAnimationFrame(loop);
      const { az, el: e2, r } = orbit;
      camera.position.set(r * Math.cos(e2) * Math.sin(az), r * Math.sin(e2), r * Math.cos(e2) * Math.cos(az));
      camera.lookAt(0, 6, 0);
      renderer.render(scene, camera);
    }
    loop();

    api.current = { scene, sun, sunSphere, ambient, hemi, dyn, THREE, renderer, dispose() {
      cancelAnimationFrame(raf); removeEventListener('mousemove', move); removeEventListener('mouseup', up); removeEventListener('resize', resize);
      renderer.dispose(); el.removeChild(renderer.domElement);
    } };
    return () => api.current.dispose();
  }, []);

  // rebuild plot + fence when geometry changes
  useEffect(() => {
    const a = api.current; if (!a.scene) return;
    const dyn = a.dyn; while (dyn.children.length) dyn.remove(dyn.children[0]);
    const base = (poly && poly.length >= 3) ? poly : [[-12,-12],[12,-12],[12,12],[-12,12]];
    const shape = new THREE.Shape();
    base.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])); shape.closePath();
    const plot = new THREE.Mesh(new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({ color: 0xf5c451, roughness: 0.85, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    plot.rotation.x = -Math.PI / 2; plot.position.y = 0.05; plot.receiveShadow = true; dyn.add(plot);
    if (fenceH > 0) {
      const fmat = new THREE.MeshStandardMaterial({ color: 0x8a7d5a, roughness: .95 });
      for (let i = 0; i < base.length; i++) {
        const A = base[i], B = base[(i + 1) % base.length];
        const ax = A[0], az = -A[1], bx = B[0], bz = -B[1], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, fenceH, 0.12), fmat);
        m.position.set((ax + bx) / 2, fenceH / 2, (az + bz) / 2); m.rotation.y = Math.atan2(-dz, dx);
        m.castShadow = true; m.receiveShadow = true; dyn.add(m);
      }
    }
  }, [poly, fenceH]);

  // update sun each time/coords change
  useEffect(() => {
    const a = api.current; if (!a.scene) return;
    const p = sunPosition(utcMs, lat, lon), altDeg = p.altitude * 180 / Math.PI, az = compassAz(p.azimuth) * RAD, ca = Math.cos(p.altitude);
    const v = new THREE.Vector3(Math.sin(az) * ca, Math.sin(p.altitude), -Math.cos(az) * ca);
    a.sun.position.copy(v.clone().multiplyScalar(SUN_DIST)); a.sun.target.position.set(0, 0, 0);
    a.sunSphere.position.copy(v.clone().multiplyScalar(SUN_DIST));
    const up = altDeg > 0;
    a.sun.intensity = up ? (altDeg < 8 ? 0.9 : 1.5) : 0; a.ambient.intensity = up ? 0.3 : 0.12;
    a.sunSphere.visible = altDeg > -2;
    const top = altDeg <= 0 ? 0x11161f : altDeg < 8 ? 0x6a80a0 : 0x9fc0e8;
    a.scene.background.setHex(top); a.scene.fog.color.setHex(top);
  }, [utcMs, lat, lon]);

  return <div ref={mount} style={{ position: 'absolute', inset: 0 }} />;
}
