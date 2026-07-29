// Соседние здания с карты OpenStreetMap (Overpass API).
// Возвращает постройки в локальных координатах участка [east, north], метры, с оценкой высоты.
// Overpass отдаёт CORS — работает из браузера. На своём сервере лучше проксировать (лимиты/кэш).

const M_LAT = 110540;

// зеркала Overpass: публичный сервер часто отдаёт 504/429 под нагрузкой — перебираем с повтором
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
async function overpass(q) {
  let lastErr;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(url, { method: 'POST', body: q });
      if (r.ok) return await r.json();
      lastErr = new Error(r.status + '');
    } catch (e) { lastErr = e; }
  }
  throw new Error('сервер карт занят, попробуйте ещё раз' + (lastErr ? ' (' + lastErr.message + ')' : ''));
}

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
  const d = await overpass(q);
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

// Плоская векторная карта-схема вокруг участка (для подложки во вьюпорте).
// Возвращает геометрии в локальных метрах [восток,север]: roads (линии), water/green/buildings (полигоны).
const GREEN_LU = /^(grass|forest|meadow|recreation_ground|village_green|farmland|orchard|cemetery|allotments)$/;
export async function fetchVectorContext(lat0, lon0, radius = 250) {
  if (!isFinite(lat0) || !isFinite(lon0) || (Math.abs(lat0) < 0.2 && Math.abs(lon0) < 0.2))
    throw new Error('нет реальных координат участка');
  const mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  const dLat = radius / M_LAT, dLon = radius / mLon;
  const s = lat0 - dLat, n = lat0 + dLat, w = lon0 - dLon, e = lon0 + dLon;
  const bb = `(${s},${w},${n},${e})`;
  const q = `[out:json][timeout:25];(` +
    `way["highway"]${bb};` +
    `way["natural"="water"]${bb};relation["natural"="water"]${bb};` +
    `way["landuse"]${bb};way["leisure"]${bb};` +
    `way["building"]${bb};relation["building"]${bb};` +
    `);out geom 1200;`;
  const d = await overpass(q);
  const toXZ = (la, lo) => [(lo - lon0) * mLon, (la - lat0) * M_LAT];
  const roads = [], water = [], green = [], buildings = [];
  for (const el of (d.elements || [])) {
    const t = el.tags || {};
    const geoms = el.type === 'way' && el.geometry ? [el.geometry]
      : el.type === 'relation' && el.members ? el.members.filter(m => m.geometry && m.role === 'outer').map(m => m.geometry) : [];
    for (const gm of geoms) {
      const pts = gm.map(p => toXZ(p.lat, p.lon)); if (pts.length < 2) continue;
      if (t.highway) roads.push(pts);
      else if (t.natural === 'water') water.push(pts);
      else if (t.building) buildings.push(pts);
      else if ((t.landuse && GREEN_LU.test(t.landuse)) || (t.leisure && /^(park|garden|pitch|playground|golf_course)$/.test(t.leisure))) green.push(pts);
    }
  }
  return { roads, water, green, buildings };
}
