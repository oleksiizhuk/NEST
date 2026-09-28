import { useEffect, useRef, useState } from 'react';
import { api, Topic, TopicList, TopicMessage, Unauthorized } from './api';
import { modelCallBody, TokenBadge, useConfirm } from './confirm';

const STARTERS = ['Почему так?', 'Это плохо или хорошо?', 'Что с этим делать?'];

// Topics whose first paid question was confirmed in this visit, shared by
// the page and the window so one topic never asks twice
const confirmedTopics = { current: new Set<string>() };

// The page and the window are two separate views of the same topics. The
// question being answered and news of changed topics are shared, so one
// view never offers a second question the server would refuse, and an
// answer, a new topic or a deletion shows up in both.
interface TopicNews {
  id: string;
  topic?: Topic;
  removed?: boolean;
  // A question that failed: the view showing its topic puts it back
  failed?: { question: string; error: string };
}
const shared = {
  waiting: null as { id: string; text: string } | null,
  listeners: new Set<(news?: TopicNews) => void>(),
};
const publish = (news?: TopicNews) =>
  shared.listeners.forEach((listener) => listener(news));
const setSharedWaiting = (waiting: typeof shared.waiting) => {
  shared.waiting = waiting;
  publish();
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

// Спросить бота: conversations by topic, each opened from a signal, a page
// or blank. Every question is one model call.
export function AskPage({
  topicId,
  onOpen,
  onUnauthorized,
  variant = 'page',
  active = true,
}: {
  topicId: string | null;
  onOpen: (id: string | null) => void;
  onUnauthorized: () => void;
  // 'dock' = the floating window: topics fold into a list above the chat
  variant?: 'page' | 'dock';
  // False while the view is hidden: an open confirmation is cancelled, so
  // it cannot hold the keyboard from behind the page
  active?: boolean;
}) {
  const [modal, ask, cancelConfirm] = useConfirm();
  const confirmed = confirmedTopics;
  const [showTopics, setShowTopics] = useState(false);
  const [list, setList] = useState<TopicList | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [draft, setDraft] = useState('');
  // The question being answered and its topic (shared with the other
  // view), shown until the answer arrives; switching topics meanwhile
  // leaves it running there
  const [, rerender] = useState(0);
  const waiting = shared.waiting;
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // The topic on screen now, for answers that arrive after a switch
  const shown = useRef(topicId);
  shown.current = topicId;
  const pending = waiting?.id === topicId ? waiting.text : null;

  const handle = (e: unknown) => {
    if (e instanceof Unauthorized) onUnauthorized();
    else setError((e as Error).message);
  };

  const loadList = () => api.topics().then(setList).catch(handle);
  // The latest callbacks for the shared listener, subscribed once
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const loadListRef = useRef(loadList);
  loadListRef.current = loadList;

  useEffect(() => {
    loadList();
    const listener = (news?: TopicNews) => {
      rerender((n) => n + 1);
      if (!news) return;
      loadListRef.current();
      if (news.id !== shown.current) return;
      if (news.removed) onOpenRef.current(null);
      else if (news.topic) setTopic(news.topic);
      else if (news.failed) {
        setDraft(news.failed.question);
        setError(news.failed.error);
      }
    };
    shared.listeners.add(listener);
    return () => {
      shared.listeners.delete(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!active) cancelConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    setTopic(null);
    setError(null);
    setDraft('');
    if (!topicId) return;
    let live = true;
    api
      .topic(topicId)
      .then((t) => {
        if (!live) return;
        setTopic(t);
        // Opened from elsewhere (a new topic): the list does not have it yet
        if (list && !list.topics.some((x) => x.id === t.id)) loadList();
      })
      .catch((e) => {
        // A remembered topic deleted meanwhile: start clean, not stuck on
        // it. Anything else (network, 5xx) keeps the topic for a retry.
        if (variant === 'dock' && (e as { status?: number }).status === 404)
          onOpen(null);
        else handle(e);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [topic?.messages.length, pending]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!topic || !question || waiting) return;
    const id = topic.id;
    // The first question of a topic asks once; the rest of the topic is
    // one conversation the person already agreed to
    if (!confirmed.current.has(id)) {
      const ok = await ask({
        title: 'Задать вопрос боту?',
        body: modelCallBody(
          'Бот ответит по данным проекта и тому, что было на экране. Дальше в этой теме подтверждать не нужно.',
          `Из админки — не больше ${
            list?.limit ?? 60
          } вопросов в сутки на всех.`,
        ),
        confirm: 'Спросить',
      });
      if (!ok) return;
      confirmed.current.add(id);
    }
    // Re-checked after the confirmation: the other view may have sent one
    if (shared.waiting) return;
    setSharedWaiting({ id, text: question });
    setError(null);
    setDraft('');
    try {
      const answered = await api.askTopic(id, question);
      // Both views: whichever shows this topic gets the answer
      publish({ id, topic: answered });
    } catch (e) {
      // Keep the question so it can be sent again, in its own topic and in
      // whichever view shows it now (the one that sent may be gone)
      if (e instanceof Unauthorized) onUnauthorized();
      else publish({ id, failed: { question, error: (e as Error).message } });
    } finally {
      setSharedWaiting(null);
    }
  };

  const create = async () => {
    try {
      const t = await api.createTopic('Новая тема', null);
      publish({ id: t.id });
      onOpen(t.id);
    } catch (e) {
      handle(e);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.removeTopic(id);
      // Every view showing it leaves it, and both lists drop it
      publish({ id, removed: true });
    } catch (e) {
      handle(e);
    }
  };

  const left = list ? Math.max(0, list.limit - list.used) : null;
  const last = topic?.messages[topic.messages.length - 1];

  return (
    <div className={variant === 'dock' ? 'ask ask-dock-body' : 'ask'}>
      {modal}
      {variant === 'dock' && (
        <div className="ask-dock-bar">
          <button
            className="link small"
            onClick={() => setShowTopics((v) => !v)}
            aria-expanded={showTopics}
          >
            {showTopics ? 'Скрыть темы' : 'Все темы'}
          </button>
          <button className="link small" onClick={create}>
            Новая тема
          </button>
        </div>
      )}
      <aside
        className="ask-topics card"
        hidden={variant === 'dock' && !showTopics}
      >
        <button onClick={create}>Новая тема</button>
        {list && list.topics.length === 0 && (
          <p className="muted small">
            Тем пока нет. Нажмите «спросить бота» у сигнала или вверху любого
            раздела — тема откроется с тем, что было на экране.
          </p>
        )}
        <ul>
          {list?.topics.map((t) => (
            <li key={t.id} className={t.id === topicId ? 'active' : ''}>
              <a
                href={`#/ask/${t.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(t.id);
                  setShowTopics(false);
                }}
              >
                <span className="ask-topic-title">{t.title}</span>
                <span className="muted small">
                  {when(t.updatedAt)} · {Math.floor(t.count / 2)} вопр.
                </span>
              </a>
            </li>
          ))}
        </ul>
        {left !== null && (
          <p className="muted small">
            Сегодня из админки можно задать ещё {left} из {list?.limit}{' '}
            вопросов.
          </p>
        )}
      </aside>

      <section className="ask-thread card">
        {!topicId && (
          <div className="ask-empty">
            <h2>Спросите бота о том, что видите</h2>
            <p className="muted">
              Бот отвечает по тем же данным, что и в Telegram: задачи, PR,
              документация, дизайн. Удобно спросить, почему появился сигнал,
              хорошо это или плохо и что делать. У каждой темы своя история, так
              бот помнит, о чём шла речь.
            </p>
            <p className="muted small">
              Здесь бот только отвечает: создать бренд, изменить магазин или
              что-то запомнить можно в Telegram-чате с ботом.
            </p>
          </div>
        )}
        {topicId && !topic && !error && <p className="muted">Загрузка…</p>}
        {topic && (
          <>
            <div className="ask-head">
              <h2>{topic.title}</h2>
              <button
                className="link small"
                onClick={() => remove(topic.id)}
                disabled={Boolean(pending)}
              >
                удалить тему
              </button>
            </div>
            {topic.context && (
              <details className="ask-context">
                <summary className="small">
                  Что бот знает об этой теме с экрана
                </summary>
                <pre>{topic.context}</pre>
              </details>
            )}
            <div className="ask-messages" aria-live="polite">
              {topic.messages.map((m, i) => (
                <Message
                  key={i}
                  m={m}
                  onChoose={
                    m === last && !waiting
                      ? (label) => send(`Выбираю вариант: ${label}`)
                      : undefined
                  }
                />
              ))}
              {pending && (
                <>
                  <div className="ask-msg user">{pending}</div>
                  <div className="ask-msg bot muted">
                    Бот думает — обычно до минуты, иногда до двух…
                  </div>
                </>
              )}
              {topic.messages.length === 0 && !pending && (
                <div className="ask-starters">
                  {topic.context && (
                    <>
                      {STARTERS.map((s) => (
                        <button
                          key={s}
                          className="ghost"
                          disabled={left === 0 || Boolean(waiting)}
                          onClick={() => send(s)}
                        >
                          {s}
                        </button>
                      ))}
                      <TokenBadge />
                    </>
                  )}
                </div>
              )}
              <div ref={endRef} />
            </div>
            <form
              className="ask-form"
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
            >
              <textarea
                value={draft}
                rows={3}
                maxLength={4000}
                placeholder="Ваш вопрос. Ctrl+Enter — отправить"
                aria-label="Вопрос боту"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
              />
              <div className="actions">
                <button
                  type="submit"
                  disabled={Boolean(waiting) || !draft.trim() || left === 0}
                >
                  Отправить
                </button>
                <TokenBadge />
                {waiting && !pending && (
                  <span className="muted small">
                    Бот ещё отвечает в другой теме.
                  </span>
                )}
              </div>
            </form>
          </>
        )}
        {error && <p className="error small">{error}</p>}
      </section>
    </div>
  );
}

function Message({
  m,
  onChoose,
}: {
  m: TopicMessage;
  onChoose?: (label: string) => void;
}) {
  return (
    <div className={`ask-msg ${m.role}`}>
      {m.text}
      {m.role === 'bot' && m.choices && onChoose && (
        <div className="ask-choices">
          {m.choices.map((c) => (
            <button key={c} className="ghost" onClick={() => onChoose(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
