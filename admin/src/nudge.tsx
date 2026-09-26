import { useEffect, useState } from 'react';
import { api, Chat } from './api';

// "Написать в чат": the suggested sentence, editable, to a PM group the
// bot works in; the person is @-mentioned when their Telegram is linked
export function NudgeForm({
  person,
  text,
  onDone,
}: {
  person: string;
  text: string;
  onDone: () => void;
}) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [message, setMessage] = useState(text);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .chats()
      .then((all) => {
        const on = all.filter((c) => c.on);
        setChats(on);
        setChatId(on[0]?.chatId ?? null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (state === 'sent')
    return (
      <p className="small ok-text">
        Отправлено.{' '}
        <button className="link small" onClick={onDone}>
          Закрыть
        </button>
      </p>
    );
  return (
    <form
      className="nudge"
      onSubmit={async (e) => {
        e.preventDefault();
        if (chatId === null) return;
        setState('sending');
        setError(null);
        try {
          await api.nudge(person, message, chatId);
          setState('sent');
        } catch (err) {
          setError((err as Error).message);
          setState('idle');
        }
      }}
    >
      {chats && !chats.length ? (
        <p className="muted small">
          Нет групп, где бот работает менеджером — включите его на странице
          «Чаты».
        </p>
      ) : (
        <select
          value={chatId ?? ''}
          onChange={(e) => setChatId(Number(e.target.value))}
          aria-label="Куда отправить"
        >
          {(chats ?? []).map((c) => (
            <option key={c.chatId} value={c.chatId}>
              {c.title ?? c.chatId}
            </option>
          ))}
        </select>
      )}
      <textarea
        value={message}
        maxLength={800}
        rows={3}
        onChange={(e) => setMessage(e.target.value)}
      />
      {error && <p className="error small">{error}</p>}
      <div className="actions">
        <button
          type="submit"
          disabled={state === 'sending' || chatId === null || !message.trim()}
        >
          {state === 'sending' ? 'Отправляю…' : `Отправить: ${person}`}
        </button>
        <button type="button" className="ghost" onClick={onDone}>
          Отмена
        </button>
      </div>
      <p className="muted small">
        Сообщение уйдёт от бота в выбранную группу с упоминанием человека, если
        его Telegram привязан на странице «Сотрудники».
      </p>
    </form>
  );
}
