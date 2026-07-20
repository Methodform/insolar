// Cloudflare Worker — прокси к НСПД: участок по кадастровому номеру → точки WGS84.
// Обходит CORS и анти-бот (запрос идёт с сервера, не из браузера).
// Деплой: см. README.md рядом.

const NSPD = 'https://nspd.gov.ru/api/geoportal/v2/search/geoportal';

// нормализация кад. номера: убрать ведущие нули в сегментах (кроме зон с точкой)
function clearCode(code) {
  code = (code || '').trim();
  if (/^\d+(:\d+)/.test(code) && !code.includes('.')) {
    return code.split(':').map(x => x.replace(/^0+/, '') || '0').join(':');
  }
  return code;
}

// обратная сферическая проекция Web-Mercator (EPSG:3857) → градусы
const x2lon = x => x / (Math.PI / 180) / 6378137;
const y2lat = y => (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) / (Math.PI / 180);
const ringToLatLon = ring => ring.map(([x, y]) => [y2lat(y), x2lon(x)]);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': '*' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const code = new URL(req.url).searchParams.get('code');
    if (!code) return json({ ok: false, error: 'Не указан кадастровый номер (?code=)' }, 400);

    const q = clearCode(code);
    const target = `${NSPD}?thematicSearchId=1&query=${encodeURIComponent(q)}&CRS=EPSG:4326`;

    let data;
    try {
      const r = await fetch(target, { headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://nspd.gov.ru/map',
      } });
      if (!r.ok) return json({ ok: false, error: `НСПД ответил ${r.status}` }, 502);
      data = await r.json();
    } catch (e) { return json({ ok: false, error: 'Не удалось связаться с НСПД: ' + e }, 502); }

    const feats = (data && data.data && data.data.features) || [];
    if (!feats.length) return json({ ok: false, error: 'Участок не найден' }, 404);

    const f = feats[0], g = f.geometry || {};
    let outer = null;
    if (g.type === 'Polygon') outer = g.coordinates[0];
    else if (g.type === 'MultiPolygon') outer = g.coordinates[0] && g.coordinates[0][0];
    if (!outer || outer.length < 3) return json({ ok: false, error: 'У участка нет геометрии' }, 404);

    let pts = ringToLatLon(outer);
    // убрать дублирующую замыкающую точку
    if (pts.length > 1) { const a = pts[0], b = pts[pts.length - 1]; if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts = pts.slice(0, -1); }

    const p = f.properties || {}, opt = p.options || {};
    return json({ ok: true, code: q, points: pts, label: opt.cad_num || q, area: opt.specified_area || opt.land_record_area || null });
  }
};
