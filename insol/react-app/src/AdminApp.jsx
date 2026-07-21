import React, { useMemo, useState } from 'react';
import { Theme, Flex, Box, Grid, Card, Heading, Text, Badge, Button, IconButton,
  TextField, Select, Separator, Table, Tabs, Tooltip } from '@radix-ui/themes';
import { DashboardIcon, PersonIcon, BarChartIcon, RocketIcon, ChatBubbleIcon,
  MixIcon, MagnifyingGlassIcon, SunIcon, MoonIcon, ArrowUpIcon, ArrowDownIcon,
  DownloadIcon, CheckCircledIcon, CrossCircledIcon, ClockIcon, DotFilledIcon } from '@radix-ui/react-icons';

/* ======================================================================
   Инсоляр — админ-панель (демо-данные).
   Данные генерируются детерминированно; структура рассчитана на замену
   моков вызовами реального API (см. функции-геттеры в блоке DATA).
   ====================================================================== */

const NOW = new Date('2026-07-21T12:00:00');
const DAY = 86400000;
const rub = n => Math.round(n).toLocaleString('ru-RU') + ' ₽';
const shortNum = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const dstr = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

// тарифы: цена и месячная выручка (для MRR)
const PLANS = {
  free:   { label: 'Free',        color: 'gray',  price: 0,    monthly: 0 },
  month:  { label: 'Месяц',       color: 'blue',  price: 490,  monthly: 490 },
  season: { label: 'Сезон · 6м',  color: 'amber', price: 1490, monthly: 1490 / 6 },
  year:   { label: 'Год',         color: 'grass', price: 1990, monthly: 1990 / 12 },
};
const STATUS = {
  active:   { label: 'активна',   color: 'grass' },
  trial:    { label: 'триал',     color: 'blue' },
  past_due: { label: 'просрочка', color: 'amber' },
  expired:  { label: 'истёк',     color: 'gray' },
  canceled: { label: 'отменён',   color: 'red' },
};
const SEGMENTS = ['Частник ИЖС', 'Проектировщик', 'Риелтор'];
const REPORT_PRICE = 790; // разовый «паспорт участка»

// детерминированный ГПСЧ, чтобы данные не «прыгали» между рендерами
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const FIRST = ['Алексей', 'Марат', 'Ольга', 'Дмитрий', 'Ирина', 'Сергей', 'Наталья', 'Андрей', 'Елена', 'Павел', 'Юлия', 'Роман', 'Татьяна', 'Игорь', 'Мария', 'Виктор', 'Анна', 'Кирилл', 'Светлана', 'Максим'];
const LAST = ['Иванов', 'Петров', 'Смирнов', 'Кузнецов', 'Соколов', 'Попов', 'Лебедев', 'Козлов', 'Новиков', 'Морозов', 'Волков', 'Фёдоров', 'Михайлов', 'Никитин', 'Орлов', 'Захаров', 'Тарасов', 'Белов'];
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function genUsers(n) {
  const r = mulberry32(20260721);
  const out = [];
  for (let i = 0; i < n; i++) {
    const fn = pick(r, FIRST), ln = pick(r, LAST);
    const seg = r() < 0.7 ? 0 : r() < 0.6 ? 1 : 2; // ижс большинство
    // распределение тарифов: много free
    const pr = r();
    let plan = 'free';
    if (pr > 0.62 && pr <= 0.78) plan = 'month';
    else if (pr > 0.78 && pr <= 0.9) plan = 'season';
    else if (pr > 0.9) plan = 'year';
    let status = 'active';
    if (plan === 'free') status = 'active';
    else { const s = r(); status = s < 0.72 ? 'active' : s < 0.82 ? 'trial' : s < 0.9 ? 'past_due' : s < 0.96 ? 'expired' : 'canceled'; }
    const regAgo = Math.floor(r() * 360);
    const reg = new Date(NOW - regAgo * DAY);
    const lastAgo = Math.floor(r() * Math.min(regAgo + 1, 40));
    const last = new Date(NOW - lastAgo * DAY);
    const plots = 1 + Math.floor(r() * (plan === 'free' ? 2 : 6));
    const reports = plan === 'free' ? (r() < 0.12 ? 1 : 0) : Math.floor(r() * 3); // разовые паспорта
    const ltv = (plan === 'free' ? 0 : PLANS[plan].price) + reports * REPORT_PRICE;
    out.push({
      id: 'U' + String(1000 + i), name: fn + ' ' + ln,
      email: translit(fn) + '.' + translit(ln) + i + '@mail.ru',
      segment: SEGMENTS[seg], plan, status, reg, last, plots, reports, ltv,
    });
  }
  return out;
}
function translit(s) {
  const m = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  return s.toLowerCase().split('').map(c => m[c] ?? c).join('');
}

function genTxns(users) {
  const r = mulberry32(77);
  const out = [];
  let k = 0;
  users.forEach(u => {
    if (u.plan !== 'free') {
      out.push({ id: 'T' + (2000 + k++), date: u.reg, email: u.email, kind: 'Подписка · ' + PLANS[u.plan].label, amount: PLANS[u.plan].price, status: u.status === 'canceled' && r() < 0.5 ? 'refunded' : 'paid', method: r() < 0.7 ? 'Карта' : 'СБП' });
    }
    for (let i = 0; i < u.reports; i++) {
      const d = new Date(u.reg.getTime() + Math.floor(r() * 120) * DAY);
      out.push({ id: 'T' + (2000 + k++), date: d > NOW ? NOW : d, email: u.email, kind: 'Паспорт участка', amount: REPORT_PRICE, status: r() < 0.05 ? 'failed' : 'paid', method: r() < 0.6 ? 'Карта' : 'СБП' });
    }
  });
  return out.sort((a, b) => b.date - a.date);
}

const FEEDBACK = [
  { id: 'F1', date: new Date(NOW - 1 * DAY), user: 'olga.popova7@mail.ru', type: 'Баг', rating: null, text: 'Тень от дома пропадает при зуме на телефоне.', status: 'new' },
  { id: 'F2', date: new Date(NOW - 1 * DAY), user: 'dmitriy.volkov3@mail.ru', type: 'Идея', rating: null, text: 'Добавьте шаринг участка ссылкой соседу.', status: 'new' },
  { id: 'F3', date: new Date(NOW - 2 * DAY), user: 'irina.sokolova12@mail.ru', type: 'Оценка', rating: 5, text: 'Помогло понять, куда ставить дом. Спасибо!', status: 'closed' },
  { id: 'F4', date: new Date(NOW - 3 * DAY), user: 'sergey.orlov21@mail.ru', type: 'Вопрос', rating: null, text: 'Отчёт подойдёт для согласования с администрацией?', status: 'in_progress' },
  { id: 'F5', date: new Date(NOW - 3 * DAY), user: 'pavel.belov9@mail.ru', type: 'Баг', rating: null, text: 'Кадастр по номеру не находит участок в СНТ.', status: 'in_progress' },
  { id: 'F6', date: new Date(NOW - 5 * DAY), user: 'elena.morozova5@mail.ru', type: 'Оценка', rating: 4, text: 'Удобно, но хотелось бы больше пресетов построек.', status: 'closed' },
  { id: 'F7', date: new Date(NOW - 6 * DAY), user: 'roman.novikov14@mail.ru', type: 'Идея', rating: null, text: 'Сравнение вариантов A/B рядом.', status: 'new' },
  { id: 'F8', date: new Date(NOW - 8 * DAY), user: 'anna.zaharova18@mail.ru', type: 'Оценка', rating: 5, text: '3D-аналитика — топ. Купила год.', status: 'closed' },
  { id: 'F9', date: new Date(NOW - 10 * DAY), user: 'igor.fedorov2@mail.ru', type: 'Баг', rating: null, text: 'PDF-отчёт не открывается в Safari.', status: 'closed' },
  { id: 'F10', date: new Date(NOW - 12 * DAY), user: 'maria.nikitina6@mail.ru', type: 'Вопрос', rating: null, text: 'Можно ли вернуть деньги за паспорт?', status: 'closed' },
];

const INIT_PROMOS = [
  { code: 'DACHA25', kind: 'Скидка %', value: 25, uses: 142, limit: 500, expires: new Date('2026-09-01'), active: true },
  { code: 'SEZON10', kind: 'Скидка ₽', value: 300, uses: 63, limit: 300, expires: new Date('2026-08-15'), active: true },
  { code: 'TRIAL7', kind: 'Триал, дней', value: 7, uses: 388, limit: 0, expires: new Date('2026-12-31'), active: true },
  { code: 'RIELTOR', kind: 'Скидка %', value: 40, uses: 21, limit: 100, expires: new Date('2026-08-01'), active: true },
  { code: 'VESNA24', kind: 'Скидка %', value: 20, uses: 210, limit: 210, expires: new Date('2026-05-01'), active: false },
];

/* --------------------------- мини-графики (SVG) --------------------------- */
function StackedBars({ series, keys, height = 170, fmt = shortNum }) {
  const W = 620, H = height, padL = 40, padB = 22, padT = 10;
  const max = Math.max(1, ...series.map(s => keys.reduce((a, k) => a + (s[k.k] || 0), 0)));
  const step = 4; const niceMax = Math.ceil(max / step) * step;
  const bw = (W - padL) / series.length * 0.6, gap = (W - padL) / series.length;
  const y = v => padT + (H - padT - padB) * (1 - v / niceMax);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => { const val = niceMax * (1 - t); const yy = padT + (H - padT - padB) * t;
        return <g key={i}><line x1={padL} y1={yy} x2={W} y2={yy} stroke="var(--gray-a4)" strokeWidth="1" />
          <text x={padL - 6} y={yy + 3} fontSize="9" fill="var(--gray-9)" textAnchor="end">{fmt(val)}</text></g>; })}
      {series.map((s, i) => { let acc = 0; const x = padL + gap * i + (gap - bw) / 2;
        return <g key={i}>
          {keys.map((k, ki) => { const v = s[k.k] || 0; const y0 = y(acc), y1 = y(acc + v); acc += v;
            return v > 0 ? <rect key={ki} x={x} y={y1} width={bw} height={Math.max(0, y0 - y1)} fill={k.color} rx="1.5">
              <title>{`${s.label}: ${k.label} ${fmt(v)}`}</title></rect> : null; })}
          <text x={x + bw / 2} y={H - 7} fontSize="9" fill="var(--gray-10)" textAnchor="middle">{s.label}</text>
        </g>; })}
    </svg>
  );
}

function Donut({ segments, size = 150 }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const R = size / 2, r = R * 0.62, cx = R, cy = R; let ang = -Math.PI / 2;
  const arc = frac => { const a0 = ang, a1 = ang + frac * Math.PI * 2; ang = a1;
    const p = (a, rad) => [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
    const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
    const large = frac > 0.5 ? 1 : 0;
    return `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`; };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }}>
      {segments.map((s, i) => <path key={i} d={arc(s.value / total)} fill={s.color}><title>{`${s.label}: ${s.value}`}</title></path>)}
      <circle cx={cx} cy={cy} r={r - 1} fill="var(--color-panel-solid)" />
      <text x={cx} y={cy - 2} fontSize="20" fontWeight="700" fill="var(--gray-12)" textAnchor="middle">{total}</text>
      <text x={cx} y={cy + 14} fontSize="9" fill="var(--gray-10)" textAnchor="middle">всего</text>
    </svg>
  );
}

function Funnel({ steps }) {
  const max = steps[0]?.value || 1;
  return (
    <Flex direction="column" gap="2">
      {steps.map((s, i) => { const pct = Math.round(s.value / max * 100);
        const conv = i > 0 ? Math.round(s.value / steps[i - 1].value * 100) : 100;
        return (
          <Box key={i}>
            <Flex justify="between" mb="1"><Text size="1" color="gray">{s.label}</Text>
              <Text size="1" weight="medium">{s.value.toLocaleString('ru-RU')} · {pct}%{i > 0 && <Text size="1" color={conv < 40 ? 'red' : 'gray'}> (шаг {conv}%)</Text>}</Text></Flex>
            <Box style={{ background: 'var(--gray-a3)', borderRadius: 6, height: 14, overflow: 'hidden' }}>
              <Box style={{ width: pct + '%', height: '100%', background: 'var(--grass-9)', borderRadius: 6 }} />
            </Box>
          </Box>
        ); })}
    </Flex>
  );
}

/* ------------------------------- виджеты ------------------------------- */
function Kpi({ label, value, sub, delta }) {
  const up = delta != null && delta >= 0;
  return (
    <Card size="2" className="panel-card">
      <Text size="1" color="gray" style={{ display: 'block' }}>{label}</Text>
      <Text size="6" weight="bold" style={{ display: 'block', lineHeight: 1.2 }}>{value}</Text>
      <Flex align="center" gap="1" mt="1">
        {delta != null && <Badge color={up ? 'grass' : 'red'} variant="soft" size="1">
          {up ? <ArrowUpIcon width="11" /> : <ArrowDownIcon width="11" />}{Math.abs(delta)}%</Badge>}
        {sub && <Text size="1" color="gray">{sub}</Text>}
      </Flex>
    </Card>
  );
}
const Section = ({ title, desc, children, right }) => (
  <Card size="3" className="panel-card" mb="4">
    <Flex justify="between" align="start" mb={desc ? '1' : '3'} gap="3" wrap="wrap">
      <Box><Heading size="4">{title}</Heading>{desc && <Text size="2" color="gray">{desc}</Text>}</Box>
      {right}
    </Flex>
    {desc && <Box mt="3" />}
    {children}
  </Card>
);

/* ================================ APP ================================ */
export default function AdminApp() {
  const [dark, setDark] = useState(false);
  const [nav, setNav] = useState('overview');
  const [users, setUsers] = useState(() => genUsers(64));
  const txns = useMemo(() => genTxns(users), [users]);
  const [promos, setPromos] = useState(INIT_PROMOS);
  const [feedback, setFeedback] = useState(FEEDBACK);

  // ------- агрегаты -------
  const m = useMemo(() => {
    const paid = users.filter(u => u.plan !== 'free');
    const activeSubs = paid.filter(u => u.status === 'active' || u.status === 'trial');
    const mrr = activeSubs.reduce((a, u) => a + PLANS[u.plan].monthly, 0);
    const reportTxns = txns.filter(t => t.kind === 'Паспорт участка' && t.status === 'paid');
    const reportRev30 = reportTxns.filter(t => NOW - t.date <= 30 * DAY).reduce((a, t) => a + t.amount, 0);
    const reportRevAll = reportTxns.reduce((a, t) => a + t.amount, 0);
    const subRevAll = txns.filter(t => t.kind.startsWith('Подписка') && t.status === 'paid').reduce((a, t) => a + t.amount, 0);
    const signups30 = users.filter(u => NOW - u.reg <= 30 * DAY).length;
    const conv = Math.round(paid.length / users.length * 100);
    const churn = Math.round(paid.filter(u => u.status === 'canceled' || u.status === 'expired').length / Math.max(1, paid.length) * 100);
    const arppu = Math.round(mrr / Math.max(1, activeSubs.length));
    return { paid, activeSubs, mrr, reportRev30, reportRevAll, subRevAll, signups30, conv, churn, arppu };
  }, [users, txns]);

  // помесячные ряды (12 мес) по датам транзакций и регистраций
  const trends = useMemo(() => {
    const rev = [], sign = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(NOW.getFullYear(), NOW.getMonth() - i, 1);
      const inMonth = t => t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth();
      const sub = txns.filter(t => t.status === 'paid' && t.kind.startsWith('Подписка') && inMonth(t.date)).reduce((a, t) => a + t.amount, 0);
      const rep = txns.filter(t => t.status === 'paid' && t.kind === 'Паспорт участка' && inMonth(t.date)).reduce((a, t) => a + t.amount, 0);
      rev.push({ label: MONTHS[d.getMonth()], sub, rep });
      sign.push({ label: MONTHS[d.getMonth()], n: users.filter(u => inMonth(u.reg)).length });
    }
    return { rev, sign };
  }, [users, txns]);

  const planDist = useMemo(() => ['free', 'month', 'season', 'year'].map(p => ({
    label: PLANS[p].label, value: users.filter(u => u.plan === p).length,
    color: `var(--${PLANS[p].color === 'gray' ? 'gray' : PLANS[p].color}-9)`,
  })), [users]);

  const productKpis = useMemo(() => ({
    plots: users.reduce((a, u) => a + u.plots, 0),
    reports: txns.filter(t => t.kind === 'Паспорт участка' && t.status === 'paid').length,
    cadastre: Math.round(users.reduce((a, u) => a + u.plots, 0) * 0.42),
    pdf: Math.round(users.reduce((a, u) => a + u.plots, 0) * 0.31),
  }), [users, txns]);

  const funnel = [
    { label: 'Зашли на /app', value: 4820 },
    { label: 'Построили участок', value: 2611 },
    { label: 'Добавили объект/постройку', value: 1204 },
    { label: 'Досмотрели до инсоляции (aha, ~180с)', value: 742 },
    { label: 'Оплатили (подписка или паспорт)', value: 143 },
  ];

  const NAVI = [
    { k: 'overview', label: 'Обзор', icon: <DashboardIcon /> },
    { k: 'users', label: 'Пользователи', icon: <PersonIcon /> },
    { k: 'finance', label: 'Финансы и платежи', icon: <BarChartIcon /> },
    { k: 'analytics', label: 'Продуктовая аналитика', icon: <RocketIcon /> },
    { k: 'support', label: 'Поддержка и фидбек', icon: <ChatBubbleIcon /> },
    { k: 'promo', label: 'Промокоды и тарифы', icon: <MixIcon /> },
  ];

  return (
    <Theme appearance={dark ? 'dark' : 'light'} accentColor="grass" grayColor="sage" radius="large" panelBackground="solid">
      <Flex style={{ minHeight: '100vh', background: 'var(--color-background)' }}>
        {/* sidebar */}
        <Box style={{ width: 236, flexShrink: 0, borderRight: '1px solid var(--gray-a4)', background: 'var(--color-panel-solid)', position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column' }}>
          <Flex align="center" gap="2" px="4" py="4"><SunIcon width="22" height="22" color="var(--grass-11)" />
            <Box><Heading size="3">Инсоляр</Heading><Text size="1" color="gray">админ-панель</Text></Box></Flex>
          <Separator size="4" />
          <Flex direction="column" gap="1" p="3" style={{ flex: 1 }}>
            {NAVI.map(n => (
              <Button key={n.k} variant={nav === n.k ? 'soft' : 'ghost'} color={nav === n.k ? 'grass' : 'gray'}
                onClick={() => setNav(n.k)} style={{ justifyContent: 'flex-start', width: '100%' }}>
                {n.icon}{n.label}
              </Button>
            ))}
          </Flex>
          <Separator size="4" />
          <Flex align="center" justify="between" p="3">
            <Flex align="center" gap="2"><Box style={{ width: 28, height: 28, borderRadius: 999, background: 'var(--grass-9)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>MA</Box>
              <Box><Text size="1" weight="medium" style={{ display: 'block' }}>Marat</Text><Text size="1" color="gray">Owner</Text></Box></Flex>
            <IconButton variant="ghost" color="gray" onClick={() => setDark(v => !v)} title="Тема">{dark ? <SunIcon /> : <MoonIcon />}</IconButton>
          </Flex>
        </Box>

        {/* content */}
        <Box style={{ flex: 1, minWidth: 0, padding: 24, maxWidth: 1180 }}>
          {nav === 'overview' && <Overview m={m} trends={trends} planDist={planDist} funnel={funnel} productKpis={productKpis} />}
          {nav === 'users' && <Users users={users} setUsers={setUsers} />}
          {nav === 'finance' && <Finance m={m} trends={trends} txns={txns} />}
          {nav === 'analytics' && <Analytics funnel={funnel} productKpis={productKpis} m={m} trends={trends} />}
          {nav === 'support' && <Support feedback={feedback} setFeedback={setFeedback} />}
          {nav === 'promo' && <Promo promos={promos} setPromos={setPromos} users={users} setUsers={setUsers} />}
        </Box>
      </Flex>
    </Theme>
  );
}

/* ------------------------------- ОБЗОР ------------------------------- */
function Overview({ m, trends, planDist, funnel, productKpis }) {
  return (
    <>
      <Heading size="6" mb="1">Обзор</Heading>
      <Text size="2" color="gray" as="p" mb="4">Демо-данные. Ключевой фокус монетизации — разовый «паспорт участка» (боль частника разовая), подписка вторична.</Text>
      <Grid columns={{ initial: '2', md: '4' }} gap="3" mb="4">
        <Kpi label="MRR (подписки)" value={rub(m.mrr)} delta={8} sub="активных подписок" />
        <Kpi label="Разовые (паспорта, 30д)" value={rub(m.reportRev30)} delta={17} sub="главный доход" />
        <Kpi label="Новые за 30 дней" value={m.signups30} delta={12} />
        <Kpi label="Конверсия Free→платно" value={m.conv + '%'} delta={2} />
      </Grid>
      <Grid columns={{ initial: '1', md: '3' }} gap="4">
        <Box style={{ gridColumn: 'span 2' }}>
          <Section title="Выручка по месяцам" desc="Подписки (зелёный) и разовые паспорта (янтарный), ₽">
            <StackedBars series={trends.rev} keys={[{ k: 'sub', color: 'var(--grass-9)', label: 'подписки' }, { k: 'rep', color: 'var(--amber-9)', label: 'паспорта' }]} fmt={rub} />
            <Flex gap="4" mt="2"><Legend color="var(--grass-9)" label="Подписки" /><Legend color="var(--amber-9)" label="Паспорта участка" /></Flex>
          </Section>
        </Box>
        <Section title="Тарифы" desc="Распределение пользователей">
          <Flex direction="column" align="center" gap="3">
            <Donut segments={planDist} />
            <Flex direction="column" gap="1" style={{ width: '100%' }}>
              {planDist.map((s, i) => <Flex key={i} justify="between"><Legend color={s.color} label={s.label} /><Text size="1" weight="medium">{s.value}</Text></Flex>)}
            </Flex>
          </Flex>
        </Section>
      </Grid>
      <Grid columns={{ initial: '1', md: '2' }} gap="4">
        <Section title="Воронка активации" desc="Путь до aha-момента и оплаты (за 30 дней)">
          <Funnel steps={funnel} />
        </Section>
        <Section title="Продукт в цифрах" desc="Активность за всё время">
          <Grid columns="2" gap="3">
            <Kpi label="Создано участков" value={productKpis.plots} />
            <Kpi label="Куплено паспортов" value={productKpis.reports} />
            <Kpi label="Запросов кадастра" value={productKpis.cadastre} />
            <Kpi label="Сформировано PDF" value={productKpis.pdf} />
          </Grid>
        </Section>
      </Grid>
    </>
  );
}
const Legend = ({ color, label }) => (
  <Flex align="center" gap="1"><Box style={{ width: 10, height: 10, borderRadius: 3, background: color }} /><Text size="1" color="gray">{label}</Text></Flex>
);

/* ---------------------------- ПОЛЬЗОВАТЕЛИ ---------------------------- */
function Users({ users, setUsers }) {
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('all');
  const [seg, setSeg] = useState('all');
  const rows = users.filter(u =>
    (plan === 'all' || u.plan === plan) && (seg === 'all' || u.segment === seg) &&
    (!q || u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()) || u.id.toLowerCase().includes(q.toLowerCase())));
  const changePlan = (id, p) => setUsers(us => us.map(u => u.id === id ? { ...u, plan: p, status: p === 'free' ? 'active' : (u.status === 'active' ? 'active' : 'active') } : u));

  return (
    <>
      <Heading size="6" mb="1">Пользователи</Heading>
      <Text size="2" color="gray" as="p" mb="4">{rows.length} из {users.length}. Тариф можно сменить вручную в строке.</Text>
      <Section title="" right={
        <Flex gap="2" wrap="wrap">
          <TextField.Root placeholder="Поиск: имя, email, ID" value={q} onChange={e => setQ(e.target.value)} style={{ width: 230 }}>
            <TextField.Slot><MagnifyingGlassIcon /></TextField.Slot></TextField.Root>
          <Select.Root value={plan} onValueChange={setPlan}><Select.Trigger placeholder="Тариф" />
            <Select.Content><Select.Item value="all">Все тарифы</Select.Item>
              {Object.keys(PLANS).map(p => <Select.Item key={p} value={p}>{PLANS[p].label}</Select.Item>)}</Select.Content></Select.Root>
          <Select.Root value={seg} onValueChange={setSeg}><Select.Trigger placeholder="Сегмент" />
            <Select.Content><Select.Item value="all">Все сегменты</Select.Item>
              {SEGMENTS.map(s => <Select.Item key={s} value={s}>{s}</Select.Item>)}</Select.Content></Select.Root>
        </Flex>
      }>
        <Table.Root variant="surface" size="1">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Пользователь</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Сегмент</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Тариф</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Статус</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Регистрация</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Актив.</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right">LTV</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Сменить тариф</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.slice(0, 40).map(u => (
              <Table.Row key={u.id}>
                <Table.Cell>
                  <Text size="2" weight="medium" style={{ display: 'block' }}>{u.name}</Text>
                  <Text size="1" color="gray">{u.email} · {u.id}</Text>
                </Table.Cell>
                <Table.Cell><Text size="1">{u.segment}</Text></Table.Cell>
                <Table.Cell><Badge color={PLANS[u.plan].color}>{PLANS[u.plan].label}</Badge></Table.Cell>
                <Table.Cell><Badge variant="soft" color={STATUS[u.status].color}>{STATUS[u.status].label}</Badge></Table.Cell>
                <Table.Cell><Text size="1">{dstr(u.reg)}</Text></Table.Cell>
                <Table.Cell><Text size="1" color="gray">{Math.round((NOW - u.last) / DAY)} дн. назад</Text></Table.Cell>
                <Table.Cell align="right"><Text size="2" weight="medium">{rub(u.ltv)}</Text></Table.Cell>
                <Table.Cell>
                  <Select.Root value={u.plan} onValueChange={p => changePlan(u.id, p)} size="1">
                    <Select.Trigger variant="soft" /><Select.Content>
                      {Object.keys(PLANS).map(p => <Select.Item key={p} value={p}>{PLANS[p].label}</Select.Item>)}</Select.Content></Select.Root>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
        {rows.length > 40 && <Text size="1" color="gray" mt="2" style={{ display: 'block' }}>Показаны первые 40. Уточните фильтр.</Text>}
      </Section>
    </>
  );
}

/* --------------------------- ФИНАНСЫ И ПЛАТЕЖИ --------------------------- */
function Finance({ m, trends, txns }) {
  const [f, setF] = useState('all');
  const badge = { paid: 'grass', refunded: 'amber', failed: 'red' };
  const blab = { paid: 'оплачен', refunded: 'возврат', failed: 'ошибка' };
  const list = txns.filter(t => f === 'all' || t.status === f).slice(0, 40);
  return (
    <>
      <Heading size="6" mb="1">Финансы и платежи</Heading>
      <Text size="2" color="gray" as="p" mb="4">Демо-данные по транзакциям и выручке.</Text>
      <Grid columns={{ initial: '2', md: '4' }} gap="3" mb="4">
        <Kpi label="MRR" value={rub(m.mrr)} delta={8} />
        <Kpi label="Выручка: паспорта (всего)" value={rub(m.reportRevAll)} sub="разовые" />
        <Kpi label="Выручка: подписки (всего)" value={rub(m.subRevAll)} />
        <Kpi label="Отток подписок" value={m.churn + '%'} delta={-3} />
      </Grid>
      <Section title="Выручка по месяцам" desc="Подписки vs разовые паспорта, ₽">
        <StackedBars series={trends.rev} keys={[{ k: 'sub', color: 'var(--grass-9)', label: 'подписки' }, { k: 'rep', color: 'var(--amber-9)', label: 'паспорта' }]} fmt={rub} />
        <Flex gap="4" mt="2"><Legend color="var(--grass-9)" label="Подписки" /><Legend color="var(--amber-9)" label="Паспорта участка" /></Flex>
      </Section>
      <Section title="Транзакции" right={
        <Select.Root value={f} onValueChange={setF}><Select.Trigger placeholder="Статус" />
          <Select.Content><Select.Item value="all">Все</Select.Item><Select.Item value="paid">Оплачены</Select.Item>
            <Select.Item value="refunded">Возвраты</Select.Item><Select.Item value="failed">Ошибки</Select.Item></Select.Content></Select.Root>
      }>
        <Table.Root variant="surface" size="1">
          <Table.Header><Table.Row>
            <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Дата</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Пользователь</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Тип</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Способ</Table.ColumnHeaderCell><Table.ColumnHeaderCell align="right">Сумма</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Статус</Table.ColumnHeaderCell></Table.Row></Table.Header>
          <Table.Body>
            {list.map(t => (
              <Table.Row key={t.id}>
                <Table.Cell><Text size="1" color="gray">{t.id}</Text></Table.Cell>
                <Table.Cell><Text size="1">{dstr(t.date)}</Text></Table.Cell>
                <Table.Cell><Text size="1">{t.email}</Text></Table.Cell>
                <Table.Cell><Text size="2">{t.kind}</Text></Table.Cell>
                <Table.Cell><Text size="1" color="gray">{t.method}</Text></Table.Cell>
                <Table.Cell align="right"><Text size="2" weight="medium">{rub(t.amount)}</Text></Table.Cell>
                <Table.Cell><Badge variant="soft" color={badge[t.status]}>{blab[t.status]}</Badge></Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Section>
    </>
  );
}

/* ------------------------- ПРОДУКТОВАЯ АНАЛИТИКА ------------------------- */
function Analytics({ funnel, productKpis, m, trends }) {
  return (
    <>
      <Heading size="6" mb="1">Продуктовая аналитика</Heading>
      <Text size="2" color="gray" as="p" mb="4">Использование продукта и воронка до aha-момента («первые 180 секунд»).</Text>
      <Grid columns={{ initial: '2', md: '4' }} gap="3" mb="4">
        <Kpi label="Создано участков" value={productKpis.plots} delta={9} />
        <Kpi label="Запросов кадастра" value={productKpis.cadastre} delta={5} />
        <Kpi label="Сформировано PDF" value={productKpis.pdf} delta={14} />
        <Kpi label="Куплено паспортов" value={productKpis.reports} delta={17} />
      </Grid>
      <Grid columns={{ initial: '1', md: '2' }} gap="4">
        <Section title="Воронка активации" desc="Где теряем пользователей до оплаты">
          <Funnel steps={funnel} />
          <Text size="1" color="gray" mt="3" style={{ display: 'block' }}>Самый узкий шаг — «добавили объект → досмотрели до инсоляции». Тут искать улучшения онбординга.</Text>
        </Section>
        <Section title="Новые пользователи по месяцам" desc="Регистрации">
          <StackedBars series={trends.sign} keys={[{ k: 'n', color: 'var(--blue-9)', label: 'регистрации' }]} fmt={shortNum} />
          <Box mt="3" />
          <Grid columns="2" gap="3">
            <Kpi label="Конверсия Free→платно" value={m.conv + '%'} />
            <Kpi label="ARPPU (платящий/мес)" value={rub(m.arppu)} />
          </Grid>
        </Section>
      </Grid>
    </>
  );
}

/* --------------------------- ПОДДЕРЖКА И ФИДБЕК --------------------------- */
function Support({ feedback, setFeedback }) {
  const [f, setF] = useState('all');
  const typeColor = { 'Баг': 'red', 'Идея': 'grass', 'Вопрос': 'blue', 'Оценка': 'amber' };
  const stat = { new: { l: 'новое', c: 'red', i: <DotFilledIcon /> }, in_progress: { l: 'в работе', c: 'amber', i: <ClockIcon /> }, closed: { l: 'закрыто', c: 'gray', i: <CheckCircledIcon /> } };
  const list = feedback.filter(x => f === 'all' || x.status === f);
  const cycle = id => setFeedback(fb => fb.map(x => x.id === id ? { ...x, status: x.status === 'new' ? 'in_progress' : x.status === 'in_progress' ? 'closed' : 'new' } : x));
  const counts = { new: feedback.filter(x => x.status === 'new').length, in_progress: feedback.filter(x => x.status === 'in_progress').length };
  const avg = (feedback.filter(x => x.rating).reduce((a, x) => a + x.rating, 0) / Math.max(1, feedback.filter(x => x.rating).length)).toFixed(1);
  return (
    <>
      <Heading size="6" mb="1">Поддержка и фидбек</Heading>
      <Text size="2" color="gray" as="p" mb="4">Сообщения, баг-репорты и оценки. Клик по статусу — переключить.</Text>
      <Grid columns={{ initial: '2', md: '4' }} gap="3" mb="4">
        <Kpi label="Новых обращений" value={counts.new} />
        <Kpi label="В работе" value={counts.in_progress} />
        <Kpi label="Средняя оценка" value={avg + ' / 5'} />
        <Kpi label="Всего за месяц" value={feedback.length} />
      </Grid>
      <Section title="Обращения" right={
        <Select.Root value={f} onValueChange={setF}><Select.Trigger placeholder="Статус" />
          <Select.Content><Select.Item value="all">Все</Select.Item><Select.Item value="new">Новые</Select.Item>
            <Select.Item value="in_progress">В работе</Select.Item><Select.Item value="closed">Закрытые</Select.Item></Select.Content></Select.Root>
      }>
        <Table.Root variant="surface" size="1">
          <Table.Header><Table.Row>
            <Table.ColumnHeaderCell>Дата</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Тип</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Пользователь</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Сообщение</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Статус</Table.ColumnHeaderCell></Table.Row></Table.Header>
          <Table.Body>
            {list.map(x => (
              <Table.Row key={x.id}>
                <Table.Cell><Text size="1">{dstr(x.date)}</Text></Table.Cell>
                <Table.Cell><Badge variant="soft" color={typeColor[x.type]}>{x.type}{x.rating ? ' ' + x.rating + '★' : ''}</Badge></Table.Cell>
                <Table.Cell><Text size="1">{x.user}</Text></Table.Cell>
                <Table.Cell><Text size="2">{x.text}</Text></Table.Cell>
                <Table.Cell>
                  <Button size="1" variant="soft" color={stat[x.status].c} onClick={() => cycle(x.id)}>{stat[x.status].i}{stat[x.status].l}</Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Section>
    </>
  );
}

/* --------------------------- ПРОМОКОДЫ И ТАРИФЫ --------------------------- */
function Promo({ promos, setPromos, users, setUsers }) {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState('Скидка %');
  const [value, setValue] = useState('20');
  const [limit, setLimit] = useState('200');
  const add = () => {
    if (!code.trim()) return;
    setPromos(ps => [{ code: code.trim().toUpperCase(), kind, value: +value || 0, uses: 0, limit: +limit || 0, expires: new Date(NOW.getTime() + 90 * DAY), active: true }, ...ps]);
    setCode('');
  };
  const toggle = c => setPromos(ps => ps.map(p => p.code === c ? { ...p, active: !p.active } : p));

  // сводка по тарифам для ручного управления
  const planCounts = ['free', 'month', 'season', 'year'].map(p => ({ p, n: users.filter(u => u.plan === p).length }));
  const bump = (from, to) => { const u = users.find(x => x.plan === from); if (u) setUsers(us => us.map(x => x.id === u.id ? { ...x, plan: to } : x)); };

  return (
    <>
      <Heading size="6" mb="1">Промокоды и тарифы</Heading>
      <Text size="2" color="gray" as="p" mb="4">Управление промокодами, триалами и тарифной линейкой.</Text>

      <Section title="Создать промокод">
        <Flex gap="2" wrap="wrap" align="end">
          <Box><Text size="1" color="gray">Код</Text><TextField.Root placeholder="LETO2026" value={code} onChange={e => setCode(e.target.value)} style={{ width: 160 }} /></Box>
          <Box><Text size="1" color="gray">Тип</Text>
            <Select.Root value={kind} onValueChange={setKind}><Select.Trigger />
              <Select.Content><Select.Item value="Скидка %">Скидка %</Select.Item><Select.Item value="Скидка ₽">Скидка ₽</Select.Item><Select.Item value="Триал, дней">Триал, дней</Select.Item></Select.Content></Select.Root></Box>
          <Box><Text size="1" color="gray">Значение</Text><TextField.Root type="number" value={value} onChange={e => setValue(e.target.value)} style={{ width: 100 }} /></Box>
          <Box><Text size="1" color="gray">Лимит (0 — без)</Text><TextField.Root type="number" value={limit} onChange={e => setLimit(e.target.value)} style={{ width: 120 }} /></Box>
          <Button onClick={add}>Создать</Button>
        </Flex>
      </Section>

      <Section title="Промокоды">
        <Table.Root variant="surface" size="1">
          <Table.Header><Table.Row>
            <Table.ColumnHeaderCell>Код</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Тип</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell align="right">Значение</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Использ.</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Действует до</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Статус</Table.ColumnHeaderCell></Table.Row></Table.Header>
          <Table.Body>
            {promos.map(p => (
              <Table.Row key={p.code}>
                <Table.Cell><Text size="2" weight="medium" style={{ fontFamily: 'monospace' }}>{p.code}</Text></Table.Cell>
                <Table.Cell><Text size="1">{p.kind}</Text></Table.Cell>
                <Table.Cell align="right"><Text size="2">{p.value}{p.kind === 'Скидка %' ? '%' : p.kind === 'Скидка ₽' ? ' ₽' : ' дн.'}</Text></Table.Cell>
                <Table.Cell><Text size="1" color="gray">{p.uses}{p.limit ? ' / ' + p.limit : ''}</Text></Table.Cell>
                <Table.Cell><Text size="1">{dstr(p.expires)}</Text></Table.Cell>
                <Table.Cell><Button size="1" variant="soft" color={p.active ? 'grass' : 'gray'} onClick={() => toggle(p.code)}>{p.active ? 'активен' : 'выключен'}</Button></Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Section>

      <Section title="Тарифная линейка" desc="Текущие цены (демо). Правится в проде через биллинг.">
        <Grid columns={{ initial: '2', md: '4' }} gap="3">
          {['free', 'month', 'season', 'year'].map(p => (
            <Card key={p} className="panel-card">
              <Badge color={PLANS[p].color} mb="2">{PLANS[p].label}</Badge>
              <Text size="5" weight="bold" style={{ display: 'block' }}>{p === 'free' ? '0 ₽' : rub(PLANS[p].price)}</Text>
              <Text size="1" color="gray">{planCounts.find(x => x.p === p).n} польз.</Text>
            </Card>
          ))}
        </Grid>
        <Text size="1" color="gray" mt="3" style={{ display: 'block' }}>Разовый «Паспорт участка»: {rub(REPORT_PRICE)} — основной продукт для частника.</Text>
      </Section>
    </>
  );
}
