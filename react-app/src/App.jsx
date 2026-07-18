import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Theme, Flex, Box, Card, Heading, Text, Button, TextField, TextArea, Select,
  Slider, Tabs, Badge, Separator, IconButton } from '@radix-ui/themes';
import Viewport from './three/Viewport.jsx';
import SunPath from './three/SunPath.jsx';
import { sunPosition, getTimes, compassAz, localToUTC, fmtLocal, fmtHours, parsePoly,
  insolationAt, normHours, shadowLen, azToCardinal } from './engine/astronomy.js';

const DEFAULT_POLY = `53.5859054 49.0883256
53.5858383 49.0889893
53.5856392 49.0889309
53.5857069 49.0882681`;

export default function App() {
  const [appearance, setAppearance] = useState('light');
  const [polyText, setPolyText] = useState(DEFAULT_POLY);
  const [built, setBuilt] = useState(() => parsePoly(DEFAULT_POLY));
  const [tz, setTz] = useState(4);
  const [fence, setFence] = useState('2');
  const now = new Date();
  const [date, setDate] = useState(() => new Date(now.getTime()+4*3600000).toISOString().slice(0,10));
  const [minutes, setMinutes] = useState(() => { const d=new Date(now.getTime()+4*3600000); return d.getUTCHours()*60+d.getUTCMinutes(); });
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);
  const [buildings, setBuildings] = useState([]);
  const [preset, setPreset] = useState('Дом 9×9|9,9,6|3');

  const lat = built ? built.lat0 : 55.75, lon = built ? built.lon0 : 37.62;
  const poly = built ? built.local : null;

  function addPreset() {
    const [name, dims] = preset.split('|');
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
    const roofH = /дом/i.test(name) ? 2.5 : 1.5;
    setBuildings(bs => [...bs, { pts: corners, height: h, roofH, name }]);
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
  const shadowAz = (azDeg + 180) % 360;
  const fmtLen = L => !isFinite(L) ? '∞' : L >= 1000 ? '>1 км' : L.toFixed(1) + ' м';

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
  function build() { const p = parsePoly(polyText); if (!p) { alert('Нужно минимум 3 точки: широта долгота'); return; } setBuilt(p); if (p.lon0) setTz(Math.round(p.lon0 / 15)); }

  const clock = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

  const Stat = ({ k, v, color }) => (
    <Flex justify="between" py="1" style={{ borderBottom: '1px solid var(--gray-a4)' }}>
      <Text size="2" color="gray">{k}</Text><Text size="2" weight="medium" style={color?{color}:undefined}>{v}</Text>
    </Flex>
  );

  return (
    <Theme appearance={appearance} accentColor="grass" grayColor="sage" radius="large">
      <Box style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
        <Viewport utcMs={utcMs} lat={lat} lon={lon} poly={poly} fenceH={parseFloat(fence) || 0} buildings={buildings} />

        {/* header */}
        <Flex align="center" gap="3" px="4" py="2" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
          background: 'var(--color-panel-translucent)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--gray-a4)' }}>
          <Heading size="4">☉ Инсоляр</Heading>
          <Text size="2" color="gray">React + Radix · моделирование солнца</Text>
          <Box style={{ flex: 1 }} />
          <Tabs.Root defaultValue="viz"><Tabs.List><Tabs.Trigger value="viz">Визуализация</Tabs.Trigger><Tabs.Trigger value="an">Анализ</Tabs.Trigger></Tabs.List></Tabs.Root>
          <Button variant="soft" color="gray" onClick={() => setAppearance(a => a === 'light' ? 'dark' : 'light')}>
            {appearance === 'light' ? '🌙 Тёмная' : '☀️ Светлая'}
          </Button>
        </Flex>

        {/* left panel */}
        <Card size="2" style={{ position: 'absolute', left: 16, top: 64, bottom: 88, width: 320, zIndex: 20, overflowY: 'auto' }}>
          <Flex direction="column" gap="3">
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>УЧАСТОК · КООРДИНАТЫ ТОЧЕК</Text>
              <TextArea mt="1" rows={5} value={polyText} onChange={e => setPolyText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} />
              <Flex gap="2" mt="2"><Button onClick={build}>Построить участок</Button><Button variant="soft" color="gray" onClick={() => { setBuilt(null); }}>Сбросить</Button></Flex>
            </Box>
            <Separator size="4" />
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ДАТА И ВРЕМЯ</Text>
              <Flex gap="2" mt="1">
                <TextField.Root type="date" value={date} onChange={e => setDate(e.target.value)} style={{ flex: 1 }} />
                <TextField.Root type="number" value={tz} onChange={e => setTz(parseFloat(e.target.value) || 0)} style={{ width: 84 }} />
              </Flex>
              <Flex gap="2" mt="2">
                <Button onClick={() => { setPlaying(false); setNow(); }}>Сейчас</Button>
                <Button variant={playing ? 'solid' : 'soft'} color={playing ? 'red' : 'grass'} onClick={() => setPlaying(p => !p)}>{playing ? '⏸ Стоп' : '▶ Реальное время'}</Button>
              </Flex>
            </Box>
            <Separator size="4" />
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ЗАБОР ПО ПЕРИМЕТРУ</Text>
              <Select.Root value={fence} onValueChange={setFence}>
                <Select.Trigger mt="1" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="0">Нет</Select.Item><Select.Item value="1.8">1.8 м</Select.Item>
                  <Select.Item value="2">2 м</Select.Item><Select.Item value="2.2">2.2 м</Select.Item>
                </Select.Content>
              </Select.Root>
            </Box>
            <Separator size="4" />
            <Box>
              <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '.08em' }}>ЗДАНИЯ НА УЧАСТКЕ</Text>
              <Select.Root value={preset} onValueChange={setPreset}>
                <Select.Trigger mt="1" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Group>
                    <Select.Label>Жилой дом</Select.Label>
                    <Select.Item value="Дом 6×6|6,6,5|3">Дом 6×6 м, h 5</Select.Item>
                    <Select.Item value="Дом 8×8|8,8,6|3">Дом 8×8 м, h 6</Select.Item>
                    <Select.Item value="Дом 9×9|9,9,6|3">Дом 9×9 м, h 6</Select.Item>
                    <Select.Item value="Дом 8×10|8,10,7|3">Дом 8×10 м, h 7</Select.Item>
                  </Select.Group>
                  <Select.Group>
                    <Select.Label>Хозяйственные</Select.Label>
                    <Select.Item value="Баня 4×6|4,6,3|1">Баня 4×6 м</Select.Item>
                    <Select.Item value="Гараж 6×4|6,4,3|1">Гараж 6×4 м</Select.Item>
                    <Select.Item value="Сарай 3×6|3,6,2.5|1">Сарай 3×6 м</Select.Item>
                    <Select.Item value="Беседка 3×4|3,4,3|1">Беседка 3×4 м</Select.Item>
                    <Select.Item value="Теплица 3×6|3,6,2.5|1">Теплица 3×6 м</Select.Item>
                  </Select.Group>
                </Select.Content>
              </Select.Root>
              <Button mt="2" onClick={addPreset} style={{ width: '100%' }}>+ Добавить сооружение</Button>
              <Flex direction="column" gap="1" mt="2">
                {buildings.map((b, i) => (
                  <Flex key={i} justify="between" align="center" py="1" style={{ borderBottom: '1px solid var(--gray-a4)' }}>
                    <Text size="2">{b.name} · h {b.height}{b.roofH ? '+' + b.roofH : ''} м</Text>
                    <IconButton size="1" variant="ghost" color="red" onClick={() => removeBuilding(i)}>🗑</IconButton>
                  </Flex>
                ))}
                {buildings.length === 0 && <Text size="1" color="gray">Пока пусто — добавьте дом или баню.</Text>}
              </Flex>
            </Box>
          </Flex>
        </Card>

        {/* right panel */}
        <Card size="2" style={{ position: 'absolute', right: 16, top: 64, bottom: 88, width: 300, zIndex: 20, overflowY: 'auto' }}>
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

            {(buildings.length > 0) && <>
              <Text size="1" color="gray" weight="medium" mt="3" style={{ letterSpacing: '.08em' }}>ДЛИНА ТЕНИ (СЕЙЧАС)</Text>
              <Stat k="Тень падает на" v={altDeg > 0 ? `${azToCardinal(shadowAz)} (${shadowAz.toFixed(0)}°)` : 'солнца нет'} />
              {altDeg > 0 && buildings.map((b, i) => (
                <Stat key={i} k={b.name} v={fmtLen(shadowLen(b.height + (b.roofH || 0), altDeg))} />
              ))}
            </>}
          </Flex>
        </Card>

        {/* timebar */}
        <Card size="2" style={{ position: 'absolute', left: 360, right: 340, bottom: 20, zIndex: 20 }}>
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
