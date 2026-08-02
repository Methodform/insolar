// Визуализация потока ветра (для MapView) — расчёт линий тока и зон комфорта
// с учётом построек, забора (проницаемый барьер) и соседних зданий.
// Координаты: локальные метры; сцена x=восток, z=-север. Копия логики из Viewport.
import { pointInPoly } from './astronomy.js';

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
// забор — проницаемый барьер: гасит скорость у земли с подветренной стороны, ветер идёт поверх
function fenceShelter(x, z, y, polyS, fenceH, fx, fz) {
  if (!(fenceH > 0) || y >= fenceH) return 1;
  const shelterLen = fenceH * 7;
  const du = rayExitDist(x, z, -fx, -fz, polyS);
  if (!isFinite(du) || du >= shelterLen) return 1;
  const k = 1 - du / shelterLen, hf = 1 - y / fenceH;
  return 1 - 0.85 * k * hf;
}
function collectObs(buildings, neighbors) {
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
  return obs;
}

export function buildStreamlines(dirDeg, base, buildings, plotHalf, fenceH, neighbors) {
  const flowA = (dirDeg + 180) * Math.PI / 180, fx = Math.sin(flowA), fz = -Math.cos(flowA), px = -fz, pz = fx;
  const polyS = base.map(p => [p[0], -p[1]]);
  const obs = collectObs(buildings, neighbors);
  const maxH = obs.length ? Math.max(3, ...obs.map(o => o.top)) : 6;
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
  const R = plotHalf + 14, N = 200, ds = (2 * R) / N, spread = plotHalf + 1;
  const L = Math.max(2, Math.min(4, Math.round(maxH / 3))), M = 13, lines = [];
  for (let l = 0; l < L; l++) {
    const y = 1.4 + (maxH - 1.4) * (L === 1 ? 0 : l / (L - 1));
    for (let mi = 0; mi < M; mi++) {
      const t = (mi / (M - 1)) * 2 - 1; let x = -fx * R + px * t * spread, z = -fz * R + pz * t * spread;
      const pos = [], spd = [];
      for (let s = 0; s < N; s++) {
        for (const o of obs) { if (y > o.top) continue; const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz) || 1e-6; if (d < o.a) { x = o.x + dx / d * o.a; z = o.z + dz / d * o.a; } }
        const [vx, vz] = vel(x, z, y); const sp = Math.hypot(vx, vz) || 1e-6;
        if (inside(x, z)) { pos.push(x, y, z); spd.push(sp); }
        x += vx / sp * ds; z += vz / sp * ds;
      }
      if (pos.length >= 6) lines.push({ pos, spd });
    }
  }
  return { lines };
}

export function buildWindComfort(dirDeg, base, buildings, fenceH, neighbors) {
  const flowA = (dirDeg + 180) * Math.PI / 180, fx = Math.sin(flowA), fz = -Math.cos(flowA), px = -fz, pz = fx;
  const polyS = base.map(p => [p[0], -p[1]]);
  const obs = collectObs(buildings, neighbors);
  if (!obs.length && !(fenceH > 0)) return { pos: [], col: [] };
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

// Поле скорости ветра на мелкой сетке над bbox участка — для плавных зон комфорта (текстурой).
// Возвращает { vals:Float32Array(N*N), mne,mxe,mnn,mxn, N } в координатах [восток,север].
export function windSpeedField(dirDeg, base, buildings, fenceH, neighbors, N = 110) {
  const flowA = (dirDeg + 180) * Math.PI / 180, fx = Math.sin(flowA), fz = -Math.cos(flowA), px = -fz, pz = fx;
  const polyS = base.map(p => [p[0], -p[1]]);
  const obs = collectObs(buildings, neighbors);
  const U = 1;
  const spd = (x, z) => { let vx = U * fx, vz = U * fz;
    for (const o of obs) { const dx = x - o.x, dz = z - o.z, X = dx * fx + dz * fz, Y = dx * px + dz * pz, r2 = X * X + Y * Y;
      if (r2 < 1e-3) continue; const a2 = o.a * o.a, dux = -U * a2 * (X * X - Y * Y) / (r2 * r2), duy = -U * 2 * a2 * X * Y / (r2 * r2);
      vx += dux * fx + duy * px; vz += dux * fz + duy * pz; }
    return Math.hypot(vx, vz) / U * fenceShelter(x, z, 0, polyS, fenceH, fx, fz); };
  let mne = 1e9, mxe = -1e9, mnn = 1e9, mxn = -1e9;
  base.forEach(p => { mne = Math.min(mne, p[0]); mxe = Math.max(mxe, p[0]); mnn = Math.min(mnn, p[1]); mxn = Math.max(mxn, p[1]); });
  const padE = (mxe - mne) * 0.12 + 2, padN = (mxn - mnn) * 0.12 + 2; mne -= padE; mxe += padE; mnn -= padN; mxn += padN;
  const vals = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const e = mne + (i + 0.5) / N * (mxe - mne), n = mnn + (j + 0.5) / N * (mxn - mnn);
    vals[j * N + i] = spd(e, -n);
  }
  return { vals, mne, mxe, mnn, mxn, N };
}

const WSTOPS = [[0, [0.96, 0.80, 0.25]], [0.5, [0.95, 0.58, 0.25]], [1, [0.90, 0.26, 0.24]]];
export function windColor(t) { t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < WSTOPS.length; i++) { if (t <= WSTOPS[i][0]) { const a = WSTOPS[i - 1], b = WSTOPS[i], k = (t - a[0]) / ((b[0] - a[0]) || 1);
    return [a[1][0] + (b[1][0] - a[1][0]) * k, a[1][1] + (b[1][1] - a[1][1]) * k, a[1][2] + (b[1][2] - a[1][2]) * k]; } }
  return WSTOPS[WSTOPS.length - 1][1];
}

// «кометы» — движущиеся отрезки линий тока со скруглением и затуханием прозрачности к хвосту.
// Рендер обычным MeshBasicMaterial + вершинные цвета RGBA (без кастомного шейдера — надёжно в общем контексте карты).
export const COMET_K = 16;
export function updateComet(c) {
  const n = c.n; if (n < 2) return;
  c.phase += c.speed; if (c.phase > n - 1) c.phase -= (n - 1);
  const pos = c.mesh.geometry.attributes.position.array, col = c.mesh.geometry.attributes.color.array, path = c.path, K = COMET_K;
  const hi = Math.min(n - 1, Math.round(c.phase)), rgb = windColor((c.spd[hi] / 1 - 1) / 0.9);
  for (let i = 0; i < K; i++) {
    let idx = c.phase - i * c.spacing; if (idx < 0) idx = 0; else if (idx > n - 1) idx = n - 1;
    const i0 = Math.floor(idx), f = idx - i0, i1 = Math.min(n - 1, i0 + 1);
    const x = path[i0 * 3] + (path[i1 * 3] - path[i0 * 3]) * f;
    const y = path[i0 * 3 + 1];
    const z = path[i0 * 3 + 2] + (path[i1 * 3 + 2] - path[i0 * 3 + 2]) * f;
    let dxx = path[i1 * 3] - path[i0 * 3], dzz = path[i1 * 3 + 2] - path[i0 * 3 + 2];
    let pxx = -dzz, pzz = dxx; const pl = Math.hypot(pxx, pzz) || 1; pxx /= pl; pzz /= pl;
    // стрелка на конце: i=0 — остриё, i=1 — «крылья», дальше — сужающийся хвост
    let w;
    if (i === 0) w = c.width * 0.06;
    else if (i === 1) w = c.width * 1.6;
    else w = c.width * (0.18 + 0.55 * (1 - i / (K - 1)));
    const a = Math.pow(1 - i / (K - 1), 1.3);
    const o = i * 6;
    pos[o] = x + pxx * w; pos[o + 1] = y; pos[o + 2] = z + pzz * w;
    pos[o + 3] = x - pxx * w; pos[o + 4] = y; pos[o + 5] = z - pzz * w;
    const co = i * 8;
    col[co] = rgb[0]; col[co + 1] = rgb[1]; col[co + 2] = rgb[2]; col[co + 3] = a;
    col[co + 4] = rgb[0]; col[co + 5] = rgb[1]; col[co + 6] = rgb[2]; col[co + 7] = a;
  }
  c.mesh.geometry.attributes.position.needsUpdate = true;
  c.mesh.geometry.attributes.color.needsUpdate = true;
}
