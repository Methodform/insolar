import React, { useState } from 'react';
import { Dialog, Button, TextArea, TextField, Flex, Text, Box } from '@radix-ui/themes';
import { sendFeedback, hasApi } from '../api.js';
import { recentErrors, lastError } from '../errlog.js';

// Виджет обратной связи. Сам подхватывает последнюю ошибку (перехват в errlog.js) и прикладывает её.
export default function FeedbackWidget({ plan, mobile }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('idea');
  const [msg, setMsg] = useState('');
  const [contact, setContact] = useState('');
  const [shot, setShot] = useState(true);
  const [state, setState] = useState('');   // '' | sending | done | err
  const [errs, setErrs] = useState([]);

  const onOpen = o => {
    setOpen(o);
    if (o) { const e = recentErrors(); setErrs(e); if (e.length) setType('problem'); setState(''); }
  };

  const submit = async () => {
    if (!msg.trim()) return;
    setState('sending');
    let screenshot = null;
    try { if (shot && window.__spShot) screenshot = await window.__spShot(); } catch (e) {}
    const payload = { type, message: msg.trim(), contact: contact.trim() || undefined, url: location.href, errors: errs, screenshot, meta: { ua: navigator.userAgent, plan, viewport: `${innerWidth}×${innerHeight}` } };
    try {
      if (hasApi()) await sendFeedback(payload);
      else window.location.href = `mailto:mabdrashitov@ilotcos.com?subject=${encodeURIComponent('SunPlan3d · ' + type)}&body=${encodeURIComponent(msg + (contact ? '\n\nКонтакт: ' + contact : '') + (errs.length ? '\n\nОшибка: ' + (errs[errs.length - 1].message || '') : ''))}`;
      setState('done'); setMsg(''); setContact('');
      setTimeout(() => { onOpen(false); }, 1200);
    } catch (e) { setState('err'); }
  };

  const tb = (k, label) => <Button size="1" variant={type === k ? 'solid' : 'soft'} color={type === k ? 'grass' : 'gray'} onClick={() => setType(k)}>{label}</Button>;
  const le = lastError();

  return (
    <Dialog.Root open={open} onOpenChange={onOpen}>
      <Dialog.Trigger><Button variant="soft" color="gray" title="Обратная связь">💬{!mobile && ' Отзыв'}</Button></Dialog.Trigger>
      <Dialog.Content maxWidth="440px">
        <Dialog.Title>Обратная связь</Dialog.Title>
        <Dialog.Description size="1" color="gray" mb="3">Идея, проблема или вопрос — коротко. Это помогает делать сервис лучше.</Dialog.Description>
        <Flex gap="2" mb="2">{tb('idea', '💡 Идея')}{tb('problem', '⚠️ Проблема')}{tb('question', '❓ Вопрос')}</Flex>
        {errs.length > 0 && (
          <Box mb="2" style={{ background: 'var(--red-a2)', border: '1px solid var(--red-a5)', borderRadius: 8, padding: '8px 10px' }}>
            <Text size="1" color="red" style={{ display: 'block', fontWeight: 600 }}>Виджет заметил ошибку — приложу её автоматически:</Text>
            <Text size="1" color="gray" style={{ display: 'block', wordBreak: 'break-word' }}>{(le && le.message || '').slice(0, 160)}</Text>
          </Box>
        )}
        <TextArea value={msg} onChange={e => setMsg(e.target.value)} placeholder={type === 'problem' ? 'Что произошло и что вы делали?' : 'Опишите…'} rows={4} />
        <TextField.Root mt="2" value={contact} onChange={e => setContact(e.target.value)} placeholder="Email или Telegram (необязательно)" />
        {typeof window !== 'undefined' && window.__spShot && (
          <Text as="label" size="1" color="gray" mt="2" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={shot} onChange={e => setShot(e.target.checked)} /> приложить скриншот экрана
          </Text>
        )}
        <Flex justify="end" gap="2" mt="3" align="center">
          {state === 'done' && <Text size="2" color="grass">Спасибо! 🙏</Text>}
          {state === 'err' && <Text size="2" color="red">Не отправилось — попробуйте ещё</Text>}
          <Dialog.Close><Button variant="soft" color="gray">Закрыть</Button></Dialog.Close>
          <Button onClick={submit} disabled={!msg.trim() || state === 'sending'}>{state === 'sending' ? 'Отправка…' : 'Отправить'}</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
