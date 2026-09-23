import { FormEvent, useState } from 'react';
import { api, session } from './api';

export function LoginCard({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { session: value } = await api.passwordLogin(email, password);
      session.set(value);
      setPassword('');
      onLoggedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
            {busy ? 'Вхожу…' : 'Войти'}
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      </form>
      <p className="muted">
        Или напишите боту в личку <code>/admin</code>: он пришлёт одноразовую
        ссылку на 10 минут.
      </p>
    </section>
  );
}
