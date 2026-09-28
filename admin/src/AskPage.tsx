import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  Topic,
  TopicList,
  TopicMessage,
  Unauthorized,
} from './api';
import { modelCallBody, TokenBadge, useConfirm } from './confirm';
import {
  claimWaiting,
  failureFor,
  isConfirmed,
  markConfirmed,
  publish,
  releaseWaiting,
  useTopicNews,
  useWaiting,
} from './topicStore';

const STARTERS = ['Почему так?', 'Это плохо или хорошо?', 'Что с этим делать?'];

const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

// Спросить бота: conversations by topic, each opened from a signal, a page
// or blank. Every question is one model call. The page and the window are
// two views kept in step through topicStore.
export function AskPage({
  topicId,
  onOpen,
  onUnauthorized,
  variant = 'page',
  active = true,
  focusKey = 0,
}: {
  topicId: string | null;
  onOpen: (id: string | null) => void;
  onUnauthorized: () => void;
  // 'dock' = the floating window: topics fold into a list above the chat
  variant?: 'page' | 'dock';
  // False while the view is hidden: an open confirmation is cancelled, so
  // it cannot hold the keyboard from behind the page
  active?: boolean;
  // Changes when the view wants the question box focused as soon as the
  // topic is on screen (the window opened, a signal opened a topic)
  focusKey?: number;
}) {
  const [modal, ask, cancelConfirm] = useConfirm();
  const [showTopics, setShowTopics] = useState(false);
  const [list, setList] = useState<TopicList | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [draft, setDraft] = useState('');
  // The question being answered (in either view) and its topic, shown until
  // the answer arrives; switching topics meanwhile leaves it running there
  const waiting = useWaiting();
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const newTopicRef = useRef<HTMLButtonElement>(null);
  const wantFocus = useRef(false);
  // The topic on screen now, for news that arrives after a switch
  const shown = useRef(topicId);
  shown.current = topicId;
  const pending = waiting?.id === topicId ? waiting.text : null;

  const handle = (e: unknown) => {
    if (e instanceof Unauthorized) onUnauthorized();
    else setError((e as Error).message);
  };

  const loadList = () => api.topics().then(setList).catch(handle);

  // A failed question comes back into the box, never over what the person
  // is typing now
  const restore = (question: string, message: string) => {
    setDraft((d) => (d.trim() ? d : question));
    setError(message);
  };

  const focusBox = () => {
    if (!wantFocus.current || !active || !boxRef.current) return;
    boxRef.current.focus();
    wantFocus.current = false;
  };

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useTopicNews((news) => {
    loadList();
    if (news.id !== shown.current) return;
    if (news.kind === 'removed') {
      onOpen(null);
      // The deleted thread took the focused button with it
      if (active) setTimeout(() => newTopicRef.current?.focus(), 0);
    } else if (news.kind === 'answered') {
      setTopic(news.topic);
      // Answered at last: an old failure and its copy of the question go
      setError(null);
      setDraft((d) => (d.trim() === news.question ? '' : d));
    } else if (news.kind === 'failed') restore(news.question, news.error);
  });

  useEffect(() => {
    if (!active) cancelConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    wantFocus.current = true;
    focusBox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  useEffect(() => {
    focusBox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic?.id, active]);

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
        // An answer that arrived while this was loading is newer: keep it
        setTopic((prev) =>
          prev?.id === t.id && prev.messages.length > t.messages.length
            ? prev
            : t,
        );
        const failed = failureFor(t.id);
        if (failed) restore(failed.question, failed.error);
        // Opened from elsewhere (a new topic): the list does not have it yet
        if (list && !list.topics.some((x) => x.id === t.id)) loadList();
      })
      .catch((e) => {
        // Late news of a topic already left: not this screen's business
        if (!live) return;
        // A remembered topic deleted meanwhile: start clean, not stuck on
        // it. Anything else (network, 5xx) keeps the topic for a retry.
        if (variant === 'dock' && e instanceof ApiError && e.status === 404)
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
    if (!isConfirmed(id)) {
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
      markConfirmed(id);
    }
    // The other view may have sent one while this asked for confirmation
    if (!claimWaiting({ id, text: question })) {
      setError('Бот ещё отвечает на другой вопрос — дождитесь ответа.');
      return;
    }
    setError(null);
    setDraft('');
    try {
      const answered = await api.askTopic(id, question);
      // Both views: whichever shows this topic gets the answer
      publish({ kind: 'answered', id, topic: answered, question });
    } catch (e) {
      // Kept with its topic: whichever view shows it now gets it back, and
      // so does the next one to open it (the one that sent may be gone)
      publish({
        kind: 'failed',
        id,
        question,
        error:
          e instanceof Unauthorized
            ? 'Сессия закончилась — войдите снова и отправьте вопрос ещё раз.'
            : (e as Error).message,
      });
      if (e instanceof Unauthorized) onUnauthorized();
    } finally {
      releaseWaiting();
    }
  };

  const create = async () => {
    try {
      const t = await api.createTopic('Новая тема', null);
      publish({ kind: 'created', id: t.id });
      onOpen(t.id);
    } catch (e) {
      handle(e);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.removeTopic(id);
      // Every view showing it leaves it, and both lists drop it
      publish({ kind: 'removed', id });
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
          <button ref={newTopicRef} className="link small" onClick={create}>
            Новая тема
          </button>
        </div>
      )}
      <aside
        className="ask-topics card"
        hidden={variant === 'dock' && !showTopics}
      >
        <button
          ref={variant === 'dock' ? undefined : newTopicRef}
          onClick={create}
        >
          Новая тема
        </button>
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
                  // The list folds away under the focused link: the
                  // question box takes over once the topic is on screen
                  wantFocus.current = true;
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
                ref={boxRef}
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
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
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
