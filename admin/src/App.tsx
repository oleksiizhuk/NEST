import { ReactNode, useCallback, useEffect, useState } from 'react';
import { api, session, SettingsView, Unauthorized, Usage } from './api';
import { SettingsForm } from './SettingsForm';
import { UsagePanel } from './UsagePanel';
import { LoginCard } from './LoginCard';
import { ChatsPanel } from './ChatsPanel';
import { TeamPage } from './TeamPage';
import { DataPage } from './DataPage';
import {
  IconChats,
  IconClose,
  IconLogout,
  IconMenu,
  IconOverview,
  IconData,
  IconTeam,
  IconSettings,
} from './icons';

type State = 'loading' | 'login' | 'ready';
type PageId = 'overview' | 'team' | 'data' | 'chats' | 'settings';

const PAGES: Array<{
  id: PageId;
  title: string;
  icon: ReactNode;
  lead: string;
}> = [
  {
    id: 'overview',
    title: 'Обзор',
    icon: <IconOverview />,
    lead: 'Вопросы за сегодня, оценки ответов и расход.',
  },
  {
    id: 'team',
    title: 'Сотрудники',
    icon: <IconTeam />,
    lead: 'Кто над чем работает, идёт ли в нужную сторону и что сказать на митинге.',
  },
  {
    id: 'data',
    title: 'Данные',
    icon: <IconData />,
    lead: 'Полный сбор задач, документации, дизайна и PR — без затрат на модель.',
  },
  {
    id: 'chats',
    title: 'Чаты',
    icon: <IconChats />,
    lead: 'Где бот работает менеджером, куда идут сводка и уведомления.',
  },
  {
    id: 'settings',
    title: 'Доступы и лимиты',
    icon: <IconSettings />,
    lead: 'Кто может писать, подтверждать и сколько спрашивать.',
  },
];

// The login link from the bot carries a one-time token in the URL fragment;
// it is exchanged for a session and removed from the address bar at once
const takeLoginToken = (): string | null => {
  const match = window.location.hash.match(/login=([A-Za-z0-9_-]+)/);
  if (!match) return null;
  history.replaceState(null, '', window.location.pathname);
  return match[1];
};

// Pages live in the fragment (#/chats), so reload and back keep your place
const pageFromHash = (): PageId => {
  const id = window.location.hash.match(/^#\/([a-z]+)/)?.[1];
  return PAGES.find((p) => p.id === id)?.id ?? 'overview';
};

export function App() {
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([api.settings(), api.usage()]);
      setSettings(s);
      setUsage(u);
      setError(null);
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

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // No page scroll behind the open mobile menu
  useEffect(() => {
    document.body.classList.toggle('no-scroll', menuOpen);
  }, [menuOpen]);

  const go = (id: PageId) => {
    window.location.hash = `#/${id}`;
    setPage(id);
    setMenuOpen(false);
    window.scrollTo(0, 0);
    // Fresh numbers on every section switch (pages with their own data load
    // them when they open)
    load();
  };

  const logout = () => {
    session.clear();
    setSettings(null);
    setUsage(null);
    setMenuOpen(false);
    setState('login');
  };

  if (state !== 'ready') {
    return (
      <div className="login-page">
        <div className="login-brand">
          <span className="logo">PM</span>
          <span>PM-бот · админка</span>
        </div>
        {error && <p className="error">{error}</p>}
        {state === 'loading' ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <LoginCard
            onLoggedIn={() => {
              setError(null);
              load();
            }}
          />
        )}
      </div>
    );
  }

  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];

  return (
    <div className="shell">
      <aside
        className={`sidebar${menuOpen ? ' open' : ''}`}
        aria-label="Разделы"
      >
        <div className="sidebar-head">
          <span className="logo">PM</span>
          <span className="brand">PM-бот</span>
          <button
            className="icon-btn only-mobile"
            aria-label="Закрыть меню"
            onClick={() => setMenuOpen(false)}
          >
            <IconClose />
          </button>
        </div>
        <nav className="nav">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={`#/${p.id}`}
              className={`nav-item${p.id === page ? ' active' : ''}`}
              aria-current={p.id === page ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(p.id);
              }}
            >
              {p.icon}
              <span>{p.title}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item" onClick={logout}>
            <IconLogout />
            <span>Выйти</span>
          </button>
          <button
            className="nav-item subtle"
            title="Закрыть все сессии админки на всех устройствах"
            onClick={() => {
              api
                .logoutAll()
                .catch(() => undefined)
                .finally(logout);
            }}
          >
            <span className="nav-spacer" />
            <span>Выйти везде</span>
          </button>
        </div>
      </aside>
      {menuOpen && (
        <div className="backdrop" onClick={() => setMenuOpen(false)} />
      )}

      <div className="main">
        <header className="topbar">
          <button
            className="icon-btn"
            aria-label="Открыть меню"
            onClick={() => setMenuOpen(true)}
          >
            <IconMenu />
          </button>
          <span className="topbar-title">{current.title}</span>
        </header>

        <main className="content">
          <div className="page-head">
            <div>
              <h1>{current.title}</h1>
              <p className="muted">{current.lead}</p>
            </div>
          </div>

          {error && <p className="error">{error}</p>}

          {page === 'overview' && usage && <UsagePanel usage={usage} />}
          {page === 'team' && <TeamPage onUnauthorized={logout} />}
          {page === 'data' && <DataPage onUnauthorized={logout} />}
          {page === 'chats' && <ChatsPanel onUnauthorized={logout} />}
          {page === 'settings' && settings && (
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
        </main>
      </div>
    </div>
  );
}
