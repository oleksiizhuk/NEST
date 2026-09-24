import { useEffect, useState } from 'react';
import { api, Chat, Unauthorized } from './api';

const MODE: Record<Chat['mode'], string> = {
  fixed: 'Включён в Vercel',
  on: 'Включён вручную',
  off: 'Выключен вручную',
  auto: 'Включён: вы в этой группе',
  none: 'Выключен: вас нет в группе',
};

// Groups the bot has seen. PM mode on = project data and the manager;
// off = the regular persona, which knows nothing about the project.
export function ChatsPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = (e: unknown) => {
    if (e instanceof Unauthorized) onUnauthorized();
    else setError((e as Error).message);
  };

  useEffect(() => {
    api.chats().then(setChats).catch(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = async (chat: Chat, on: boolean | 'auto') => {
    setBusy(chat.chatId);
    setError(null);
    try {
      setChats(await api.setChat(chat.chatId, on));
    } catch (e) {
      handle(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <h2>Чаты</h2>
      <p className="muted">
        Группы, где бот видел сообщения. Включённый режим менеджера открывает
        чату данные проекта; выключенный — отвечает обычная персона.
      </p>
      {error && <p className="error">{error}</p>}
      {!chats ? (
        <p className="muted">Загрузка…</p>
      ) : chats.length ? (
        <table>
          <thead>
            <tr>
              <th>Чат</th>
              <th>Последнее сообщение</th>
              <th>Режим менеджера</th>
            </tr>
          </thead>
          <tbody>
            {chats.map((c) => (
              <tr key={c.chatId}>
                <td>
                  {c.title || 'Без названия'}
                  <div className="muted small">id {c.chatId}</div>
                </td>
                <td className="muted">
                  {new Date(c.lastAt).toLocaleString('ru-RU')}
                </td>
                <td>
                  <div>{MODE[c.mode]}</div>
                  {c.mode !== 'fixed' && (
                    <div className="row-actions">
                      <button
                        className={c.on ? 'ghost' : ''}
                        disabled={busy === c.chatId}
                        onClick={() => set(c, !c.on)}
                      >
                        {busy === c.chatId
                          ? '…'
                          : c.on
                          ? 'Выключить'
                          : 'Включить'}
                      </button>
                      {(c.mode === 'on' || c.mode === 'off') && (
                        <button
                          className="link"
                          disabled={busy === c.chatId}
                          onClick={() => set(c, 'auto')}
                        >
                          Как по умолчанию
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Бот пока не видел сообщений в группах.</p>
      )}
    </section>
  );
}
