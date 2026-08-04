import React, { useEffect, useState } from 'react';

// Погода на выбранную дату (Open-Meteo, без ключа): температура, ветер, УФ-индекс.
// Прогноз доступен на ~16 дней вперёд и ~92 дня назад; более старые даты — из архива ERA5.
async function fetchWeather(lat, lon, dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T12:00:00');
  const days = Math.round((d - today) / 86400000);
  const daily = 'temperature_2m_max,temperature_2m_min,wind_speed_10m_max,uv_index_max,weather_code';
  const base = (days >= -92 && days <= 16)
    ? `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&daily=${daily}&wind_speed_unit=ms&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`
    : `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&daily=${daily}&wind_speed_unit=ms&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;
  const r = await fetch(base); if (!r.ok) throw new Error('http ' + r.status);
  const j = await r.json(); const dd = j && j.daily;
  if (!dd || !dd.time || !dd.time.length) throw new Error('no data');
  return {
    tmax: dd.temperature_2m_max ? dd.temperature_2m_max[0] : null,
    tmin: dd.temperature_2m_min ? dd.temperature_2m_min[0] : null,
    wind: dd.wind_speed_10m_max ? dd.wind_speed_10m_max[0] : null,
    uv: dd.uv_index_max ? dd.uv_index_max[0] : null,
    future: days > 16,
  };
}

const uvLabel = v => v == null ? '' : v < 3 ? 'низкий' : v < 6 ? 'умеренный' : v < 8 ? 'высокий' : v < 11 ? 'оч. высокий' : 'экстрем.';

export default function WeatherWidget({ lat, lon, date }) {
  const [w, setW] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!isFinite(lat) || !isFinite(lon) || !date) return;
    let cancelled = false; setW(null); setErr('');
    fetchWeather(lat, lon, date)
      .then(d => { if (!cancelled) setW(d); })
      .catch(() => { if (!cancelled) setErr('нет данных на эту дату'); });
    return () => { cancelled = true; };
  }, [lat, lon, date]);

  const cell = (icon, val, sub) => (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontSize: 15 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{val}</div>
      <div style={{ fontSize: 10, color: 'var(--gray-10)' }}>{sub}</div>
    </div>
  );

  if (err) return <div style={{ fontSize: 12, color: 'var(--gray-10)' }}>Погода: {err}.</div>;
  if (!w) return <div style={{ fontSize: 12, color: 'var(--gray-10)' }}>Погода: загружаю…</div>;

  const t = w.tmax != null ? `${Math.round(w.tmin)}…${Math.round(w.tmax)}°` : '—';
  const wind = w.wind != null ? `${w.wind.toFixed(1)}` : '—';
  const uv = w.uv != null ? `${w.uv.toFixed(1)}` : '—';
  return (
    <div>
      <div style={{ display: 'flex', gap: 6 }}>
        {cell('🌡', t, 'мин…макс')}
        {cell('💨', wind, 'ветер, м/с')}
        {cell('☀️', uv, `УФ · ${uvLabel(w.uv)}`)}
      </div>
      {w.future && <div style={{ fontSize: 10, color: 'var(--gray-9)', marginTop: 3 }}>Дата дальше прогноза (~16 дней) — показан климатический ориентир.</div>}
    </div>
  );
}
