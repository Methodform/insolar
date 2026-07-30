// Роза ветров: климат-данные Open-Meteo (бесплатно, без ключа, CORS ок).
// Тянем почасовые направление/скорость ветра за N лет, агрегируем в 8 секторов по сезонам.
// Модельно: климатическая частота направлений, не прогноз.

export const WIND_DIRS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ']; // 8 секторов, по часовой от севера
export const SEASON_LABELS = { winter: 'Зима', spring: 'Весна', summer: 'Лето', autumn: 'Осень', year: 'Год' };

function seasonOf(month) { // month 1..12
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Возвращает { dirs, seasons: { winter|spring|summer|autumn|year: { freq[8], meanSpd[8], calm, maxFreq, avgSpd } } }
export async function fetchWindRose(lat, lon, years = 2) {
  const end = new Date(Date.now() - 7 * 86400000);           // архив с задержкой ~5 дней
  const start = new Date(end.getTime() - years * 365 * 86400000);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start_date=${iso(start)}&end_date=${iso(end)}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('archive http ' + r.status);
  const d = await r.json();
  const h = d && d.hourly;
  if (!h || !h.time || !h.wind_direction_10m) throw new Error('нет данных ветра');
  const times = h.time, dir = h.wind_direction_10m, spd = h.wind_speed_10m || [];

  const mk = () => ({ count: new Array(8).fill(0), spdSum: new Array(8).fill(0), total: 0, calm: 0, spdAll: 0 });
  const acc = { winter: mk(), spring: mk(), summer: mk(), autumn: mk(), year: mk() };
  const macc = Array.from({ length: 12 }, mk);               // помесячно (0=январь … 11=декабрь)

  for (let i = 0; i < times.length; i++) {
    const wd = dir[i], ws = spd[i];
    if (wd == null || isNaN(wd)) continue;
    const mo = parseInt(times[i].slice(5, 7), 10);
    const sec = Math.round(((wd % 360) + 360) % 360 / 45) % 8;   // 0=С,1=СВ,...
    for (const a of [acc[seasonOf(mo)], acc.year, macc[mo - 1]]) {
      a.total++;
      if (ws != null && !isNaN(ws)) {
        a.spdAll += ws;
        if (ws < 1) a.calm++;                    // штиль < 1 м/с
        a.count[sec]++; a.spdSum[sec] += ws;
      } else a.count[sec]++;
    }
  }

  const finalize = a => {
    const freq = a.count.map(c => a.total ? c / a.total : 0);
    const meanSpd = a.count.map((c, i) => c ? a.spdSum[i] / c : 0);
    return {
      freq, meanSpd,
      maxFreq: Math.max(0.001, ...freq),
      calm: a.total ? a.calm / a.total : 0,
      avgSpd: a.total ? a.spdAll / a.total : 0,
    };
  };
  return {
    dirs: WIND_DIRS,
    period: `${iso(start)} — ${iso(end)}`,
    seasons: {
      winter: finalize(acc.winter), spring: finalize(acc.spring),
      summer: finalize(acc.summer), autumn: finalize(acc.autumn), year: finalize(acc.year),
    },
    months: macc.map(finalize),               // 12 роз ветров: [январь … декабрь]
  };
}

// текущий ветер «сейчас» — прогнозный эндпоинт Open-Meteo (ближайший час, сетка ~11 км).
// Возвращает { dirDeg (откуда дует, °), speed (м/с), time (ISO) }. Не датчик на участке — ближайший узел прогноза.
export async function fetchWindNow(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('forecast http ' + r.status);
  const d = await r.json();
  const c = d && d.current;
  if (!c || c.wind_direction_10m == null) throw new Error('нет данных о текущем ветре');
  return { dirDeg: ((c.wind_direction_10m % 360) + 360) % 360, speed: c.wind_speed_10m, time: c.time };
}

// доминирующее направление сезона (индекс сектора с макс частотой)
export function prevailingDir(season) {
  let mi = 0; season.freq.forEach((f, i) => { if (f > season.freq[mi]) mi = i; });
  return { index: mi, dir: WIND_DIRS[mi], freq: season.freq[mi] };
}

// плавное преобладающее направление (°, «откуда дует») — круговое среднее по 8 секторам,
// чтобы по месяцам направление менялось непрерывно, а не снапилось к 8 сторонам
export function meanDir(rose) {
  let sx = 0, sy = 0;
  (rose.freq || []).forEach((f, i) => { const a = i * 45 * Math.PI / 180; sx += f * Math.sin(a); sy += f * Math.cos(a); });
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return prevailingDir(rose).index * 45;
  return ((Math.atan2(sx, sy) * 180 / Math.PI) % 360 + 360) % 360;
}
