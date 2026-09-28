import {
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { api, session, SettingsView, Unauthorized, Usage } from './api';
import { SettingsForm } from './SettingsForm';
import { UsagePanel } from './UsagePanel';
import { LoginCard } from './LoginCard';
import { ChatsPanel } from './ChatsPanel';
import { TeamPage } from './TeamPage';
import { TodayPage } from './TodayPage';
import { FlowPage } from './FlowPage';
import { ReleasePage } from './ReleasePage';
import { QualityPage } from './QualityPage';
import { HangingPage } from './HangingPage';
import { AdminsPanel } from './AdminsPanel';
import { showGuide } from './guide';
import { DataPage } from './DataPage';
import { AskPage } from './AskPage';
import { AskButton, AskContext, pageContext } from './ask';
import { ChatDock, DockState, loadDock, saveDock } from './dock';
import { publish } from './topicStore';
import {
  IconAsk,
  IconChats,
  IconClose,
  IconLogout,
  IconMenu,
  IconOverview,
  IconData,
  IconTeam,
  IconSettings,
  IconToday,
  IconFlow,
  IconRelease,
  IconQuality,
  IconHanging,
} from './icons';

type State = 'loading' | 'login' | 'ready';
type PageId =
  | 'today'
  | 'release'
  | 'flow'
  | 'quality'
  | 'hanging'
  | 'overview'
  | 'ask'
  | 'team'
  | 'data'
  | 'chats'
  | 'settings';

type Group = 'Команда' | 'Релиз и процесс' | 'Бот';

const PAGES: Array<{
  id: PageId;
  title: string;
  icon: ReactNode;
  lead: string;
  group: Group;
}> = [
  {
    id: 'today',
    title: 'Сегодня',
    icon: <IconToday />,
    lead: 'Главные 3–5 дел по команде на сегодня: кто, что случилось и что сказать.',
    group: 'Команда',
  },
  {
    id: 'team',
    title: 'Сотрудники',
    icon: <IconTeam />,
    lead: 'Кто над чем работает, всё ли в порядке и что обсудить на встрече.',
    group: 'Команда',
  },
  {
    id: 'hanging',
    title: 'Зависшие',
    icon: <IconHanging />,
    lead: 'Задачи, которые давно висят. Удобно для уборки раз в неделю–месяц.',
    group: 'Команда',
  },
  {
    id: 'release',
    title: 'Релиз',
    icon: <IconRelease />,
    lead: 'Успеваем ли к дате выпуска и что можно отложить.',
    group: 'Релиз и процесс',
  },
  {
    id: 'flow',
    title: 'Поток',
    icon: <IconFlow />,
    lead: 'Где задачи ждут дольше всего на пути от разработки до готово.',
    group: 'Релиз и процесс',
  },
  {
    id: 'quality',
    title: 'Качество',
    icon: <IconQuality />,
    lead: 'Где появляются баги и какие части продукта знает только один человек.',
    group: 'Релиз и процесс',
  },
  {
    id: 'ask',
    title: 'Спросить бота',
    icon: <IconAsk />,
    lead: 'Разговор с ботом по темам: почему так, хорошо это или плохо, что делать.',
    group: 'Бот',
  },
  {
    id: 'overview',
    title: 'Вопросы боту',
    icon: <IconOverview />,
    lead: 'Кто и сколько спрашивает бота, как оценивают ответы.',
    group: 'Бот',
  },
  {
    id: 'chats',
    title: 'Чаты',
    icon: <IconChats />,
    lead: 'В каких группах бот работает менеджером, куда идут сводка и уведомления.',
    group: 'Бот',
  },
  {
    id: 'data',
    title: 'Данные',
    icon: <IconData />,
    lead: 'Сбор задач, документации, дизайна и кода, из которых бот берёт ответы.',
    group: 'Бот',
  },
  {
    id: 'settings',
    title: 'Доступы и лимиты',
    icon: <IconSettings />,
    lead: 'Кто может писать боту, заходить сюда и сколько вопросов в день.',
    group: 'Бот',
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
  return PAGES.find((p) => p.id === id)?.id ?? 'today';
};

// #/ask/<topic id>
const topicFromHash = (): string | null =>
  window.location.hash.match(/^#\/ask\/([a-f0-9]{24})/)?.[1] ?? null;

// Pages whose numbers a "спросить бота" button in the header sends along
const ASKABLE: PageId[] = [
  'today',
  'team',
  'hanging',
  'release',
  'flow',
  'quality',
  'overview',
];

export function App() {
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const [guideTick, setGuideTick] = useState(0);
  const [topicId, setTopicId] = useState<string | null>(topicFromHash);

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
    const onHash = () => {
      setPage(pageFromHash());
      setTopicId(topicFromHash());
    };
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

  const [dock, setDock] = useState<DockState>(loadDock);
  const changeDock = (update: (prev: DockState) => DockState) =>
    setDock((prev) => update(prev));
  useEffect(() => saveDock(dock), [dock]);
  // The page right now, for code that resumes after a network wait
  const pageRef = useRef(page);
  pageRef.current = page;

  const openTopic = (id: string | null) => {
    window.location.hash = id ? `#/ask/${id}` : '#/ask';
    setPage('ask');
    setTopicId(id);
    setMenuOpen(false);
  };

  // A new topic about what is on the screen, opened in the window over the
  // page (the page stays where it is); the question is the person's
  const startTopic = async (title: string, context: string) => {
    try {
      const topic = await api.createTopic(title, context);
      // Both views' lists learn of it, whichever one opens it
      publish({ kind: 'created', id: topic.id });
      if (pageRef.current === 'ask') openTopic(topic.id);
      else
        changeDock((prev) => ({
          mode: prev.mode === 'max' ? 'max' : 'open',
          topicId: topic.id,
        }));
    } catch (e) {
      if (e instanceof Unauthorized) logout();
      else setError((e as Error).message);
    }
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
    <AskContext.Provider value={startTopic}>
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
            {PAGES.map((p, i) => (
              <Fragment key={p.id}>
                {(i === 0 || PAGES[i - 1].group !== p.group) && (
                  <div className="nav-group">{p.group}</div>
                )}
                <a
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
              </Fragment>
            ))}
          </nav>
          <div className="sidebar-foot">
            <button
              className="nav-item subtle"
              onClick={() => {
                showGuide();
                setGuideTick((t) => t + 1);
                go('today');
              }}
            >
              <span className="nav-spacer" />
              <span>Как пользоваться</span>
            </button>
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
              {ASKABLE.includes(page) && (
                <AskButton
                  title={`Раздел «${current.title}»`}
                  context={() => pageContext(current.title)}
                  label="Спросить бота об этом"
                  className="ghost"
                />
              )}
            </div>

            {error && <p className="error">{error}</p>}

            {page === 'today' && (
              <TodayPage key={guideTick} onUnauthorized={logout} />
            )}
            {page === 'overview' && usage && <UsagePanel usage={usage} />}
            {page === 'team' && <TeamPage onUnauthorized={logout} />}
            {page === 'release' && <ReleasePage onUnauthorized={logout} />}
            {page === 'flow' && <FlowPage onUnauthorized={logout} />}
            {page === 'hanging' && <HangingPage onUnauthorized={logout} />}
            {page === 'quality' && <QualityPage onUnauthorized={logout} />}
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
            {page === 'settings' && <AdminsPanel onUnauthorized={logout} />}
            {page === 'ask' && (
              <AskPage
                topicId={topicId}
                onOpen={openTopic}
                onUnauthorized={logout}
              />
            )}
          </main>
        </div>
        <ChatDock
          state={dock}
          onChange={changeDock}
          onUnauthorized={logout}
          suppressed={page === 'ask' || menuOpen}
        />
      </div>
    </AskContext.Provider>
  );
}
