import { useEffect, useState } from 'react';
import { AdminUser, api, Unauthorized } from './api';

// Who else may open this page: only the owner sees and changes the list
export function AdminsPanel({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [owner, setOwner] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = (e: unknown) => {
    if (e instanceof Unauthorized) onUnauthorized();
    else setError((e as Error).message);
  };

  useEffect(() => {
    api
      .me()
      .then(async (me) => {
        setOwner(me.owner);
        if (me.owner) setUsers(await api.admins());
      })
      .catch(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!owner) return null;

  const run = async (work: () => Promise<AdminUser[]>) => {
    setBusy(true);
    setError(null);
    try {
      setUsers(await work());
    } catch (e) {
      handle(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Кто ещё может заходить в админку</h2>
      <p className="muted small">
        Добавьте Telegram-логин человека. Он пишет боту /admin в личные
        сообщения и получает ссылку для входа. При первом входе бот запоминает
        его аккаунт и пишет вам, кто именно вошёл, — дальше логин не важен. Он
        видит и делает всё то же, что вы, кроме того, что открывает доступ
        другим: этот список, кто может писать боту и подтверждать действия, кому
        идут уведомления, включение бота в группах и «Выйти везде». Удаление
        закрывает ему вход сразу.
      </p>
      {users.length > 0 ? (
        <ul className="issues">
          {users.map((u) => (
            <li key={u.username}>
              <b>@{u.username}</b>{' '}
              <span className="muted small">
                {u.userId
                  ? `вошёл(а), Telegram id ${u.userId}`
                  : 'ещё не писал(а) боту /admin'}
              </span>{' '}
              <button
                className="link small"
                disabled={busy}
                onClick={() => run(() => api.removeAdmin(u.username))}
              >
                убрать доступ
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Пока заходите только вы.</p>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(() => api.addAdmin(name.trim())).then(() => setName(''));
        }}
      >
        <input
          value={name}
          placeholder="@username"
          aria-label="Telegram-логин"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={busy || !name.trim()}>
          Добавить
        </button>
      </form>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
