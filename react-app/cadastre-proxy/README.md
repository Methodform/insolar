# Прокси «участок по кадастровому номеру» (Cloudflare Worker)

Статический сайт не может напрямую запрашивать НСПД (CORS + анти-бот).
Этот Worker ходит в НСПД с сервера, вынимает геометрию участка, переводит
её из EPSG:3857 в WGS84 и отдаёт JSON с точками `[[lat, lon], …]`.

## Деплой (бесплатный тариф Cloudflare)

Вариант А — через сайт (без установки):
1. Зайти на dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker**.
2. Назвать, например, `insolar-cadastre`. Нажать **Deploy**.
3. **Edit code** → вставить содержимое `worker.js` → **Deploy**.
4. Скопировать адрес вида `https://insolar-cadastre.ВАШ-АккаунТ.workers.dev`.

Вариант Б — через CLI:
```bash
npm i -g wrangler
wrangler login
wrangler deploy worker.js --name insolar-cadastre --compatibility-date 2024-01-01
```

## Подключение к сайту

В `react-app/src/App.jsx` заменить значение константы:
```js
const CADASTRE_PROXY = 'https://insolar-cadastre.ВАШ-АккаунТ.workers.dev';
```
Закоммитить и запушить — CI пересоберёт `/app/`.

## Проверка

Открыть в браузере:
`https://insolar-cadastre.ВАШ-АккаунТ.workers.dev/?code=63:01:0208004:12`
Должен вернуться `{ "ok": true, "points": [...] }`.

## Если НСПД блокирует
Дата-центровые IP иногда отбиваются анти-ботом. Тогда:
- повторить запрос (блокировка часто временная);
- либо добавить в Worker пул резидентных прокси (поле `proxy`).
