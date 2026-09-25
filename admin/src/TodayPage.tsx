import { useEffect, useState } from 'react';
import { api, TodayItem, TodayView, Unauthorized } from './api';
import { Key, RULES } from './signals';

const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

function Item({
  item,
  view,
  onHide,
}: {
  item: TodayItem;
  view: TodayView;
  onHide: (days: 1 | 7) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const help = RULES[item.rule];

  const hide = async (days: 1 | 7) => {
    setBusy(true);
    try {
      await onHide(days);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.say ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no clipboard access: the text is on screen to copy by hand
    }
  };

  return (
    <article className={`card today-item ${item.level}`}>
      <div className="today-head">
        <span className="today-rule">{help?.title ?? item.rule}</span>
        <span className="today-person">{item.person}</span>
        {item.inRelease && <span className="tag warn">релиз</span>}
      </div>
      <p className="today-text">{item.text}</p>
      {item.why && <p className="muted small">Данные: {item.why}</p>}
      {item.keys.length > 0 && (
        <p className="small">
          {item.keys.map((k, i) => (
            <span key={k}>
              {i > 0 && ', '}
              <Key k={k} links={view.links} />
            </span>
          ))}
        </p>
      )}
      {help?.hint && <p className="small today-hint">{help.hint}</p>}
      {item.say && (
        <blockquote className="today-say">
          «{item.say}»
          <button className="link small" onClick={copy}>
            {copied ? 'скопировано' : 'копировать'}
          </button>
        </blockquote>
      )}
      <div className="actions">
        <button onClick={() => hide(7)} disabled={busy}>
          Готово
        </button>
        <button className="ghost" onClick={() => hide(1)} disabled={busy}>
          Отложить до завтра
        </button>
      </div>
    </article>
  );
}

export function TodayPage({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [view, setView] = useState<TodayView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = (e: unknown) => {
    if (e instanceof Unauthorized) onUnauthorized();
    else setError((e as Error).message);
  };

  useEffect(() => {
    api.today().then(setView).catch(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!view)
    return error ? (
      <p className="error">{error}</p>
    ) : (
      <p className="muted">Загрузка…</p>
    );

  if (!view.asOf)
    return (
      <section className="card">
        <h2>Данных пока нет</h2>
        <p className="muted">
          Снимок проекта ещё не собран. Откройте «Сотрудники» и обновите данные.
        </p>
      </section>
    );

  return (
    <>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        По данным на {when(view.asOf)}
        {view.releaseVersion ? ` · релиз ${view.releaseVersion}` : ''}. «Готово»
        прячет пункт на неделю, «Отложить» — до завтра; если проблема останется
        в данных, пункт вернётся.
      </p>
      {view.items.length ? (
        <div className="today">
          {view.items.map((item) => (
            <Item
              key={item.id}
              item={item}
              view={view}
              onHide={async (days) => {
                try {
                  setView(await api.hideToday(item.id, days));
                } catch (e) {
                  handle(e);
                }
              }}
            />
          ))}
        </div>
      ) : (
        <section className="card">
          <h2>На сегодня всё</h2>
          <p className="muted">
            Срочных сигналов по команде нет. Подробности по каждому — в
            «Сотрудниках».
          </p>
        </section>
      )}
      {view.more > 0 && (
        <p className="muted small">
          Ещё сигналов: {view.more}. Они появятся здесь, когда разберёте эти,
          или смотрите карточки в «Сотрудниках».
        </p>
      )}
    </>
  );
}
