// Авторизация: проверка Яндекс-токена + выпуск собственного JWT (сессии).
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_TTL = process.env.JWT_TTL || '30d';

export function signToken(user) {
  return jwt.sign({ uid: user.id, plan: user.plan }, JWT_SECRET, { expiresIn: JWT_TTL });
}

export function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
}

// Проверяет OAuth-токен Яндекса и возвращает базовый профиль пользователя.
export async function yandexInfo(token) {
  const r = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: 'OAuth ' + token },
  });
  if (!r.ok) throw new Error('yandex info http ' + r.status);
  const j = await r.json();
  return { id: String(j.id), email: j.default_email || null, name: j.real_name || j.display_name || null };
}
