import { useEffect, useRef, useState } from 'react';
import { api, Topic, TopicList, TopicMessage, Unauthorized } from './api';
import { TokenBadge } from './confirm';

const STARTERS = [
  'Почему так?',
  'Это плохо или хорошо?',
  'Что с этим делать?',
];

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
}: {
  topicId: string | null;
  onOpen: (id: string | null) => void;
  onUnauthorized: () => void;
}) {
  const [list, setList] = useState<TopicList | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [draft, setDraft] = useState('');
  // The question being answered and its topic, shown until the answer
  // arrives; switching topics meanwhile leaves it running there
  const [waiting, setWaiting] = useState<{ id: string; text: string } | null>(
    null,
  );
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

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setTopic(null);
    setError(null);
    setDraft('');
    if (!topicId) return;
    let live = true;
    api
      .topic(topicId)
      .then((t) => live && setTopic(t))
      .catch(handle);
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
    setWaiting({ id, text: question });
    setError(null);
    setDraft('');
    try {
      const answered = await api.askTopic(id, question);
      if (shown.current === id) setTopic(answered);
      loadList();
    } catch (e) {
      // Keep the question so it can be sent again, in its own topic only
      if (shown.current === id) {
        setDraft(question);
        handle(e);
      } else if (e instanceof Unauthorized) onUnauthorized();
    } finally {
      setWaiting(null);
    }
  };

  const create = async () => {
    try {
      const t = await api.createTopic('Новая тема', null);
      await loadList();
      onOpen(t.id);
    } catch (e) {
      handle(e);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.removeTopic(id);
      if (id === topicId) onOpen(null);
      loadList();
    } catch (e) {
      handle(e);
    }
  };

  const left = list ? Math.max(0, list.limit - list.used) : null;
  const last = topic?.messages[topic.messages.length - 1];

  return (
    <div className="ask">
      <aside className="ask-topics card">
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
              хорошо это или плохо и что делать. У каждой темы своя история,
              так бот помнит, о чём шла речь.
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
