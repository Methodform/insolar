import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Theme, Flex, Box, Card, Heading, Text, Button, TextField, TextArea, Select,
  Slider, Badge, Separator, IconButton, Dialog, Switch } from '@radix-ui/themes';
import { SunIcon, MoonIcon, PlayIcon, PauseIcon, PlusIcon, Pencil1Icon, RulerHorizontalIcon,
  TrashIcon, CheckIcon, LockOpen1Icon, LayersIcon, SewingPinFilledIcon, PersonIcon, HomeIcon,
  FileTextIcon, DownloadIcon, UploadIcon, ResetIcon, CopyIcon } from '@radix-ui/react-icons';
import Viewport, { thermalColor } from './three/Viewport.jsx';
import SunPath from './three/SunPath.jsx';
import MapView from './three/MapView.jsx';
import ZoneMap from './three/ZoneMap.jsx';
import WindRose from './three/WindRose.jsx';
import { fetchWindRose, prevailingDir, fetchWindNow, meanDir } from './engine/wind.js';
import { loginWithYandex } from './yandexAuth.js';
import { sunPosition, getTimes, compassAz, localToUTC, fmtLocal, fmtHours, parsePoly,
  insolationAt, normHours, shadowLen, azToCardinal, reportData, windowsReport } from './engine/astronomy.js';

// URL Cloudflare Worker'а (см. react-app/cadastre-proxy/README.md). Заменить после деплоя:
const CADASTRE_PROXY = '';
// общий ключ MapTiler, встроенный в сборку (GitHub secret → VITE_MAPTILER_KEY). Ограничьте его по домену в MapTiler.
const MAPTILER_KEY = (import.meta.env && import.meta.env.VITE_MAPTILER_KEY) || '2JUaUmt135fOwdifLWxv';
// Яндекс ID: вставьте client_id зарегистрированного OAuth-приложения (oauth.yandex.ru). Пусто — кнопка подскажет.
const YANDEX_CLIENT_ID = (import.meta.env && import.meta.env.VITE_YANDEX_CLIENT_ID) || '';

// Тарифы и лимиты участков по типам аккаунта (демо, без бэкенда).
// Физлицо: Free (1 участок) / Pro (до 3). Риелтор: B2B (до 20).
const PLAN_LIMITS = { free: 1, pro: 3, b2b: 20 };
const PLAN_LABEL  = { free: 'Free', pro: 'Pro · физлицо', b2b: 'B2B · риелтор' };
const PLAN_COLOR  = { free: 'gray', pro: 'grass', b2b: 'purple' };
const COMPASS8 = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
const compassFrom = deg => COMPASS8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

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
  const [fence, setFence] = useState('1.5');
  const [fenceCustom, setFenceCustom] = useState('2');
  const now = new Date();
  const [date, setDate] = useState(() => new Date(now.getTime()+4*3600000).toISOString().slice(0,10));
  const [minutes, setMinutes] = useState(() => { const d=new Date(now.getTime()+4*3600000); return d.getUTCHours()*60+d.getUTCMinutes(); });
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);
  const [buildings, setBuildings] = useState([]);
  const [preset, setPreset] = useState('house|Дом 12×8|12,8,3');
  const [pro, setPro] = useState(() => { try { return (localStorage.getItem('insolar_plan') || 'free') !== 'free'; } catch (e) { return false; } });
  const [paywall, setPaywall] = useState(false);
  const openPaywall = () => setPaywall(true);
  const requirePro = fn => () => { if (pro) fn(); else openPaywall(); };

  // Личный кабинет: тип аккаунта, тариф, участки (демо, localStorage)
  const [plan, setPlan] = useState(() => { try { return localStorage.getItem('insolar_plan') || 'free'; } catch (e) { return 'free'; } });
  const [acctType, setAcctType] = useState(() => { try { return localStorage.getItem('insolar_acct') || 'person'; } catch (e) { return 'person'; } });
  const [projects, setProjects] = useState(() => { try { return JSON.parse(localStorage.getItem('insolar_projects') || '[]'); } catch (e) { return []; } });
  const [acctOpen, setAcctOpen] = useState(false);
  const [newProj, setNewProj] = useState('');
  const applyPlan = (p) => { setPlan(p); setPro(p !== 'free'); const at = p === 'b2b' ? 'realtor' : 'person'; setAcctType(at); try { localStorage.setItem('insolar_plan', p); localStorage.setItem('insolar_acct', at); } catch (e) {} };
  const setAcct = (at) => { setAcctType(at); try { localStorage.setItem('insolar_acct', at); } catch (e) {} };
  const planLimit = PLAN_LIMITS[plan] || 1;
  const saveProjects = (arr) => { setProjects(arr); try { localStorage.setItem('insolar_projects', JSON.stringify(arr)); } catch (e) {} };
  const addProjectQuick = () => { if (projects.length >= planLimit) { setAcctOpen(false); openPaywall(); return; } const name = (newProj || '').trim() || ('Участок ' + (projects.length + 1)); saveProjects([...projects, { id: Date.now(), name, date: new Date().toLocaleDateString('ru-RU') }]); setNewProj(''); };
  const removeProject = (id) => saveProjects(projects.filter(x => x.id !== id));
  const [windOpen, setWindOpen] = useState(false);
  const [windFlow, setWindFlow] = useState(false);
  const [windDeg, setWindDeg] = useState(315);
  const [windMode, setWindMode] = useState('climate');   // 'climate' | 'now'
  const [windNow, setWindNow] = useState(null);           // { dirDeg, speed, time }
  const [windSel, setWindSel] = useState('now');          // 'now' | 'm0'..'m11' (месяц)
  const [monthDegs, setMonthDegs] = useState(null);        // [12] преобладающих направлений по месяцам
  const loadClimate = () => fetchWindRose(lat, lon).then(d => setWindDeg(prevailingDir(d.seasons.year).index * 45)).catch(() => {});
  const loadNow = () => fetchWindNow(lat, lon).then(n => { setWindNow(n); setWindDeg(n.dirDeg); }).catch(() => {});
  const pickWind = (v) => {
    setWindSel(v);
    if (v === 'now') { setWindMode('now'); loadNow(); return; }
    const i = +v.slice(1); setWindMode(v);
    if (monthDegs) setWindDeg(monthDegs[i]);
    else fetchWindRose(lat, lon).then(d => { const md = (d.months || []).map(mm => meanDir(mm)); setMonthDegs(md); if (md[i] != null) setWindDeg(md[i]); }).catch(() => {});
  };
  const setWindOn = (v) => { if (!pro) { openPaywall(); return; } setWindFlow(v); if (v) pickWind(windSel); };

  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('insolar_user') || 'null'); } catch (e) { return null; } });
  const loginYandex = async () => {
    if (!YANDEX_CLIENT_ID) { alert('Не задан YANDEX_CLIENT_ID: зарегистрируйте приложение на oauth.yandex.ru и укажите client_id (VITE_YANDEX_CLIENT_ID).'); return; }
    try { const { user } = await loginWithYandex(YANDEX_CLIENT_ID); setUser(user); try { localStorage.setItem('insolar_user', JSON.stringify(user)); } catch (e) {} }
    catch (e) { console.warn('Yandex ID login:', e); }
  };
  const logoutYandex = () => { setUser(null); try { localStorage.removeItem('insolar_user'); } catch (e) {} };

  // соседние здания с карты (OSM)
  // соседние дома берутся из тайлов OpenFreeMap в MapView (queryRenderedFeatures) — Overpass не используется
  const [mapOpen, setMapOpen] = useState(false);
  const [mapKey, setMapKeyState] = useState(() => { try { return localStorage.getItem('maptiler_key') || MAPTILER_KEY; } catch (e) { return MAPTILER_KEY; } });
  const setMapKey = k => { setMapKeyState(k); try { localStorage.setItem('maptiler_key', k); } catch (e) {} };
  const [ground3d, setGround3d] = useState('vector');  // 'vector' — плоская векторная карта OSM во вьюпорте; 'off' — пустая плоскость
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
  const [mobile, setMobile] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches);
  useEffect(() => { if (typeof matchMedia === 'undefined') return; const mq = matchMedia('(max-width: 767px)'); const h = e => setMobile(e.matches); mq.addEventListener('change', h); return () => mq.removeEventListener('change', h); }, []);
  const [panel, setPanel] = useState(null);  // мобильная шторка: 'plot' | 'sun' | null
  const [plotMode, setPlotMode] = useState('points');
  const [cadCode, setCadCode] = useState('');
  const [cadLoading, setCadLoading] = useState(false);
  const [cadError, setCadError] = useState('');
  const openFile = useRef(null);

  async function fetchCadastre() {
    if (!pro) { openPaywall(); return; }
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

  // режим «Сейчас»: тянем текущий ветер и обновляем каждые 10 минут, пока включено (после объявления lat/lon)
  useEffect(() => {
    if (!(pro && windFlow && windMode === 'now')) return;
    loadNow(); const id = setInterval(loadNow, 10 * 60 * 1000); return () => clearInterval(id);
  }, [pro, windFlow, windMode, lat, lon]);

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
    const roofByKind = { house: 2, bath: 2, gazebo: 1.6, canopy: 0.3, tree: 0, bush: 0 };  // дом: этаж 3 м + конёк 2 м
    const roofH = roofByKind[kind] !== undefined ? roofByKind[kind] : 1.5;
    setBuildings(bs => [...bs, { kind, pts: corners, height: h, roofH, name }]);
  }
  const removeBuilding = i => setBuildings(bs => bs.filter((_, k) => k !== i));
  const copyBuilding = i => setBuildings(bs => { const s = bs[i]; if (!s) return bs; const nb = { ...s, pts: (s.pts || []).map(p => [p[0] + 2, p[1] + 2]) }; delete nb.treeSeed; return [...bs, nb]; });

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
  useEffect(() => { if (!pro) { const d = new Date(Date.now() + tz * 3600000); setDate(d.toISOString().slice(0, 10)); setPlotMode('points'); } }, [pro, tz]);
  function build() { const p = parsePoly(polyText); if (!p) { alert('Нужно минимум 3 точки: широта долгота'); return; } setBuilt(p); if (p.lon0) setTz(Math.round(p.lon0 / 15)); setPanel(null); }

  const clock = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

  const Stat = ({ k, v, color }) => (
    <Flex justify="between" py="1" style={{ borderBottom: '1px solid var(--gray-a4)' }}>
      <Text size="2" color="gray">{k}</Text><Text size="2" weight="medium" style={color?{color}:undefined}>{v}</Text>
    </Flex>
  );

  const sheetPos = { position: 'fixed', top: 52, left: 0, right: 0, bottom: 56, zIndex: 20, background: 'var(--color-panel-solid)', borderRadius: 0, boxShadow: 'none' };
  const leftCardStyle = mobile
    ? { ...sheetPos, overflowY: 'auto', display: panel === 'plot' ? 'block' : 'none' }
    : { position: 'absolute', left: 16, top: 64, bottom: 20, width: 320, zIndex: 20, overflowY: 'auto', background: 'var(--color-panel-solid)' };
  const rightCardStyle = mobile
    ? { ...sheetPos, display: panel === 'sun' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }
    : { position: 'absolute', right: 16, top: 64, bottom: 20, width: 300, zIndex: 20, background: 'var(--color-panel-solid)', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
  const recCardStyle = { ...sheetPos, overflowY: 'auto', display: panel === 'rec' ? 'block' : 'none' };
  const profCardStyle = { ...sheetPos, overflowY: 'auto', display: panel === 'profile' ? 'block' : 'none' };
  const timebarStyle = mobile
    ? { position: 'fixed', left: 8, right: 8, bottom: 62, zIndex: 20, background: 'var(--color-panel-solid)', display: panel ? 'none' : 'block' }
    : { position: 'absolute', left: 360, right: 340, bottom: 20, zIndex: 20, background: 'var(--color-panel-solid)' };

  return (
    <Theme appearance={appearance} accentColor="grass" grayColor="sage" radius="large" panelBackground="solid">
      <Box style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
        {/* основной холст — карта 2ГИС/OSM с нашим 3D (бывшая «Карта»); старый Viewport оставлен в коде для отката */}
        <MapView key={`${lat.toFixed(5)},${lon.toFixed(5)}`} polyText={polyText} buildings={buildings} onBuildings={setBuildings} lat={lat} lon={lon} tz={tz} fenceH={fenceH}
          date={date} minutes={minutes} windDeg={windDeg} windOn={pro && windFlow}
          insolOn={showPlot || showWin} insolWalls={showWin} plotMarkers={showPlot ? plotReport.rows : []} reqH={reqH}
          embed />

        {/* header */}
        <Flex align="center" gap="3" px="4" py="2" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
          background: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a4)' }}>
          <Heading size="4"><Flex align="center" gap="1"><SunIcon width="20" height="20" /> SunPlan3d</Flex></Heading>
          <Box style={{ flex: 1 }} />
          {!mobile && <>
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
            <Dialog.Trigger><Button variant="soft" color="gray"><SewingPinFilledIcon />{!mobile && ' Зонирование'}</Button></Dialog.Trigger>
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
          <Button variant="soft" color="gray" onClick={requirePro(() => setWindOpen(true))}>🌀{!mobile && ' Роза ветров'}</Button>
          <Dialog.Root open={windOpen} onOpenChange={setWindOpen}>
            <Dialog.Content maxWidth="440px">
              <Dialog.Title>Роза ветров</Dialog.Title>
              <Dialog.Description size="1" color="gray" mb="3">Откуда и как часто дует ветер по сезонам — под координаты вашего участка.</Dialog.Description>
              {windOpen && <WindRose lat={lat} lon={lon} />}
              <Flex justify="end" mt="3"><Dialog.Close><Button variant="soft" color="gray">Закрыть</Button></Dialog.Close></Flex>
            </Dialog.Content>
          </Dialog.Root>
          <Button variant={pro ? 'solid' : 'soft'} color={pro ? PLAN_COLOR[plan] : 'gray'} onClick={openPaywall}>{pro ? <><CheckIcon /> {plan === 'b2b' ? 'B2B активен' : 'Pro активен'}</> : <><LockOpen1Icon /> Тарифы</>}</Button>
          <Button variant="soft" color="gray" onClick={() => setAcctOpen(true)} title="Личный кабинет"><PersonIcon />{!mobile && ' ' + (user ? (user.name || 'Кабинет') : 'Кабинет')}</Button>
          </>}
          <IconButton variant="soft" color="gray" title="Тема" onClick={() => setThemeMode(appearance === 'dark' ? 'light' : 'dark')}>
            {appearance === 'dark' ? <SunIcon /> : <MoonIcon />}
          </IconButton>
        </Flex>

        {/* left panel */}
        <Card size="2" className="panel-card" style={leftCardStyle}>
          <Flex direction="column" gap="3">
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>УЧАСТОК</Text>
              <Flex gap="2" mt="1">
                <Button size="1" variant={plotMode === 'points' ? 'solid' : 'soft'} color={plotMode === 'points' ? 'grass' : 'gray'} onClick={() => setPlotMode('points')} style={{ flex: 1 }}>По точкам</Button>
                <Button size="1" variant={plotMode === 'cadastre' ? 'solid' : 'soft'} color={plotMode === 'cadastre' ? 'grass' : 'gray'} onClick={requirePro(() => setPlotMode('cadastre'))} style={{ flex: 1 }}>По кад. номеру</Button>
              </Flex>
              {plotMode === 'points' ? (
                <>
                  <TextArea mt="2" rows={5} value={polyText} onChange={e => setPolyText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} placeholder="широта долгота (по одной точке на строку)" />
                  <Flex gap="2" mt="2"><Button onClick={build} style={{ width: '100%' }}>Построить участок</Button></Flex>
                </>
              ) : (
                <>
                  <TextField.Root mt="2" placeholder="напр. 63:01:0208004:12" value={cadCode} onChange={e => setCadCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') fetchCadastre(); }} />
                  <Button mt="2" onClick={fetchCadastre} disabled={cadLoading} style={{ width: '100%' }}>{cadLoading ? 'Ищу участок…' : 'Найти участок'}</Button>
                  {cadError && <Text size="1" color="red" mt="1" style={{ display: 'block' }}>{cadError}</Text>}
                  <Text size="1" color="gray" mt="1" style={{ display: 'block' }}>Границы загружаются из НСПД (Росреестр). После загрузки участок построится автоматически.</Text>
                </>
              )}
            </Box>
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ЗАБОР ПО ПЕРИМЕТРУ</Text>
              <Select.Root value={fence} onValueChange={v => { if (v === 'custom' && !pro) { openPaywall(); return; } setFence(v); }}>
                <Select.Trigger mt="1" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="0">Нет</Select.Item>
                  <Select.Item value="1.5">1.5 м (по нормам)</Select.Item>
                  <Select.Item value="1.8">1.8 м</Select.Item>
                  <Select.Item value="custom">Свой размер</Select.Item>
                </Select.Content>
              </Select.Root>
              {fence === 'custom' && pro && <TextField.Root type="number" step="0.1" mt="2" value={fenceCustom} onChange={e => setFenceCustom(e.target.value)} placeholder="высота забора, м" />}
            </Box>
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ОТСТУПЫ ОТ ГРАНИЦ</Text>
              <Flex direction="column" gap="1" mt="1">
                <Flex align="center" gap="2"><span style={{ width: 12, height: 3, background: '#2b7bff', display: 'inline-block' }} /><Text size="1" color="gray">1 м — баня, хозпостройки, беседка, навес</Text></Flex>
                <Flex align="center" gap="2"><span style={{ width: 12, height: 3, background: '#f5a623', display: 'inline-block' }} /><Text size="1" color="gray">3 м — жилой / садовый дом</Text></Flex>
                <Flex align="center" gap="2"><span style={{ width: 12, height: 3, background: '#c0392b', display: 'inline-block' }} /><Text size="1" color="gray">4 м — постройка для скота / птицы</Text></Flex>
              </Flex>
            </Box>
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ЗДАНИЯ НА УЧАСТКЕ</Text>
              <Select.Root value={preset} onValueChange={setPreset}>
                <Select.Trigger mt="1" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Group>
                    <Select.Label>Постройки</Select.Label>
                    <Select.Item value="house|Дом 12×8|12,8,3">Дом 12×8 м, h 3 + конёк 2</Select.Item>
                    <Select.Item value="bath|Баня 4×6|4,6,3">Баня 4×6 м</Select.Item>
                    <Select.Item value="gazebo|Беседка 3×4|3,4,2.4">Беседка 3×4 м</Select.Item>
                    <Select.Item value="canopy|Навес 3×5|3,5,2.4">Навес 3×5 м</Select.Item>
                  </Select.Group>
                  <Select.Group>
                    <Select.Label>Озеленение</Select.Label>
                    <Select.Item value="bush|Куст|1.2,1.2,1.2">Куст</Select.Item>
                    <Select.Item value="tree|Дерево|1.8,1.8,6">Дерево</Select.Item>
                  </Select.Group>
                </Select.Content>
              </Select.Root>
              <Flex gap="2" mt="2">
                <Button onClick={requirePro(addPreset)} style={{ flex: 1 }}><PlusIcon /> Добавить объект</Button>
              </Flex>
              <Flex direction="column" gap="1" mt="2">
                {buildings.map((b, i) => {
                  const p = b.pts || [];
                  const w = p.length >= 2 ? Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) : 0;
                  const d = p.length >= 3 ? Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]) : 0;
                  const isVeg = b.kind === 'tree' || b.kind === 'bush';
                  return (
                    <Flex key={i} justify="between" align="center" py="1" style={{ borderBottom: '1px solid var(--gray-a4)' }}>
                      <Text size="2">{b.name}{isVeg ? '' : ` · ${w.toFixed(1)}×${d.toFixed(1)} м`} · h {b.height}{b.roofH ? '+' + b.roofH : ''} м</Text>
                      <Flex gap="1">
                        <IconButton size="1" variant="ghost" color="gray" title="Копировать" onClick={() => copyBuilding(i)}><CopyIcon /></IconButton>
                        <IconButton size="1" variant="ghost" color="red" title="Удалить" onClick={() => removeBuilding(i)}><TrashIcon /></IconButton>
                      </Flex>
                    </Flex>
                  );
                })}
                {buildings.length === 0 && <Text size="1" color="gray">Пока пусто — добавьте дом или баню.</Text>}
              </Flex>
            </Box>
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ВЕТЕР</Text>
              <Box mt="2">
                <Flex align="center" justify="between" asChild>
                  <Text as="label" size="2" weight="medium" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: pro ? 'pointer' : 'default' }}>
                    <Flex align="center" gap="2">🌬 Поток ветра</Flex>
                    <Switch checked={pro && windFlow} onCheckedChange={setWindOn} />
                  </Text>
                </Flex>
                {pro && windFlow && <Box mt="2">
                  <Select.Root value={windSel} onValueChange={pickWind}>
                    <Select.Trigger variant="soft" style={{ width: '100%' }} />
                    <Select.Content>
                      <Select.Item value="now">Сейчас</Select.Item>
                      {months.map((m, i) => <Select.Item key={i} value={'m' + i}>{m}</Select.Item>)}
                    </Select.Content>
                  </Select.Root>
                  <Text size="1" color="gray" mt="2" style={{ display: 'block' }}>
                    {windSel === 'now'
                      ? (windNow ? `Ветер сейчас: с ${compassFrom(windNow.dirDeg)}${windNow.speed != null ? `, ${windNow.speed.toFixed(1)} м/с` : ''}` : 'Загружаю текущий ветер…')
                      : `Преобладающий ветер за месяц: с ${Math.round(windDeg)}°`}
                  </Text>
                  <Flex align="center" gap="2" mt="2"><span style={{ width: 10, height: 10, borderRadius: 3, background: '#4d8be6', display: 'inline-block' }} /><Text size="1" color="gray">Затишье — беседку и зону отдыха сюда</Text></Flex>
                  <Flex align="center" gap="2" mt="1"><span style={{ width: 10, height: 10, borderRadius: 3, background: '#e6663d', display: 'inline-block' }} /><Text size="1" color="gray">Продувание — грядки/теплицу защитить</Text></Flex>
                </Box>}
              </Box>
            </Box>
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ПРОЕКТ</Text>
              <Flex gap="2" mt="1">
                <Button variant="soft" color="gray" onClick={requirePro(saveProject)} style={{ flex: 1 }}><DownloadIcon /> Сохранить</Button>
                <Button variant="soft" color="gray" onClick={requirePro(() => openFile.current.click())} style={{ flex: 1 }}><UploadIcon /> Открыть</Button>
                <input ref={openFile} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) loadProject(e.target.files[0]); e.target.value = ''; }} />
              </Flex>
            </Box>
          </Flex>
        </Card>

        {/* right panel */}
        <Card size="2" className="panel-card" style={rightCardStyle}>
          <Box style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <Flex direction="column" gap="2">
            <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ДИАГРАММА ПУТИ СОЛНЦА</Text>
            <SunPath year={y} mo={mo} da={da} tz={tz} lat={lat} lon={lon} curAz={azDeg} curAlt={altDeg} poly={poly} />
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
                <input type="checkbox" checked={showWin} onChange={e => setShowWin(e.target.checked)} /> на стенах
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
              ? <Button style={{ width: '100%' }} onClick={openPaywall}><FileTextIcon /> Скачать PDF отчёт</Button>
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

        {/* мобильная шторка «Рекомендации» */}
        {mobile && (
          <Card size="2" className="panel-card" style={recCardStyle}>
            <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>РЕКОМЕНДАЦИИ ПО ЗОНИРОВАНИЮ</Text>
            <Box mt="2"><ZoneMap poly={poly} /></Box>
            <Box mt="2">
              {[
                ['🥕 Огород / грядки — юг', 'Максимум света для светолюбивых культур.'],
                ['🌳 Высокие посадки — север / края', 'Чтобы не затеняли грядки и окна дома. Отступ от границы: высокие ≥ 3 м, среднерослые ≥ 2 м, кустарник ≥ 1 м.'],
                ['🌿 Газон / зона отдыха — центр', 'Универсальная буферная зона между постройками и посадками.'],
              ].map(([t, d]) => (
                <Box key={t} mb="2"><Text size="2" weight="bold" style={{ display: 'block' }}>{t}</Text><Text size="1" color="gray">{d}</Text></Box>
              ))}
            </Box>
            <Text size="1" color="gray" weight="medium" mt="3" style={{ letterSpacing: '.08em', display: 'block' }}>НОРМАТИВНЫЕ ОТСТУПЫ</Text>
            {[
              ['От границы соседнего участка', [['Жилой / садовый дом', '3 м'], ['Гараж (окна к соседу)', '2 м'], ['Баня, хозпостройки', '1 м'], ['Постройка для скота / птицы', '4 м'], ['Деревья высокие / средние / кустарник', '3 / 2 / 1 м']]],
              ['От красной линии', [['Дом — от улицы', '5 м'], ['Дом — от проезда', '3 м'], ['Хозпостройки', '5 м']]],
              ['Санитарные (внутри участка)', [['Дом → уборная', '12 м'], ['Дом → душ, баня', '8 м'], ['Колодец → уборная / компост', '8 м']]],
              ['Противопожарные (между домами соседей)', [['Негорючие (камень, бетон)', '6 м'], ['С деревянными перекрытиями', '8 м'], ['Древесина, каркас', '10–15 м']]],
            ].map(([title, rows]) => (
              <Box key={title} mt="2">
                <Text size="2" weight="bold" style={{ display: 'block', marginBottom: 4 }}>{title}</Text>
                {rows.map(([k, v]) => (
                  <Flex key={k} justify="between" gap="3" py="1" style={{ borderBottom: '1px solid var(--gray-a4)' }}>
                    <Text size="2" color="gray">{k}</Text><Text size="2" weight="medium">{v}</Text>
                  </Flex>
                ))}
              </Box>
            ))}
            <Text size="1" color="gray" mt="3" style={{ display: 'block' }}>Материал справочный: СП 53.13330, СП 42.13330, СП 4.13130, СанПиН 1.2.3685-21. Не заменяет проект и экспертизу.</Text>
          </Card>
        )}

        {/* мобильная шторка «Профиль» */}
        {mobile && (
          <Card size="2" className="panel-card" style={profCardStyle}>
            <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ПРОФИЛЬ</Text>
            <Flex align="center" gap="2" mt="2" wrap="wrap">
              <Badge color={PLAN_COLOR[plan]} size="2">{PLAN_LABEL[plan]}</Badge>
              <Badge color="gray" size="2">Участки: {projects.length}/{planLimit}</Badge>
            </Flex>
            <Text size="2" mt="2" style={{ display: 'block' }}>{user ? (user.name || user.login || 'Профиль') : 'Гость'}</Text>
            <Button mt="3" style={{ width: '100%' }} onClick={() => setAcctOpen(true)}><PersonIcon /> Личный кабинет</Button>
            <Button mt="2" variant="soft" color="grass" style={{ width: '100%' }} onClick={openPaywall}>{pro ? 'Управление подпиской' : 'Оформить Pro'}</Button>
            <Text size="1" color="gray" mt="3" style={{ display: 'block' }}>SunPlan3d — планирование участка по солнцу: тени, инсоляция по СанПиН, расстановка построек и посадок. Расчёты носят модельный характер.</Text>
          </Card>
        )}

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

        {/* модал тарифов */}
        <Dialog.Root open={paywall} onOpenChange={setPaywall}>
          <Dialog.Content maxWidth="820px">
            <Dialog.Title>Ваш участок — под рукой круглый год</Dialog.Title>
            <Dialog.Description size="2" color="gray" mb="4">Планируйте сколько угодно: постройки, посадки, пересадки, разные сезоны и годы. SunPlan3d считает солнце и тени вживую, а проект остаётся вашим.</Dialog.Description>
            <Flex gap="3" wrap="wrap" direction={mobile ? 'column' : 'row'} align="stretch">
              {[
                { key: 'free', name: 'Free', price: '0 ₽', sub: 'без регистрации', hero: false, badge: null,
                  feats: ['Участок по кадастру или точкам', 'Один дом из каталога', 'Забор по СНиП 1,5 м', 'Тени на один весенний день', 'Памятка по отступам'],
                  cta: pro ? null : 'Текущий план' },
                { key: 'promo', name: 'Pro · месяц', price: '990 ₽', sub: 'физлицо · в месяц', hero: false, badge: null,
                  feats: ['Всё из Free', 'До 3 участков', 'Расстановка зданий и сооружений', 'Любая дата и движение солнца весь год', 'Поток ветра и забор любой высоты', 'Соседние дома с карты', 'Инсоляция по всему участку', 'PDF с розой ветров'],
                  cta: 'Оформить Pro' },
                { key: 'proseason', name: 'Pro · 6 месяцев', price: '1 990 ₽', sub: 'сезон · ≈ 332 ₽/мес', hero: true, badge: 'Популярный',
                  feats: ['Всё из Pro', 'До 3 участков', 'Весь сезон: стройка и посадки', 'Сезонные сценарии и напоминания', 'Сохранённые проекты и сравнение A/B', 'Инсоляция и ветер круглый год'],
                  cta: 'Взять на сезон' },
                { key: 'proyear', name: 'Pro · год', price: '2 990 ₽', sub: 'физлицо · ≈ 249 ₽/мес', hero: false, badge: null,
                  feats: ['Всё из Pro', 'До 3 участков', 'Для тех, кто строит долго', 'Участок эволюционирует вместе с вами'],
                  cta: 'Планировать год' },
                { key: 'b2b', name: 'B2B · профи и риелторам', price: '8 990 ₽', sub: 'в год · до 20 участков', hero: false, badge: 'Бизнес',
                  feats: ['Всё из Pro, до 20 участков', 'PDF-паспорт с вашим брендом', 'Ссылки-презентации для клиентов', 'Риелтор, проектировщик, ландшафтник', 'Приоритетная поддержка'],
                  cta: 'Подключить B2B' },
              ].map(t => (
                <Box key={t.key} style={{ flex: '1 1 180px', border: t.hero ? '2px solid var(--grass-8)' : '1px solid var(--gray-a5)', borderRadius: 12, padding: 16, background: t.hero ? 'var(--grass-a2)' : 'transparent', position: 'relative' }}>
                  {t.badge && <Badge color="grass" style={{ position: 'absolute', top: -10, left: 14 }}>{t.badge}</Badge>}
                  <Text size="2" weight="bold" style={{ display: 'block' }}>{t.name}</Text>
                  <Text size="6" weight="bold" mt="1" style={{ display: 'block', whiteSpace: 'nowrap' }}>{t.price}</Text>
                  <Text size="1" color="gray" style={{ display: 'block' }}>{t.sub}</Text>
                  <Flex direction="column" gap="1" mt="3">
                    {t.feats.map((f, i) => <Text key={i} size="1" color="gray" style={{ display: 'block' }}>{f}</Text>)}
                  </Flex>
                  {t.cta && <Button mt="3" style={{ width: '100%' }} variant={t.key === 'free' ? 'soft' : t.hero ? 'solid' : 'soft'} color={t.key === 'free' ? 'gray' : 'grass'}
                    disabled={t.key === 'free' && !pro}
                    onClick={() => { if (t.key === 'free') applyPlan('free'); else if (t.key === 'b2b') applyPlan('b2b'); else applyPlan('pro'); setPaywall(false); }}>{t.cta}</Button>}
                </Box>
              ))}
            </Flex>
            <Flex justify="between" align="center" mt="4" gap="3" wrap="wrap">
              <Text size="1" color="gray" style={{ flex: '1 1 300px' }}>
                SunPlan3d — не разовый отчёт, а инструмент, в который возвращаешься к каждому сезону и решению. PDF-паспорт входит во все платные тарифы. Когда подписка закончится, участок и проекты не пропадут — останутся для просмотра, а скачанные PDF навсегда ваши.
              </Text>
              {pro
                ? <Button variant="soft" color="gray" onClick={() => { applyPlan('free'); setPaywall(false); }}>Отключить Pro (демо)</Button>
                : <Dialog.Close><Button variant="soft" color="gray">Закрыть</Button></Dialog.Close>}
            </Flex>
            <Text size="1" color="gray" mt="2" style={{ display: 'block' }}>Цены иллюстративные, оплата будет подключена позже.</Text>
          </Dialog.Content>
        </Dialog.Root>

        {/* Личный кабинет */}
        <Dialog.Root open={acctOpen} onOpenChange={setAcctOpen}>
          <Dialog.Content maxWidth="560px">
            <Dialog.Title>Личный кабинет</Dialog.Title>
            <Flex align="center" gap="3" mb="4" mt="1">
              {user && user.avatarId
                ? <img src={'https://avatars.yandex.net/get-yapic/' + user.avatarId + '/islands-68'} alt="" width="44" height="44" style={{ borderRadius: '50%' }} />
                : <Box style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--gray-a4)', display: 'grid', placeItems: 'center' }}><PersonIcon /></Box>}
              <Box style={{ flex: 1 }}>
                <Text size="3" weight="bold" style={{ display: 'block' }}>{user ? (user.name || user.login || 'Профиль') : 'Гость'}</Text>
                <Text size="1" color="gray">{user ? (user.email || 'Яндекс ID') : 'Войдите, чтобы сохранять участки'}</Text>
              </Box>
              {user
                ? <Button variant="soft" color="gray" onClick={logoutYandex}>Выйти</Button>
                : <Button variant="soft" color="red" onClick={loginYandex}><PersonIcon /> Войти с Яндекс ID</Button>}
            </Flex>

            <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em', display: 'block', marginBottom: 6 }}>ТИП АККАУНТА</Text>
            <Flex gap="2" mb="4">
              <Button variant={acctType === 'person' ? 'solid' : 'soft'} color={acctType === 'person' ? 'grass' : 'gray'} onClick={() => setAcct('person')} style={{ flex: 1 }}><PersonIcon /> Физлицо</Button>
              <Button variant={acctType === 'realtor' ? 'solid' : 'soft'} color={acctType === 'realtor' ? 'purple' : 'gray'} onClick={() => setAcct('realtor')} style={{ flex: 1 }}><HomeIcon /> Риелтор</Button>
            </Flex>

            <Card mb="4">
              <Flex justify="between" align="center" gap="3" wrap="wrap">
                <Box>
                  <Text size="1" color="gray" style={{ display: 'block' }}>Текущий тариф</Text>
                  <Badge color={PLAN_COLOR[plan]} size="2" mt="1">{PLAN_LABEL[plan]}</Badge>
                </Box>
                <Button variant="soft" color="grass" onClick={() => { setAcctOpen(false); openPaywall(); }}>Сменить тариф</Button>
              </Flex>
              <Separator my="3" size="4" />
              <Flex justify="between" align="center">
                <Text size="2" weight="medium">Участки: {projects.length} из {planLimit}</Text>
                <Text size="1" color="gray">{plan === 'free' ? '1 — бесплатный' : plan === 'pro' ? 'до 3 — физлицо' : 'до 20 — риелтор'}</Text>
              </Flex>
              <Box mt="2" style={{ height: 8, borderRadius: 999, background: 'var(--gray-a4)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: Math.min(100, Math.round(projects.length / planLimit * 100)) + '%', background: 'var(--grass-9)' }} />
              </Box>
            </Card>

            <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em', display: 'block', marginBottom: 6 }}>МОИ УЧАСТКИ</Text>
            {projects.length === 0 && <Text size="2" color="gray" style={{ display: 'block', marginBottom: 8 }}>Пока нет сохранённых участков.</Text>}
            <Flex direction="column" gap="2" mb="3">
              {projects.map(p => (
                <Flex key={p.id} justify="between" align="center" style={{ border: '1px solid var(--gray-a5)', borderRadius: 10, padding: '8px 12px' }}>
                  <Box><Text size="2" weight="medium" style={{ display: 'block' }}>{p.name}</Text><Text size="1" color="gray">создан {p.date}</Text></Box>
                  <Flex gap="2">
                    <Button size="1" variant="soft" color="grass" onClick={() => setAcctOpen(false)}>Открыть</Button>
                    <IconButton size="1" variant="soft" color="gray" onClick={() => removeProject(p.id)}><TrashIcon /></IconButton>
                  </Flex>
                </Flex>
              ))}
            </Flex>
            {projects.length < planLimit
              ? <Flex gap="2">
                  <TextField.Root placeholder="Название участка" value={newProj} onChange={e => setNewProj(e.target.value)} style={{ flex: 1 }} />
                  <Button onClick={addProjectQuick}><PlusIcon /> Добавить</Button>
                </Flex>
              : <Button style={{ width: '100%' }} onClick={() => { setAcctOpen(false); openPaywall(); }}><LockOpen1Icon /> Лимит достигнут — расширить тариф</Button>}

            <Text size="1" color="gray" mt="3" style={{ display: 'block' }}>Демо-кабинет: вход через Яндекс ID, тариф и участки хранятся локально в браузере. Оплата и синхронизация появятся с бэкендом.</Text>
            <Flex justify="end" mt="3"><Dialog.Close><Button variant="soft" color="gray">Закрыть</Button></Dialog.Close></Flex>
          </Dialog.Content>
        </Dialog.Root>

        {/* timebar */}
        <Card size="2" className="panel-card" style={timebarStyle}>
          <Flex align="center" gap={mobile ? '2' : '3'}>
            <Text weight="bold" style={{ fontVariantNumeric: 'tabular-nums', fontSize: mobile ? 22 : 28, lineHeight: 1, minWidth: mobile ? 66 : 104 }}>{clock}</Text>
            <TextField.Root type="date" size="3" value={date} readOnly={!pro}
              onChange={e => setDate(e.target.value)}
              onMouseDown={e => { if (!pro) { e.preventDefault(); openPaywall(); } }}
              style={{ width: mobile ? 150 : 180, cursor: pro ? 'auto' : 'pointer' }} />
            <Box style={{ flex: 1 }}>
              <Slider value={[minutes]} min={0} max={1439} step={1} onValueChange={([v]) => { setPlaying(false); setMinutes(v); }} />
            </Box>
          </Flex>
        </Card>

        {/* мобильная нижняя панель вкладок */}
        {mobile && (
          <Flex align="stretch" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: 58, zIndex: 22, background: 'var(--color-panel-solid)', borderTop: '1px solid var(--gray-a4)' }}>
            {[
              { k: 'plot', label: 'Участок', icon: <HomeIcon width="20" height="20" /> },
              { k: 'sun', label: 'Солнце', icon: <SunIcon width="20" height="20" /> },
              { k: null, label: 'сцена', icon: <span style={{ fontWeight: 800, fontSize: 17, lineHeight: 1 }}>3D</span>, big: true },
              { k: 'rec', label: 'Советы', icon: <SewingPinFilledIcon width="20" height="20" /> },
              { k: 'profile', label: 'Профиль', icon: <PersonIcon width="20" height="20" /> },
            ].map((t, i) => { const active = panel === t.k;
              return (
                <button key={i} onClick={() => setPanel(t.k === null ? null : (panel === t.k ? null : t.k))}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                    color: active ? 'var(--grass-11)' : 'var(--gray-10)' }}>
                  {t.icon}
                  <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 400 }}>{t.label}</span>
                </button>
              );
            })}
          </Flex>
        )}
      </Box>
    </Theme>
  );
}
