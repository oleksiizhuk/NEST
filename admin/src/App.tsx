import { useCallback, useEffect, useState } from 'react';
import { api, session, SettingsView, Unauthorized, Usage } from './api';
import { SettingsForm } from './SettingsForm';
import { UsagePanel } from './UsagePanel';
import { LoginCard } from './LoginCard';

type State = 'loading' | 'login' | 'ready';

// The login link from the bot carries a one-time token in the URL fragment;
// it is exchanged for a session and removed from the address bar at once
const takeLoginToken = (): string | null => {
  const match = window.location.hash.match(/login=([A-Za-z0-9_-]+)/);
  if (!match) return null;
  history.replaceState(null, '', window.location.pathname);
  return match[1];
};

export function App() {
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([api.settings(), api.usage()]);
      setSettings(s);
      setUsage(u);
      setState('ready');
    } catch (e) {
      if (e instanceof Unauthorized) {
        session.clear();
        setState('login');
      } else {
        setError((e as Error).message);
        setState('ready');
      }
    }
  }, []);

  useEffect(() => {
    const token = takeLoginToken();
    (async () => {
      if (token) {
        try {
          const { session: value } = await api.login(token);
          session.set(value);
        } catch {
          setError(
            'Ссылка устарела или уже использована. Запросите новую командой /admin.',
          );
          setState('login');
          return;
        }
      }
      if (!session.get()) {
        setState('login');
        return;
      }
      await load();
    })();
  }, [load]);

  const logout = () => {
    session.clear();
    setSettings(null);
    setUsage(null);
    setState('login');
  };

  return (
    <div className="page">
      <header className="top">
        <h1>PM-бот · админка</h1>
        {state === 'ready' && (
          <div className="top-actions">
            <button className="ghost" onClick={load}>
              Обновить
            </button>
            <button className="ghost" onClick={logout}>
              Выйти
            </button>
            <button
              className="ghost"
              title="Закрыть все сессии админки на всех устройствах"
              onClick={() => {
                api

                  .logoutAll()

                  .catch(() => undefined)

                  .finally(logout);
              }}
            >
              Выйти везде
            </button>
          </div>
        )}
      </header>

      {error && <p className="error">{error}</p>}

      {state === 'loading' && <p className="muted">Загрузка…</p>}

      {state === 'login' && (
        <LoginCard
          onLoggedIn={() => {
            setError(null);
            load();
          }}
        />
      )}

      {state === 'ready' && (
        <>
          {usage && <UsagePanel usage={usage} />}
          {settings && (
            <SettingsForm
              view={settings}
              onSaved={(view) => {
                setSettings(view);
                setError(null);
                api
                  .usage()
                  .then(setUsage)
                  .catch(() => undefined);
              }}
              onUnauthorized={logout}
            />
          )}
        </>
      )}
    </div>
  );
}
