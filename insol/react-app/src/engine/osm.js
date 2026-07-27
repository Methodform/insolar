// Соседние здания с карты OpenStreetMap (Overpass API).
// Возвращает постройки в локальных координатах участка [east, north], метры, с оценкой высоты.
// Overpass отдаёт CORS — работает из браузера. На своём сервере лучше проксировать (лимиты/кэш).

const M_LAT = 110540;

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
function distPolyPoly(A, B) {
  let m = 1e9;
  for (const p of A) for (let i = 0; i < B.length; i++) { const a = B[i], b = B[(i + 1) % B.length]; m = Math.min(m, distToSeg(p[0], p[1], a[0], a[1], b[0], b[1])); }
  return m;
}

// lat0/lon0 — центр участка (реальные координаты), localPoly — [[east,north]...] из parsePoly, radius — м
export async function fetchNeighbors(lat0, lon0, localPoly, radius = 20) {
  if (!isFinite(lat0) || !isFinite(lon0) || (Math.abs(lat0) < 0.2 && Math.abs(lon0) < 0.2))
    throw new Error('нет реальных координат участка');
  const mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
  localPoly.forEach(p => { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mnz = Math.min(mnz, p[1]); mxz = Math.max(mxz, p[1]); });
  const pad = radius + 20;
  const w = lon0 + (mnx - pad) / mLon, e = lon0 + (mxx + pad) / mLon;
  const s = lat0 + (mnz - pad) / M_LAT, n = lat0 + (mxz + pad) / M_LAT;
  const q = `[out:json][timeout:25];(way["building"](${s},${w},${n},${e});relation["building"](${s},${w},${n},${e}););out geom 300;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q });
  if (!r.ok) throw new Error('overpass ' + r.status);
  const d = await r.json();
  const toXZ = (la, lo) => [(lo - lon0) * mLon, (la - lat0) * M_LAT];
  const raw = [];
  for (const el of (d.elements || [])) {
    if (el.type === 'way' && el.geometry) raw.push({ geom: el.geometry, tags: el.tags || {} });
    else if (el.type === 'relation' && el.members) el.members.forEach(mm => { if (mm.geometry && mm.role === 'outer') raw.push({ geom: mm.geometry, tags: el.tags || {} }); });
  }
  const out = [];
  for (const b of raw) {
    const pts = b.geom.map(g => toXZ(g.lat, g.lon));
    if (pts.length < 3) continue;
    if (distPolyPoly(pts, localPoly) > radius) continue;      // только в пределах radius от границы участка
    let h = 5; const t = b.tags;
    if (t.height) h = parseFloat(t.height) || 5;
    else if (t['building:levels']) h = (parseFloat(t['building:levels']) || 2) * 3;
    out.push({ pts, height: Math.max(2.5, Math.min(30, h)) });
  }
  return out;
}
