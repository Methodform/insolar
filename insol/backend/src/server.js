// SunPlan3d — бэкенд: Яндекс-логин + хранение проектов пользователя.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import db from './db.js';
import { signToken, verifyToken, yandexInfo } from './auth.js';
import { notifyTelegram } from './telegram.js';

const app = Fastify({ logger: true, bodyLimit: 6 * 1024 * 1024 });   // до 6 МБ (скриншот в отзыве)
const ORIGIN = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
await app.register(cors, { origin: ORIGIN.length === 1 && ORIGIN[0] === '*' ? true : ORIGIN, methods: ['GET', 'POST', 'PUT', 'DELETE'] });

// достаёт id пользователя из Bearer-JWT; при отсутствии/невалидности отвечает 401
function auth(req, reply) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  const p = t && verifyToken(t);
  if (!p) { reply.code(401).send({ error: 'unauthorized' }); return null; }
  return p.uid;
}

app.get('/health', async () => ({ ok: true }));

// вход: фронт присылает Яндекс-токен → проверяем → заводим/находим юзера → отдаём наш JWT
app.post('/auth/yandex', async (req, reply) => {
  const { token } = req.body || {};
  if (!token) return reply.code(400).send({ error: 'token required' });
  let info;
  try { info = await yandexInfo(token); } catch (e) { return reply.code(401).send({ error: 'bad yandex token' }); }
  let user = db.prepare('select * from users where yandex_id=?').get(info.id);
  if (!user) {
    const r = db.prepare('insert into users(yandex_id,email,name) values(?,?,?)').run(info.id, info.email, info.name);
    user = db.prepare('select * from users where id=?').get(r.lastInsertRowid);
  } else {
    db.prepare('update users set email=?, name=? where id=?').run(info.email, info.name, user.id);
  }
  return { jwt: signToken(user), user: { id: user.id, email: user.email, name: user.name, plan: user.plan } };
});

app.get('/me', async (req, reply) => {
  const uid = auth(req, reply); if (!uid) return;
  return { user: db.prepare('select id,email,name,plan from users where id=?').get(uid) };
});

// список проектов пользователя (без тяжёлого data_json)
app.get('/projects', async (req, reply) => {
  const uid = auth(req, reply); if (!uid) return;
  return { projects: db.prepare('select id,name,updated_at from projects where user_id=? order by updated_at desc').all(uid) };
});

app.get('/projects/:id', async (req, reply) => {
  const uid = auth(req, reply); if (!uid) return;
  const p = db.prepare('select id,name,data_json,updated_at from projects where id=? and user_id=?').get(req.params.id, uid);
  if (!p) return reply.code(404).send({ error: 'not found' });
  return { id: p.id, name: p.name, updated_at: p.updated_at, data: JSON.parse(p.data_json) };
});

app.post('/projects', async (req, reply) => {
  const uid = auth(req, reply); if (!uid) return;
  const { name, data } = req.body || {};
  if (!name || data == null) return reply.code(400).send({ error: 'name and data required' });
  const r = db.prepare('insert into projects(user_id,name,data_json) values(?,?,?)').run(uid, name, JSON.stringify(data));
  return { id: r.lastInsertRowid };
});

app.put('/projects/:id', async (req, reply) => {
  const uid = auth(req, reply); if (!uid) return;
  const own = db.prepare('select id from projects where id=? and user_id=?').get(req.params.id, uid);
  if (!own) return reply.code(404).send({ error: 'not found' });
  const { name, data } = req.body || {};
  db.prepare("update projects set name=coalesce(?,name), data_json=coalesce(?,data_json), updated_at=datetime('now') where id=?")
    .run(name ?? null, data != null ? JSON.stringify(data) : null, req.params.id);
  return { ok: true };
});

app.delete('/projects/:id', async (req, reply) => {
  const uid = auth(req, reply); if (!uid) return;
  db.prepare('delete from projects where id=? and user_id=?').run(req.params.id, uid);
  return { ok: true };
});

// обратная связь — без обязательной авторизации; прикладываем ошибки/скриншот, если есть
app.post('/feedback', async (req, reply) => {
  const { type = 'idea', message, contact, url, meta, errors, screenshot } = req.body || {};
  if (!message || !String(message).trim()) return reply.code(400).send({ error: 'message required' });
  let uid = null;
  const h = req.headers.authorization || '', t = h.startsWith('Bearer ') ? h.slice(7) : null, p = t && verifyToken(t);
  if (p) uid = p.uid;
  const metaFull = Object.assign({}, meta || {}, errors && errors.length ? { errors } : {});
  db.prepare('insert into feedback(user_id,type,message,contact,url,user_agent,meta_json,screenshot) values(?,?,?,?,?,?,?,?)')
    .run(uid, type, String(message).slice(0, 4000), contact || null, url || null, req.headers['user-agent'] || null,
      Object.keys(metaFull).length ? JSON.stringify(metaFull) : null, screenshot || null);
  notifyTelegram({ type, message, contact, url, errors, screenshot });   // fire-and-forget
  return { ok: true };
});

const port = Number(process.env.PORT || 8787);
app.listen({ port, host: '0.0.0.0' }).then(() => app.log.info('SunPlan3d backend on :' + port)).catch(e => { app.log.error(e); process.exit(1); });
