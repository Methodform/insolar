// Клиент к бэкенду SunPlan3d. Пустой VITE_API_URL → облачные функции выключены (работает файловый режим).
const API = (import.meta.env && import.meta.env.VITE_API_URL) || '';

let token = null;
try { token = localStorage.getItem('sp_jwt'); } catch (e) {}

export function hasApi() { return !!API; }
export function isAuthed() { return !!token; }
export function setToken(t) { token = t || null; try { t ? localStorage.setItem('sp_jwt', t) : localStorage.removeItem('sp_jwt'); } catch (e) {} }
export function logout() { setToken(null); }

async function req(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) },
  });
  if (r.status === 401) { setToken(null); throw new Error('unauthorized'); }
  if (!r.ok) throw new Error('api ' + r.status);
  return r.status === 204 ? null : r.json();
}

// вход: отдаём Яндекс-OAuth-токен (его получает yandexAuth.js на фронте) → получаем сессию бэкенда
export async function loginYandex(yandexToken) {
  const d = await req('/auth/yandex', { method: 'POST', body: JSON.stringify({ token: yandexToken }) });
  setToken(d.jwt);
  return d.user;
}
export const me = () => req('/me').then(d => d.user);
export const listProjects = () => req('/projects').then(d => d.projects);
export const getProject = id => req('/projects/' + id);                                   // { id, name, data, updated_at }
export const createProject = (name, data) => req('/projects', { method: 'POST', body: JSON.stringify({ name, data }) });
export const updateProject = (id, patch) => req('/projects/' + id, { method: 'PUT', body: JSON.stringify(patch) });
export const deleteProject = id => req('/projects/' + id, { method: 'DELETE' });
export const sendFeedback = payload => req('/feedback', { method: 'POST', body: JSON.stringify(payload) });
