import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, session } from './api';

const POLL_MS = 2000;

export function LoginCard({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<{ id: string; until: number } | null>(
    null,
  );
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // The parent's callback may change identity; the poll must not restart
  const done = useRef(onLoggedIn);
  done.current = onLoggedIn;

  // While the owner has not tapped the button in Telegram, ask every 2 s
  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const remaining = Math.max(
        0,
        Math.round((waiting.until - Date.now()) / 1000),
      );
      setLeft(remaining);
      try {
        const result = await api.passwordLoginStatus(waiting.id);
        if (result.session) {
          session.set(result.session);
          setWaiting(null);
          done.current();
          return;
        }
      } catch (err) {
        setWaiting(null);
        setError((err as Error).message);
        return;
      }
      if (Date.now() > waiting.until + 5000) {
        setWaiting(null);
        setError('Время на подтверждение вышло. Войдите ещё раз.');
        return;
      }
      timer.current = window.setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer.current);
    };
  }, [waiting]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { pending, seconds } = await api.passwordLogin(email, password);
      setPassword('');
      setWaiting({ id: pending, until: Date.now() + seconds * 1000 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (waiting) {
    return (
      <section className="card">
        <h2>Подтвердите вход в Telegram</h2>
        <p>
          Бот прислал вам «Это вы?». Нажмите «Да, это я» — страница откроется
          сама.
        </p>
        <p className="muted">Осталось {left} с.</p>
        <button className="ghost" onClick={() => setWaiting(null)}>
          Отмена
        </button>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Вход</h2>
      <form onSubmit={submit} className="login">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label htmlFor="password">Пароль</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Проверяю…' : 'Войти'}
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      </form>
      <p className="muted">
        После пароля бот попросит подтвердить вход в Telegram. Или напишите боту
        в личку <code>/admin</code>: он пришлёт одноразовую ссылку.
      </p>
    </section>
  );
}
