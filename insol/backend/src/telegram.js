// Необязательное уведомление в Telegram о новом отзыве (если заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID).
export async function notifyTelegram({ type, message, contact, url, errors, screenshot }) {
  const tok = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!tok || !chat) return;
  let text = `🗣 SunPlan3d · ${type || 'отзыв'}\n${message || ''}`;
  if (contact) text += `\nКонтакт: ${contact}`;
  if (url) text += `\nURL: ${url}`;
  if (errors && errors.length) text += `\n\n⚠️ Ошибки:\n${errors.slice(-3).map(e => '• ' + (e.message || '')).join('\n')}`;
  text = text.slice(0, 1000);
  try {
    if (screenshot && String(screenshot).startsWith('data:')) {
      const b64 = String(screenshot).split(',')[1]; const buf = Buffer.from(b64, 'base64');
      const fd = new FormData();
      fd.append('chat_id', chat); fd.append('caption', text.slice(0, 1024));
      fd.append('photo', new Blob([buf], { type: 'image/jpeg' }), 'shot.jpg');
      await fetch(`https://api.telegram.org/bot${tok}/sendPhoto`, { method: 'POST', body: fd });
    } else {
      await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text }),
      });
    }
  } catch (e) { /* уведомление не критично */ }
}
