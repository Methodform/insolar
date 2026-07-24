// Вход через Яндекс ID (мгновенная авторизация, клиентский token-флоу — без бэкенда).
// Требует зарегистрированного OAuth-приложения (client_id) и вспомогательной страницы yandex-token.html.
// Docs: https://yandex.ru/dev/id/doc/ru/suggest-connection

const SDK_URL = 'https://yastatic.net/s3/passport-sdk/autofill/v1/sdk-suggest-with-polyfills-latest.js';

let sdkPromise = null;
function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.YaAuthSuggest) return resolve();
    const s = document.createElement('script');
    s.src = SDK_URL; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Не удалось загрузить SDK Яндекс ID'));
    document.head.appendChild(s);
  });
  return sdkPromise;
}

// вспомогательная страница-приёмник токена (лежит в public/, деплоится в /app/)
function redirectUri() {
  // абсолютный URL страницы yandex-token.html рядом с приложением (/app/)
  return new URL('yandex-token.html', window.location.href).href;
}

// Открывает виджет Яндекс ID, возвращает { token, user:{id,name,email,login,avatarId} }
export async function loginWithYandex(clientId) {
  if (!clientId) throw new Error('YANDEX_CLIENT_ID не задан');
  await loadSdk();
  const origin = window.location.origin;
  const res = await window.YaAuthSuggest.init(
    { client_id: clientId, response_type: 'token', redirect_uri: redirectUri() },
    origin
  );
  const data = await res.handler();                       // { access_token, token_type, expires_in }
  const token = data.access_token || data.token;
  let user = { id: '', name: 'Пользователь Яндекс', email: '', login: '', avatarId: '' };
  try {
    const info = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + token } }).then(r => r.json());
    user = {
      id: info.id,
      name: info.display_name || info.real_name || info.first_name || info.login,
      email: info.default_email || (info.emails && info.emails[0]) || '',
      login: info.login,
      avatarId: info.default_avatar_id || '',
    };
  } catch (e) { /* если CORS/сеть — остаёмся с минимальным профилем, вход всё равно состоялся */ }
  return { token, user };
}
