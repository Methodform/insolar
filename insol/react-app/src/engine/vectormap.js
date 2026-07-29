// Плоская векторная карта из OpenStreetMap (Overpass) для «пола» вьюпорта.
// Рисуем дороги/здания/воду/зелёнку на canvas в локальных метрах вокруг участка — легально (ODbL),
// без чужих тайл-серверов и без сшивки коммерческих тайлов. Атрибуция «© OpenStreetMap» обязательна.

const M_LAT = 110540;
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
async function overpass(q) {
  let last;
  for (const url of OVERPASS) {
    try { const r = await fetch(url, { method: 'POST', body: q }); if (r.ok) return await r.json(); last = new Error(r.status + ''); }
    catch (e) { last = e; }
  }
  throw new Error('Overpass занят' + (last ? ' (' + last.message + ')' : ''));
}

// lat0/lon0 — центр участка, halfM — половина стороны квадрата карты (м), px — размер canvas
export async function fetchVectorMap(lat0, lon0, halfM = 250, px = 2048) {
  if (!isFinite(lat0) || !isFinite(lon0) || (Math.abs(lat0) < 0.2 && Math.abs(lon0) < 0.2))
    throw new Error('нет реальных координат участка');
  const mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  const s = lat0 - halfM / M_LAT, n = lat0 + halfM / M_LAT, w = lon0 - halfM / mLon, e = lon0 + halfM / mLon;
  const q = `[out:json][timeout:25];(` +
    `way["highway"](${s},${w},${n},${e});` +
    `way["building"](${s},${w},${n},${e});` +
    `way["natural"="water"](${s},${w},${n},${e});` +
    `way["waterway"](${s},${w},${n},${e});` +
    `way["landuse"](${s},${w},${n},${e});` +
    `way["leisure"](${s},${w},${n},${e});` +
    `);out geom;`;
  const d = await overpass(q);

  const sc = px / (2 * halfM);
  const X = lo => ((lo - lon0) * mLon + halfM) * sc;
  const Y = la => (halfM - (la - lat0) * M_LAT) * sc;

  const cv = document.createElement('canvas'); cv.width = cv.height = px;
  const g = cv.getContext('2d');
  g.fillStyle = '#d9d4c4'; g.fillRect(0, 0, px, px);           // фон (земля) — заметно темнее, чтобы дороги читались

  const ways = (d.elements || []).filter(el => el.type === 'way' && el.geometry && el.geometry.length > 1);
  const path = geom => { g.beginPath(); geom.forEach((p, i) => { const x = X(p.lon), y = Y(p.lat); i ? g.lineTo(x, y) : g.moveTo(x, y); }); };
  const closed = w2 => { const t = w2.tags || {}; return t.building || t.landuse || t.leisure || t.natural === 'water' || (t.waterway && (t.area === 'yes')); };

  // 1) зелёнка/земле­пользование (полигоны)
  ways.filter(w2 => (w2.tags.landuse || w2.tags.leisure) && closed(w2)).forEach(w2 => {
    const t = w2.tags, k = t.leisure || t.landuse;
    let c = '#d2ccba';
    if (/park|garden|grass|meadow|recreation_ground|village_green|pitch|playground|golf|forest|wood|nature_reserve/.test(k)) c = /forest|wood/.test(k) ? '#93c86f' : '#b3db8c';
    else if (/farmland|farmyard|orchard|vineyard/.test(k)) c = '#e3d5a8';
    else if (/residential/.test(k)) c = '#dcd6c6';
    else if (/industrial|commercial|retail/.test(k)) c = '#d3ccc2';
    g.fillStyle = c; path(w2.geometry); g.closePath(); g.fill();
  });
  // 2) вода
  ways.filter(w2 => w2.tags.natural === 'water' || (w2.tags.waterway && closed(w2))).forEach(w2 => {
    g.fillStyle = '#6fbce0'; path(w2.geometry); g.closePath(); g.fill();
  });
  // 3) водные линии (реки/ручьи)
  ways.filter(w2 => w2.tags.waterway && !closed(w2)).forEach(w2 => {
    g.strokeStyle = '#6fbce0'; g.lineWidth = 3 * sc; g.lineJoin = g.lineCap = 'round'; path(w2.geometry); g.stroke();
  });
  // 4) дороги (обводка + линия)
  const roadW = t => {
    const h = t.highway;
    if (/motorway|trunk|primary/.test(h)) return 7;
    if (/secondary|tertiary/.test(h)) return 5.5;
    if (/residential|unclassified|living_street|road/.test(h)) return 4;
    if (/service/.test(h)) return 2.6;
    return 1.4;                                              // footway/path/track
  };
  const roads = ways.filter(w2 => w2.tags.highway);
  g.lineJoin = g.lineCap = 'round';
  roads.forEach(w2 => { g.strokeStyle = '#8c8674'; g.lineWidth = (roadW(w2.tags) + 2.2) * sc; path(w2.geometry); g.stroke(); }); // тёмная окантовка
  roads.forEach(w2 => {
    const h = w2.tags.highway; const minor = /footway|path|track|steps|cycleway|pedestrian/.test(h);
    g.strokeStyle = /motorway|trunk|primary/.test(h) ? '#f4c65e' : '#ffffff';
    if (minor) { g.strokeStyle = '#aca384'; g.setLineDash([6 * sc, 5 * sc]); } else g.setLineDash([]);
    g.lineWidth = roadW(w2.tags) * sc; path(w2.geometry); g.stroke();
  });
  g.setLineDash([]);
  // 5) здания
  ways.filter(w2 => w2.tags.building).forEach(w2 => {
    g.fillStyle = '#c7bda4'; g.strokeStyle = '#968c74'; g.lineWidth = 1.2 * sc;
    path(w2.geometry); g.closePath(); g.fill(); g.stroke();
  });

  return { canvas: cv, halfM };
}
