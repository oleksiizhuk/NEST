import { useEffect, useState } from 'react';
import { api, TodayItem, TodayView, Unauthorized } from './api';
import { Key, RULES } from './signals';
import { NoData } from './empty';
import { Guide } from './guide';
import { NudgeForm } from './nudge';
import { AskButton, signalContext } from './ask';

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
  const [nudging, setNudging] = useState(false);
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
      {nudging && item.say && (
        <NudgeForm
          person={item.person}
          text={item.say}
          onDone={() => setNudging(false)}
        />
      )}
      <div className="actions">
        {item.say && !nudging && (
          <button className="ghost" onClick={() => setNudging(true)}>
            Написать в чат
          </button>
        )}
        <button onClick={() => hide(7)} disabled={busy}>
          Разобрался — скрыть на неделю
        </button>
        <button className="ghost" onClick={() => hide(1)} disabled={busy}>
          Напомнить завтра
        </button>
        <AskButton
          title={`${item.person}: ${help?.title ?? item.rule}`}
          context={() => signalContext(item, item.person)}
          label="Спросить бота"
          className="ghost"
        />
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
      <>
        <Guide />
        <NoData
          onUnauthorized={onUnauthorized}
          onDone={() => {
            api.today().then(setView).catch(handle);
          }}
        />
      </>
    );

  return (
    <>
      <Guide />
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        По данным на {when(view.asOf)}
        {view.releaseVersion ? ` · релиз ${view.releaseVersion}` : ''}. Кнопки
        только прячут пункт здесь — в Jira ничего не меняется. Если проблема
        останется, пункт вернётся.
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
