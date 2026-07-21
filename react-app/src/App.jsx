import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Theme, Flex, Box, Card, Heading, Text, Button, TextField, TextArea, Select,
  Slider, Badge, Separator, IconButton, Dialog, Switch } from '@radix-ui/themes';
import { SunIcon, PlayIcon, PauseIcon, PlusIcon, Pencil1Icon, RulerHorizontalIcon,
  TrashIcon, CheckIcon, LockOpen1Icon, LayersIcon, SewingPinFilledIcon,
  FileTextIcon, DownloadIcon, UploadIcon, ResetIcon } from '@radix-ui/react-icons';
import Viewport, { thermalColor } from './three/Viewport.jsx';
import SunPath from './three/SunPath.jsx';
import PlanEditor from './three/PlanEditor.jsx';
import MapView from './three/MapView.jsx';
import ZoneMap from './three/ZoneMap.jsx';
import { sunPosition, getTimes, compassAz, localToUTC, fmtLocal, fmtHours, parsePoly,
  insolationAt, normHours, shadowLen, azToCardinal, reportData, windowsReport } from './engine/astronomy.js';

// URL Cloudflare Worker'а (см. react-app/cadastre-proxy/README.md). Заменить после деплоя:
const CADASTRE_PROXY = '';
// общий ключ MapTiler, встроенный в сборку (GitHub secret → VITE_MAPTILER_KEY). Ограничьте его по домену в MapTiler.
const MAPTILER_KEY = (import.meta.env && import.meta.env.VITE_MAPTILER_KEY) || '';

const DEFAULT_POLY = `53.5859054 49.0883256
53.5858383 49.0889893
53.5856392 49.0889309
53.5857069 49.0882681`;

export default function App() {
  const [themeMode, setThemeMode] = useState('system');
  const [sysDark, setSysDark] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => { if (typeof matchMedia === 'undefined') return; const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = e => setSysDark(e.matches); mq.addEventListener('change', h); return () => mq.removeEventListener('change', h); }, []);
  const appearance = themeMode === 'system' ? (sysDark ? 'dark' : 'light') : themeMode;
  const [polyText, setPolyText] = useState(DEFAULT_POLY);
  const [built, setBuilt] = useState(() => parsePoly(DEFAULT_POLY));
  const [tz, setTz] = useState(4);
  const [fence, setFence] = useState('1.8');
  const [fenceCustom, setFenceCustom] = useState('2');
  const now = new Date();
  const [date, setDate] = useState(() => new Date(now.getTime()+4*3600000).toISOString().slice(0,10));
  const [minutes, setMinutes] = useState(() => { const d=new Date(now.getTime()+4*3600000); return d.getUTCHours()*60+d.getUTCMinutes(); });
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);
  const [buildings, setBuildings] = useState([]);
  const [preset, setPreset] = useState('house|Дом 8×8|8,8,6');
  const [pro, setPro] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapKey, setMapKeyState] = useState(() => { try { return localStorage.getItem('maptiler_key') || MAPTILER_KEY; } catch (e) { return MAPTILER_KEY; } });
  const setMapKey = k => { setMapKeyState(k); try { localStorage.setItem('maptiler_key', k); } catch (e) {} };
  const [ground3d, setGround3d] = useState('streets');  // off | streets — по умолчанию схема включена
  const [keyDraft, setKeyDraft] = useState(() => { try { return localStorage.getItem('maptiler_key') || MAPTILER_KEY; } catch (e) { return MAPTILER_KEY; } });
  const applyKey = () => setMapKey(keyDraft.trim());
  const [analytics, setAnalytics] = useState(false);
  const [anM1, setAnM1] = useState(4);
  const [anM2, setAnM2] = useState(9);
  const [anDiff, setAnDiff] = useState(false);
  const [anStats, setAnStats] = useState(null);
  const [showPlot, setShowPlot] = useState(true);
  const [showWin, setShowWin] = useState(true);
  const [plantMode, setPlantMode] = useState(null);
  const [rp, setRp] = useState({ addr: '', client: '', exec: '' });
  const [plotMode, setPlotMode] = useState('points');
  const [cadCode, setCadCode] = useState('');
  const [cadLoading, setCadLoading] = useState(false);
  const [cadError, setCadError] = useState('');
  const openFile = useRef(null);

  async function fetchCadastre() {
    const code = cadCode.trim();
    if (!code) { setCadError('Введите кадастровый номер'); return; }
    if (!CADASTRE_PROXY) { setCadError('Прокси не настроен: задайте CADASTRE_PROXY (см. cadastre-proxy/README.md)'); return; }
    setCadLoading(true); setCadError('');
    try {
      const r = await fetch(`${CADASTRE_PROXY}?code=${encodeURIComponent(code)}`);
      const d = await r.json();
      if (!d.ok || !Array.isArray(d.points) || d.points.length < 3) { setCadError(d.error || 'Участок не найден'); return; }
      const txt = d.points.map(p => `${p[0].toFixed(7)} ${p[1].toFixed(7)}`).join('\n');
      setPolyText(txt);
      const p = parsePoly(txt);
      if (p) { setBuilt(p); if (p.lon0) setTz(Math.round(p.lon0 / 15)); }
      else setCadError('Не удалось разобрать координаты участка');
    } catch (e) { setCadError('Ошибка запроса к прокси'); }
    finally { setCadLoading(false); }
  }

  function saveProject() {
    const data = { v: 1, app: 'insolar', polyText, tz, fence, fenceCustom, buildings, date, minutes, report: rp };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'insolar-project.json';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }
  function loadProject(file) {
    const rd = new FileReader();
    rd.onload = () => { try { const d = JSON.parse(rd.result);
      if (d.polyText !== undefined) { setPolyText(d.polyText); setBuilt(parsePoly(d.polyText)); }
      if (d.tz !== undefined) setTz(d.tz); if (d.fence !== undefined) setFence(String(d.fence)); if (d.fenceCustom !== undefined) setFenceCustom(String(d.fenceCustom));
      if (Array.isArray(d.buildings)) setBuildings(d.buildings);
      if (d.date) setDate(d.date); if (d.minutes !== undefined) setMinutes(d.minutes);
      if (d.report) setRp(d.report);
    } catch (e) { alert('Не удалось открыть файл проекта'); } };
    rd.readAsText(file);
  }
  function openReport() {
    if (!poly) { alert('Сначала постройте участок'); return; }
    const d = reportData(poly, buildings, lat, lon, tz, y);
    const esc = s => (s || '—').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const rows = d.rows.map(r => `<tr><td>${r.i}</td><td>${r.e}; ${r.n}</td><td>${r.sun.toFixed(1)}</td><td>${r.cont.toFixed(1)}</td><td class="${r.ok ? 'ok' : 'no'}">${r.ok ? 'соответствует' : 'не соответствует'}</td></tr>`).join('');
    const verdict = d.okc === d.n ? `Все ${d.n} контрольных точек обеспечены нормируемой инсоляцией (≥ ${d.z.hours} ч). Требования выполняются.` : `Норму (≥ ${d.z.hours} ч) обеспечивают ${d.okc} из ${d.n} точек (${Math.round(d.okc / d.n * 100)} %).`;
    const today = new Date().toLocaleDateString('ru-RU');
    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Отчёт об инсоляции</title><style>
@page{size:A4;margin:18mm 16mm}body{font-family:'Times New Roman',Georgia,serif;color:#111;font-size:12pt;line-height:1.45}
h1{font-size:15pt;text-align:center;margin:0 0 4pt}h2{font-size:12.5pt;border-bottom:1px solid #999;padding-bottom:3pt;margin:16pt 0 6pt}
.sub{text-align:center;color:#444;font-size:10.5pt;margin-bottom:14pt}
table{width:100%;border-collapse:collapse;margin:6pt 0;font-size:11pt}th,td{border:1px solid #888;padding:4pt 6pt;text-align:left}th{background:#eee}
td.ok{color:#1f7d38;font-weight:bold}td.no{color:#c0392b;font-weight:bold}
.kv{border:none}.kv td{border:none;padding:2pt 4pt}.kv td:first-child{color:#555;width:42%}
.verdict{border:1.5px solid #1e5c3d;background:#f1f6f2;padding:8pt 10pt;margin-top:8pt}
.note{font-size:9pt;color:#777;margin-top:16pt}button{padding:8px 14px;border-radius:6px;border:1px solid #1e5c3d;background:#1e5c3d;color:#fff;cursor:pointer}
@media print{.noprint{display:none}}.noprint{position:fixed;top:8px;right:8px}</style></head><body>
<div class="noprint"><button onclick="window.print()">🖨 Печать / PDF</button></div>
<h1>ОТЧЁТ О РАСЧЁТЕ ПРОДОЛЖИТЕЛЬНОСТИ ИНСОЛЯЦИИ</h1>
<div class="sub">Земельный участок · контрольные точки территории</div>
<h2>1. Общие сведения</h2><table class="kv">
<tr><td>Объект (адрес)</td><td>${esc(rp.addr)}</td></tr><tr><td>Заказчик</td><td>${esc(rp.client)}</td></tr>
<tr><td>Исполнитель</td><td>${esc(rp.exec)}</td></tr><tr><td>Дата составления</td><td>${today}</td></tr>
<tr><td>Норматив</td><td>СанПиН 1.2.3685-21</td></tr></table>
<h2>2. Исходные данные</h2><table class="kv">
<tr><td>Координаты центра</td><td>Ш ${lat.toFixed(5)}°, Д ${lon.toFixed(5)}°</td></tr>
<tr><td>Часовой пояс</td><td>UTC${tz>=0?'+':''}${tz}</td></tr><tr><td>Площадь участка</td><td>${d.area.toFixed(1)} м²</td></tr>
<tr><td>Климатическая зона</td><td>${d.z.zone}</td></tr><tr><td>Нормируемый период</td><td>${d.z.period}</td></tr>
<tr><td>Требуемая инсоляция</td><td>не менее ${d.z.hours} ч</td></tr><tr><td>Расчётная дата</td><td>${d.dateStr}</td></tr>
<tr><td>Восход / заход / полдень</td><td>${fmtLocal(d.t.rise,tz)} / ${fmtLocal(d.t.set,tz)} / ${fmtLocal(d.t.noon,tz)}</td></tr>
<tr><td>Высота солнца в полдень</td><td>${d.noonAlt.toFixed(1)}°</td></tr>
<tr><td>Затеняющие объекты</td><td>${buildings.length} зданий${(parseFloat(fence)||0)>0?', забор '+fence+' м':''}</td></tr></table>
<h2>3. Методика</h2><p>Положение Солнца рассчитано по алгоритму Meeus/SunCalc. Для каждой контрольной точки на высоте 1,5 м с шагом 5 минут от восхода до захода проверяется прямой солнечный луч с учётом затенения зданиями (метод теневого полигона). Определяется макс. непрерывная продолжительность инсоляции.</p>
<h2>4. Результаты</h2><table><tr><th>№</th><th>Коорд. E; N, м</th><th>Всего, ч</th><th>Непрерывно, ч</th><th>Соответствие ≥${d.z.hours} ч</th></tr>${rows}</table>
<h2>5. Заключение</h2><div class="verdict">${verdict}</div>
<div class="note">Расчёт носит модельный характер и не заменяет заключение аккредитованной организации и экспертизу проектной документации.</div>
<scr${''}ipt>window.onload=()=>setTimeout(()=>window.print(),400)<\/scr${''}ipt></body></html>`;
    const w = window.open('', '_blank'); if (!w) { alert('Разрешите всплывающие окна'); return; } w.document.write(html); w.document.close();
  }

  const lat = built ? built.lat0 : 55.75, lon = built ? built.lon0 : 37.62;
  const poly = built ? built.local : null;

  function addPreset() {
    const [kind, name, dims] = preset.split('|');
    const [w, d, h] = dims.split(',').map(Number);
    const base = poly && poly.length >= 3 ? poly : [[-12, -12], [12, -12], [12, 12], [-12, 12]];
    // ориентация вдоль самой длинной стороны участка
    let bestLen = -1, ux = 1, uy = 0;
    for (let i = 0; i < base.length; i++) {
      const a = base[i], b = base[(i + 1) % base.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L > bestLen) { bestLen = L; ux = dx / L; uy = dy / L; }
    }
    const vx = -uy, vy = ux;
    let cx = 0, cy = 0; base.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= base.length; cy /= base.length;
    const k = buildings.length; cx += ux * k * 2; cy += uy * k * 2;
    const hw = w / 2, hd = d / 2;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([ex, ey]) => [cx + ux * ex + vx * ey, cy + uy * ex + vy * ey]);
    const roofByKind = { house: 2.5, bath: 2, gazebo: 1.6, canopy: 0.3, tent: 2.6, tree: 0, bush: 0 };
    const roofH = roofByKind[kind] !== undefined ? roofByKind[kind] : 1.5;
    setBuildings(bs => [...bs, { kind, pts: corners, height: h, roofH, name }]);
  }
  const removeBuilding = i => setBuildings(bs => bs.filter((_, k) => k !== i));

  const [y, mo, da] = date.split('-').map(Number);
  const utcMs = localToUTC(y, mo - 1, da, Math.floor(minutes / 60), minutes % 60, tz);

  const pos = useMemo(() => sunPosition(utcMs, lat, lon), [utcMs, lat, lon]);
  const times = useMemo(() => getTimes(localToUTC(y, mo - 1, da, 12, 0, tz), lat, lon), [y, mo, da, tz, lat, lon]);
  const altDeg = pos.altitude * 180 / Math.PI, azDeg = compassAz(pos.azimuth);
  const dayLen = times.polarDay ? 24 : times.polarNight ? 0 : (times.set - times.rise) / 3600000;
  const noonAlt = sunPosition(times.noon, lat, lon).altitude * 180 / Math.PI;

  const dayMs = localToUTC(y, mo - 1, da, 12, 0, tz);
  const insol = useMemo(() => insolationAt([0, 0], buildings, dayMs, lat, lon), [buildings, dayMs, lat, lon]);
  const reqH = normHours(lat);
  const plotReport = useMemo(() => reportData(poly, buildings, lat, lon, tz, y), [poly, buildings, lat, lon, tz, y]);
  const winReport = useMemo(() => windowsReport(buildings, lat, lon, tz, y), [buildings, lat, lon, tz, y]);
  const shadowAz = (azDeg + 180) % 360;
  const fmtLen = L => !isFinite(L) ? '∞' : L >= 1000 ? '>1 км' : L.toFixed(1) + ' м';
  const fenceH = fence === 'custom' ? (parseFloat(fenceCustom) || 0) : (parseFloat(fence) || 0);

  useEffect(() => {
    if (!playing) { clearInterval(timer.current); return; }
    timer.current = setInterval(() => {
      const d = new Date(Date.now() + tz * 3600000);
      setDate(d.toISOString().slice(0, 10));
      setMinutes(d.getUTCHours() * 60 + d.getUTCMinutes());
    }, 1000);
    return () => clearInterval(timer.current);
  }, [playing, tz]);

  function setNow() {
    const d = new Date(Date.now() + tz * 3600000);
    setDate(d.toISOString().slice(0, 10)); setMinutes(d.getUTCHours() * 60 + d.getUTCMinutes());
  }
  // бесплатно доступна только сегодняшняя дата — фиксируем её, когда Pro выключен
  useEffect(() => { if (!pro) { const d = new Date(Date.now() + tz * 3600000); setDate(d.toISOString().slice(0, 10)); } }, [pro, tz]);
  function build() { const p = parsePoly(polyText); if (!p) { alert('Нужно минимум 3 точки: широта долгота'); return; } setBuilt(p); if (p.lon0) setTz(Math.round(p.lon0 / 15)); }

  const clock = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

  const Stat = ({ k, v, color }) => (
    <Flex justify="between" py="1" style={{ borderBottom: '1px solid var(--gray-a4)' }}>
      <Text size="2" color="gray">{k}</Text><Text size="2" weight="medium" style={color?{color}:undefined}>{v}</Text>
    </Flex>
  );

  return (
    <Theme appearance={appearance} accentColor="grass" grayColor="sage" radius="large" panelBackground="solid">
      <Box style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
        {planOpen && <PlanEditor poly={poly} fenceH={fenceH} buildings={buildings} onBuildings={setBuildings} onClose={() => setPlanOpen(false)} />}
        {mapOpen && <MapView polyText={polyText} onClose={() => setMapOpen(false)} />}
        <Viewport utcMs={utcMs} lat={lat} lon={lon} poly={poly} fenceH={fenceH} buildings={buildings} onBuildings={setBuildings}
          analytics={pro && analytics} anM1={anM1} anM2={anM2} anDiff={anDiff} year={y} onAnalyticsStats={setAnStats}
          plotMarkers={showPlot && !(pro && analytics) ? plotReport.rows : []}
          windows={showWin && !(pro && analytics) ? winReport.rows : []} plantMode={plantMode}
          groundKey={mapKey} groundStyle={ground3d} />

        {/* header */}
        <Flex align="center" gap="3" px="4" py="2" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
          background: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a4)' }}>
          <Heading size="4"><Flex align="center" gap="1"><SunIcon width="20" height="20" /> Инсоляр</Flex></Heading>
          <Text size="2" color="gray">React + Radix · моделирование солнца</Text>
          <Box style={{ flex: 1 }} />
          <Dialog.Root>
            <Dialog.Trigger><Button variant="soft" color="gray"><RulerHorizontalIcon /> Отступы</Button></Dialog.Trigger>
            <Dialog.Content maxWidth="560px">
              <Dialog.Title><Flex align="center" gap="2"><RulerHorizontalIcon /> Нормативные отступы</Flex></Dialog.Title>
              <Dialog.Description size="1" color="gray" mb="2">Ориентировочные минимумы (ИЖС/СНТ). Точные значения — по действующим редакциям СП и местным ПЗЗ.</Dialog.Description>
              <Box style={{ maxHeight: '65vh', overflowY: 'auto' }}>
                {[
                  ['От границы соседнего участка', [['Жилой / садовый дом', '3 м'], ['Гараж (окна к соседу)', '2 м'], ['Баня, хозпостройки (сарай, беседка, теплица, навес)', '1 м'], ['Постройка для скота / птицы', '4 м'], ['Деревья высокие / среднерослые / кустарник', '3 / 2 / 1 м']]],
                  ['От красной линии (улица / проезд)', [['Дом — от улицы', '5 м'], ['Дом — от проезда', '3 м'], ['Хозпостройки — от красной линии', '5 м']]],
                  ['Санитарно-бытовые (внутри участка)', [['Дом → уборная', '12 м'], ['Дом → постройка для скота / птицы', '12 м'], ['Дом → душ, баня, сауна', '8 м'], ['Колодец → уборная / компост', '8 м']]],
                  ['Противопожарные (между домами соседних участков)', [['Негорючие (камень, бетон, кирпич)', '6 м'], ['С деревянными перекрытиями', '8 м'], ['Древесина, каркас', '10–15 м']]],
                ].map(([title, rows]) => (
                  <Box key={title} mb="3">
                    <Text size="2" weight="bold" style={{ display: 'block', marginBottom: 4 }}>{title}</Text>
                    {rows.map(([k, v]) => (
                      <Flex key={k} justify="between" gap="3" py="1" style={{ borderBottom: '1px solid var(--gray-a4)' }}>
                        <Text size="2" color="gray">{k}</Text><Text size="2" weight="medium">{v}</Text>
                      </Flex>
                    ))}
                  </Box>
                ))}
                <Text size="1" color="gray">Между своими постройками в пределах одного участка противопожарные расстояния не нормируются. Источники: СП 53.13330.2019, СП 42.13330.2016, СП 4.13130.2013. Материал справочный, не заменяет проект и экспертизу.</Text>
              </Box>
              <Flex justify="end" mt="3"><Dialog.Close><Button>Понятно</Button></Dialog.Close></Flex>
            </Dialog.Content>
          </Dialog.Root>
          <Dialog.Root>
            <Dialog.Trigger><Button variant="soft" color="gray"><SewingPinFilledIcon /> Зонирование</Button></Dialog.Trigger>
            <Dialog.Content maxWidth="560px">
              <Dialog.Title><Flex align="center" gap="2"><SewingPinFilledIcon /> Рекомендации по зонированию</Flex></Dialog.Title>
              <Dialog.Description size="1" color="gray" mb="3">Ориентация по сторонам света: где разместить огород, посадки и зону отдыха.</Dialog.Description>
              <ZoneMap poly={poly} />
              <Box mt="3">
                {[
                  ['🥕 Огород / грядки — юг', 'Максимум света для светолюбивых культур.'],
                  ['🌳 Высокие посадки — север / края', 'Чтобы не затеняли грядки и окна дома. Отступ от границы: высокие ≥ 3 м, среднерослые ≥ 2 м, кустарник ≥ 1 м.'],
                  ['🌿 Газон / зона отдыха — центр', 'Универсальная буферная зона между постройками и посадками.'],
                ].map(([t, d]) => (
                  <Box key={t} mb="2"><Text size="2" weight="bold" style={{ display: 'block' }}>{t}</Text><Text size="1" color="gray">{d}</Text></Box>
                ))}
              </Box>
              <Flex justify="end" mt="2"><Dialog.Close><Button variant="soft" color="gray">Закрыть</Button></Dialog.Close></Flex>
            </Dialog.Content>
          </Dialog.Root>
          <Button variant={pro ? 'solid' : 'soft'} color={pro ? 'grass' : 'gray'} onClick={() => setPro(p => !p)}>{pro ? <CheckIcon /> : <LockOpen1Icon />} Pro-режим</Button>
          <Select.Root value={themeMode} onValueChange={setThemeMode}>
            <Select.Trigger variant="surface" color="gray" />
            <Select.Content>
              <Select.Item value="light">☀ Светлая</Select.Item>
              <Select.Item value="dark">☾ Тёмная</Select.Item>
              <Select.Item value="system">🖥 Как в системе</Select.Item>
            </Select.Content>
          </Select.Root>
        </Flex>

        {/* left panel */}
        <Card size="2" style={{ position: 'absolute', left: 16, top: 64, bottom: 20, width: 320, zIndex: 20, overflowY: 'auto', background: 'var(--color-panel-solid)' }}>
          <Flex direction="column" gap="3">
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>УЧАСТОК</Text>
              <Flex gap="2" mt="1">
                <Button size="1" variant={plotMode === 'points' ? 'solid' : 'soft'} color={plotMode === 'points' ? 'grass' : 'gray'} onClick={() => setPlotMode('points')} style={{ flex: 1 }}>По точкам</Button>
                <Button size="1" variant={plotMode === 'cadastre' ? 'solid' : 'soft'} color={plotMode === 'cadastre' ? 'grass' : 'gray'} onClick={() => setPlotMode('cadastre')} style={{ flex: 1 }}>По кад. номеру</Button>
              </Flex>
              {plotMode === 'points' ? (
                <>
                  <TextArea mt="2" rows={5} value={polyText} onChange={e => setPolyText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} placeholder="широта долгота (по одной точке на строку)" />
                  <Flex gap="2" mt="2"><Button onClick={build}>Построить участок</Button><Button variant="soft" color="gray" onClick={() => { setBuilt(null); }}>Сбросить</Button></Flex>
                </>
              ) : (
                <>
                  <TextField.Root mt="2" placeholder="напр. 63:01:0208004:12" value={cadCode} onChange={e => setCadCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') fetchCadastre(); }} />
                  <Button mt="2" onClick={fetchCadastre} disabled={cadLoading} style={{ width: '100%' }}>{cadLoading ? 'Ищу участок…' : 'Найти участок'}</Button>
                  {cadError && <Text size="1" color="red" mt="1" style={{ display: 'block' }}>{cadError}</Text>}
                  <Text size="1" color="gray" mt="1" style={{ display: 'block' }}>Границы загружаются из НСПД (Росреестр). После загрузки участок построится автоматически.</Text>
                </>
              )}
              <Button variant="soft" color="gray" mt="2" onClick={() => setMapOpen(true)} disabled={!poly} style={{ width: '100%' }}>🗺 Показать на карте</Button>
              <Flex gap="2" mt="2" align="center">
                <Text size="1" color="gray">Карта в 3D</Text>
                <Select.Root value={ground3d} onValueChange={setGround3d}>
                  <Select.Trigger style={{ flex: 1 }} />
                  <Select.Content>
                    <Select.Item value="off">Нет</Select.Item>
                    <Select.Item value="streets">Схема</Select.Item>
                  </Select.Content>
                </Select.Root>
              </Flex>
              {ground3d === 'streets' && !MAPTILER_KEY && <>
                <Flex gap="2" mt="2">
                  <TextField.Root placeholder="Ключ MapTiler (бесплатный)" value={keyDraft} onChange={e => setKeyDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') applyKey(); }} onBlur={applyKey} style={{ flex: 1 }} />
                  <Button variant="soft" onClick={applyKey}>Применить</Button>
                </Flex>
                {keyDraft.trim() && keyDraft.trim() === mapKey
                  ? <Text size="1" color="grass" mt="1" style={{ display: 'block' }}>Ключ применён ✓</Text>
                  : <Text size="1" color="gray" mt="1" style={{ display: 'block' }}>Схема в 3D тянется тайлами MapTiler — нужен бесплатный ключ (maptiler.com).</Text>}
              </>}
            </Box>
            <Separator size="4" />
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ДАТА И ВРЕМЯ</Text>
              <Flex gap="2" mt="1">
                <TextField.Root type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!pro} style={{ flex: 1 }} />
                <TextField.Root type="number" value={tz} onChange={e => setTz(parseFloat(e.target.value) || 0)} style={{ width: 84 }} />
              </Flex>
              <Flex gap="2" mt="2">
                <Button onClick={setNow}><ResetIcon /> Сейчас</Button>
              </Flex>
              {!pro && <Text size="1" color="gray" mt="1" style={{ display: 'block' }}>🔒 Другая дата — в Pro. Бесплатно: сегодня и время суток на таймбаре.</Text>}
            </Box>
            <Separator size="4" />
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ЗАБОР ПО ПЕРИМЕТРУ</Text>
              <Select.Root value={fence} onValueChange={setFence}>
                <Select.Trigger mt="1" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="0">Нет</Select.Item>
                  <Select.Item value="1.8">1.8 м</Select.Item>
                  <Select.Item value="custom" disabled={!pro}>Свой размер (Pro)</Select.Item>
                </Select.Content>
              </Select.Root>
              {fence === 'custom' && pro && <TextField.Root type="number" step="0.1" mt="2" value={fenceCustom} onChange={e => setFenceCustom(e.target.value)} placeholder="высота забора, м" />}
            </Box>
            <Separator size="4" />
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ЗДАНИЯ НА УЧАСТКЕ</Text>
              <Select.Root value={preset} onValueChange={setPreset}>
                <Select.Trigger mt="1" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Group>
                    <Select.Label>Жилой дом</Select.Label>
                    <Select.Item value="house|Дом 6×6|6,6,5">Дом 6×6 м, h 5</Select.Item>
                    <Select.Item value="house|Дом 8×8|8,8,6">Дом 8×8 м, h 6</Select.Item>
                    <Select.Item value="house|Дом 8×10|8,10,7">Дом 8×10 м, h 7</Select.Item>
                  </Select.Group>
                  <Select.Group>
                    <Select.Label>Постройки</Select.Label>
                    <Select.Item value="bath|Баня 4×6|4,6,3">Баня 4×6 м</Select.Item>
                    <Select.Item value="gazebo|Беседка 3×4|3,4,2.4">Беседка 3×4 м</Select.Item>
                    <Select.Item value="canopy|Навес 3×5|3,5,2.4">Навес 3×5 м</Select.Item>
                    <Select.Item value="tent|Шатёр 4×4|4,4,2.6">Шатёр 4×4 м</Select.Item>
                  </Select.Group>
                  <Select.Group>
                    <Select.Label>Озеленение</Select.Label>
                    <Select.Item value="tree|Дерево|1.8,1.8,6">Дерево (h 6)</Select.Item>
                    <Select.Item value="tree|Дерево низкое|1.4,1.4,4">Дерево низкое (h 4)</Select.Item>
                    <Select.Item value="bush|Куст|1.2,1.2,1.2">Куст</Select.Item>
                  </Select.Group>
                </Select.Content>
              </Select.Root>
              <Flex gap="2" mt="2">
                <Button onClick={addPreset} disabled={!pro} style={{ flex: 1 }}><PlusIcon /> Типовое</Button>
                <Button variant="soft" color="gray" onClick={() => setPlanOpen(true)} disabled={!pro} style={{ flex: 1 }}><Pencil1Icon /> Рисовать</Button>
              </Flex>
              {!pro && <Text size="1" color="gray" mt="1" style={{ display: 'block' }}>🔒 Расстановка объектов — в Pro. Бесплатно доступен только участок.</Text>}
              <Flex direction="column" gap="1" mt="2">
                {buildings.map((b, i) => (
                  <Flex key={i} justify="between" align="center" py="1" style={{ borderBottom: '1px solid var(--gray-a4)' }}>
                    <Text size="2">{b.name} · h {b.height}{b.roofH ? '+' + b.roofH : ''} м</Text>
                    <IconButton size="1" variant="ghost" color="red" onClick={() => removeBuilding(i)}><TrashIcon /></IconButton>
                  </Flex>
                ))}
                {buildings.length === 0 && <Text size="1" color="gray">Пока пусто — добавьте дом или баню.</Text>}
              </Flex>
            </Box>
            <Separator size="4" />
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>3D-АНАЛИТИКА</Text>
              <Box mt="2">
                <Flex align="center" justify="between" asChild>
                  <Text as="label" size="2" weight="medium" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: pro ? 'pointer' : 'default' }}>
                    <Flex align="center" gap="2"><LayersIcon /> 3D-аналитика поверхностей</Flex>
                    <Switch checked={pro && analytics} disabled={!pro} onCheckedChange={v => setAnalytics(v)} />
                  </Text>
                </Flex>
                {!pro && <Text size="1" color="gray" mt="1" style={{ display: 'block' }}>🔒 Включается в Pro.</Text>}
                {pro && analytics && <>
                  <Flex gap="2" mt="2" align="center">
                    <Text size="1" color="gray">Месяцы</Text>
                    <Select.Root value={String(anM1)} onValueChange={v => setAnM1(+v)}>
                      <Select.Trigger variant="soft" style={{ flex: 1 }} />
                      <Select.Content>{months.map((m, i) => <Select.Item key={i} value={String(i + 1)}>{m}</Select.Item>)}</Select.Content>
                    </Select.Root>
                    <Text size="1" color="gray">–</Text>
                    <Select.Root value={String(anM2)} onValueChange={v => setAnM2(+v)}>
                      <Select.Trigger variant="soft" style={{ flex: 1 }} />
                      <Select.Content>{months.map((m, i) => <Select.Item key={i} value={String(i + 1)}>{m}</Select.Item>)}</Select.Content>
                    </Select.Root>
                  </Flex>
                  <Text as="label" size="1" color="gray" mt="2" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={anDiff} onChange={e => setAnDiff(e.target.checked)} /> учитывать рассеянный свет
                  </Text>
                </>}
              </Box>
            </Box>
            {pro && <>
              <Separator size="4" />
              <Box>
                <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ПРОЕКТ</Text>
                <Flex gap="2" mt="1">
                  <Button variant="soft" color="gray" onClick={saveProject} style={{ flex: 1 }}><DownloadIcon /> Сохранить</Button>
                  <Button variant="soft" color="gray" onClick={() => openFile.current.click()} style={{ flex: 1 }}><UploadIcon /> Открыть</Button>
                  <input ref={openFile} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) loadProject(e.target.files[0]); e.target.value = ''; }} />
                </Flex>
              </Box>
            </>}
          </Flex>
        </Card>

        {/* right panel */}
        <Card size="2" style={{ position: 'absolute', right: 16, top: 64, bottom: 20, width: 300, zIndex: 20, background: 'var(--color-panel-solid)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <Flex direction="column" gap="2">
            <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ДИАГРАММА ПУТИ СОЛНЦА</Text>
            <SunPath y={y} mo={mo} da={da} tz={tz} lat={lat} lon={lon} curAz={azDeg} curAlt={altDeg} />
            <Text size="1" color="gray" weight="medium" mt="3" style={{ letterSpacing: '.08em' }}>ПОЛОЖЕНИЕ СЕЙЧАС</Text>
            <Stat k="Азимут" v={azDeg.toFixed(1) + '°'} />
            <Stat k="Высота" v={altDeg.toFixed(1) + '°'} />
            <Stat k="Статус" v={<Badge color={altDeg > 0 ? 'grass' : altDeg > -6 ? 'amber' : 'blue'}>{altDeg > 0 ? 'над горизонтом' : altDeg > -6 ? 'сумерки' : 'ночь'}</Badge>} />
            <Text size="1" color="gray" weight="medium" mt="3" style={{ letterSpacing: '.08em' }}>СОЛНЕЧНЫЙ ДЕНЬ</Text>
            <Stat k="Восход" v={fmtLocal(times.rise, tz)} />
            <Stat k="Закат" v={fmtLocal(times.set, tz)} />
            <Stat k="Солнечный полдень" v={fmtLocal(times.noon, tz)} />
            <Stat k="Долгота дня" v={fmtHours(dayLen)} />
            <Stat k="Макс. высота" v={noonAlt.toFixed(1) + '°'} />

            <Text size="1" color="gray" weight="medium" mt="3" style={{ letterSpacing: '.08em' }}>ИНСОЛЯЦИЯ ЦЕНТРА УЧАСТКА</Text>
            <Stat k="Всего за день" v={fmtHours(insol.sun)} />
            <Stat k="Макс. непрерывно" v={fmtHours(insol.cont)} />
            <Stat k={`Норма ≥ ${reqH} ч`} v={<Badge color={insol.cont >= reqH ? 'grass' : 'red'}>{insol.cont >= reqH ? 'выполнена' : 'не выполнена'}</Badge>} />

            <Text size="1" color="gray" weight="medium" mt="3" style={{ letterSpacing: '.08em', display: 'block' }}>КОНТРОЛЬНЫЕ ТОЧКИ</Text>
            <Flex gap="4" align="center">
              <Text as="label" size="1" color="gray" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <input type="checkbox" checked={showPlot} onChange={e => setShowPlot(e.target.checked)} /> на участке
              </Text>
              <Text as="label" size="1" color="gray" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <input type="checkbox" checked={showWin} onChange={e => setShowWin(e.target.checked)} /> на окнах
              </Text>
            </Flex>
            <Flex gap="3" align="center">
              <Flex align="center" gap="1"><span style={{ width: 10, height: 10, borderRadius: 5, background: '#1f9d45', display: 'inline-block' }} /><Text size="1" color="gray">норма</Text></Flex>
              <Flex align="center" gap="1"><span style={{ width: 10, height: 10, borderRadius: 5, background: '#c0392b', display: 'inline-block' }} /><Text size="1" color="gray">ниже нормы</Text></Flex>
            </Flex>
            <Stat k="Соответствуют норме" v={`${plotReport.okc} из ${plotReport.n}`} color={plotReport.okc === plotReport.n ? 'var(--grass-11)' : 'var(--amber-11)'} />

            {(buildings.length > 0) && <>
              <Text size="1" color="gray" weight="medium" mt="3" style={{ letterSpacing: '.08em' }}>ДЛИНА ТЕНИ (СЕЙЧАС)</Text>
              <Stat k="Тень падает на" v={altDeg > 0 ? `${azToCardinal(shadowAz)} (${shadowAz.toFixed(0)}°)` : 'солнца нет'} />
              {altDeg > 0 && buildings.map((b, i) => (
                <Stat key={i} k={b.name} v={fmtLen(shadowLen(b.height + (b.roofH || 0), altDeg))} />
              ))}
            </>}
          </Flex>
          </Box>
          <Box style={{ paddingTop: 22, marginTop: -14, position: 'relative', background: 'linear-gradient(to top, var(--color-panel-solid) 58%, transparent)' }}>
            {!pro
              ? <Button style={{ width: '100%' }} disabled><FileTextIcon /> Скачать PDF отчёт (Pro)</Button>
              : <Dialog.Root>
              <Dialog.Trigger><Button style={{ width: '100%' }}><FileTextIcon /> Скачать PDF отчёт</Button></Dialog.Trigger>
              <Dialog.Content maxWidth="440px">
                <Dialog.Title>Нормативный отчёт по инсоляции</Dialog.Title>
                <Dialog.Description size="2" color="gray" mb="3">СанПиН 1.2.3685-21. Реквизиты попадут в шапку.</Dialog.Description>
                <Flex direction="column" gap="2">
                  <TextField.Root placeholder="Адрес объекта" value={rp.addr} onChange={e => setRp({ ...rp, addr: e.target.value })} />
                  <TextField.Root placeholder="Заказчик" value={rp.client} onChange={e => setRp({ ...rp, client: e.target.value })} />
                  <TextField.Root placeholder="Исполнитель" value={rp.exec} onChange={e => setRp({ ...rp, exec: e.target.value })} />
                </Flex>
                <Flex justify="end" gap="2" mt="3">
                  <Dialog.Close><Button variant="soft" color="gray">Отмена</Button></Dialog.Close>
                  <Dialog.Close><Button onClick={openReport}><FileTextIcon /> Сформировать</Button></Dialog.Close>
                </Flex>
              </Dialog.Content>
            </Dialog.Root>}
          </Box>
        </Card>

        {/* легенда 3D-аналитики */}
        {pro && analytics && anStats && (
          <Card size="1" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 72, width: 300, zIndex: 25 }}>
            <Text size="2" weight="bold">3D-аналитика · {months[anStats.m1 - 1]}–{months[anStats.m2 - 1]}</Text>
            <Box mt="2" style={{ display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden' }}>
              {Array.from({ length: 21 }, (_, i) => <span key={i} style={{ flex: 1, background: thermalColor(i / 20) }} />)}
            </Box>
            <Flex justify="between" mt="1">
              <Text size="1" color="gray">{anStats.minV.toFixed(1)} {anStats.diff ? 'усл.ч' : 'ч'}</Text>
              <Text size="1" color="gray">{anStats.maxV.toFixed(1)} {anStats.diff ? 'усл.ч' : 'ч/сут'}</Text>
            </Flex>
            <Text size="1" color="gray" mt="1" style={{ display: 'block' }}>Плавная карта по земле, крышам и фасадам. {anStats.diff ? 'С учётом рассеянного света.' : 'Только прямое солнце.'}</Text>
          </Card>
        )}

        {/* timebar */}
        <Card size="2" style={{ position: 'absolute', left: 360, right: 340, bottom: 20, zIndex: 20, background: 'var(--color-panel-solid)' }}>
          <Flex align="center" gap="4">
            <Text size="6" weight="bold" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 92 }}>{clock}</Text>
            <Text size="2" color="gray" style={{ minWidth: 150 }}>{da} {months[mo - 1]} {y} · UTC{tz >= 0 ? '+' : ''}{tz}</Text>
            <Box style={{ flex: 1 }}>
              <Slider value={[minutes]} min={0} max={1439} step={1} onValueChange={([v]) => { setPlaying(false); setMinutes(v); }} />
            </Box>
          </Flex>
        </Card>
      </Box>
    </Theme>
  );
}
