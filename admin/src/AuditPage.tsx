import { useEffect, useRef, useState } from 'react';
import {
  api,
  AuditItem,
  AuditDeferred,
  AuditKind,
  AuditPhase,
  AuditRun,
  Unauthorized,
} from './api';
import { modelCallBody, TokenBadge, useConfirm } from './confirm';

const PHASES: Array<{ id: AuditPhase; title: string }> = [
  { id: 'design-web', title: 'Дизайн ↔ веб' },
  { id: 'design-mobile', title: 'Дизайн ↔ мобильное приложение' },
  { id: 'web-mobile', title: 'Веб ↔ мобильное приложение' },
  { id: 'clients-backend', title: 'Веб и мобильное ↔ бэкенд' },
  { id: 'compose', title: 'Сборка списков' },
  { id: 'post', title: 'Отправка в Telegram' },
];

const LISTS: Array<{ kind: AuditKind; title: string; lead: string }> = [
  {
    kind: 'tech',
    title: 'Техническое',
    lead: 'Расхождения между вебом, мобильным приложением и бэкендом — для разработчиков.',
  },
  {
    kind: 'design',
    title: 'Дизайн',
    lead: 'Где сделанное расходится с макетами Figma — для всех.',
  },
];

const STATUS: Record<AuditRun['status'], { text: string; tone: string }> = {
  running: { text: 'идёт', tone: 'warn' },
  posted: { text: 'отправлен', tone: 'ok' },
  failed: { text: 'остановился с ошибкой', tone: 'bad' },
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '—';

const phaseTitle = (id: AuditPhase) =>
  PHASES.find((p) => p.id === id)?.title ?? id;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AuditPage({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [run, setRun] = useState<AuditRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [owner, setOwner] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, ask] = useConfirm();
  const stop = useRef(false);

  const handle = (e: unknown) => {
    if (e instanceof Unauthorized) onUnauthorized();
    else setError((e as Error).message);
  };

  const load = () =>
    api
      .audit()
      .then((r) => setRun(r.run))
      .catch(handle)
      .finally(() => setLoaded(true));

  useEffect(() => {
    load();
    api
      .me()
      .then((me) => setOwner(me.owner))
      .catch(() => undefined);
    // Leaving the page stops the loop; the cron finishes the run later
    return () => {
      stop.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each step is one comparison (up to ~4 minutes on the server); keep
  // calling until the run is posted or failed
  const start = async () => {
    const ok = await ask({
      title: 'Запустить аудит сейчас?',
      body: modelCallBody(
        'Модель по очереди сравнит дизайн, веб, мобильное приложение и бэкенд и пришлёт два списка в Telegram. Это несколько запросов подряд, всего до 15–20 минут; страницу лучше не закрывать.',
        'Если закрыть страницу, аудит доделает утренний запуск по расписанию.',
      ),
      confirm: 'Запустить',
    });
    if (!ok) return;
    setRunning(true);
    setError(null);
    setMessage(null);
    stop.current = false;
    try {
      // A run already in progress comes back as is and is continued
      let current: AuditRun | null = (await api.auditStart()).run;
      let idle = 0;
      while (current?.status === 'running' && !stop.current) {
        setRun(current);
        const before: AuditRun = current;
        current = (await api.auditStep()).run;
        // Same phase, same attempts: another call (the cron) holds the step,
        // so nothing moved; wait instead of asking again at once
        const moved =
          !current ||
          current.status !== 'running' ||
          current.phase !== before.phase ||
          current.attempts !== before.attempts;
        if (moved) idle = 0;
        else if (++idle > 30) break;
        else await pause(10_000);
      }
      if (current) setRun(current);
      if (current?.status === 'posted')
        setMessage('Готово: списки отправлены в Telegram.');
      else if (current?.status === 'failed')
        setError(`Аудит остановился: ${current.error ?? 'ошибка'}`);
      else if (current?.status === 'running')
        setMessage(
          'Аудит ещё идёт. Его доделает запуск по расписанию, или нажмите кнопку ещё раз.',
        );
    } catch (e) {
      handle(e);
    } finally {
      setRunning(false);
    }
  };

  const done = run
    ? run.status === 'running'
      ? Math.max(
          0,
          PHASES.findIndex((p) => p.id === run.phase),
        )
      : run.status === 'posted'
      ? PHASES.length
      : PHASES.findIndex((p) => p.id === run.phase)
    : 0;

  return (
    <>
      {error && <p className="error">{error}</p>}
      {message && <p className="ok">{message}</p>}

      <section className="card">
        <h2>Что это</h2>
        <p className="muted">
          Раз в 3 дня бот сам сравнивает макеты в Figma, веб, мобильное
          приложение и бэкенд и ищет, где они разошлись: экран сделан не по
          макету, на вебе есть то, чего нет в приложении, клиент ждёт от бэкенда
          поле, которого там нет. Найденное приходит двумя сообщениями в
          Telegram — в чат аудита (если он не задан — в чат утренней сводки,
          иначе владельцу в личку): технический список для разработчиков и
          список по дизайну для всех.
        </p>
        <p className="muted">
          Под каждым пунктом есть кнопка. Нажатие ставит ✅ с именем нажавшего —
          это значит «посмотрели», а не «исправили»; повторное нажатие снимает
          отметку. Бот никого не отмечает и не тегает: кто взялся, тот и
          нажимает.
        </p>
      </section>

      <section className="card">
        <div className="verdict-head">
          <h2>Последний аудит</h2>
          {run && (
            <span className={`badge ${STATUS[run.status].tone}`}>
              {STATUS[run.status].text}
            </span>
          )}
        </div>
        {!loaded ? (
          <p className="muted">Загрузка…</p>
        ) : !run ? (
          <p className="muted">Аудит ещё не запускался.</p>
        ) : (
          <>
            <p className="muted small">
              Начат {when(run.startedAt)}
              {run.startedBy === 'cron' ? ' по расписанию' : ' вручную'}
              {run.finishedAt ? ` · закончен ${when(run.finishedAt)}` : ''}
            </p>
            <div className="stage-bars">
              {PHASES.map((p, i) => (
                <div key={p.id} className="small">
                  {i < done
                    ? '✅'
                    : run.status === 'running' && i === done
                    ? '⏳'
                    : run.status === 'failed' && i === done
                    ? '❌'
                    : '⬜'}{' '}
                  {p.title}
                </div>
              ))}
            </div>
            {run.status === 'failed' && run.error && (
              <p className="error">{run.error}</p>
            )}
          </>
        )}
        <div className="actions">
          {owner ? (
            <>
              <button onClick={start} disabled={running}>
                {running
                  ? `Идёт: ${
                      run ? phaseTitle(run.phase) : '…'
                    } — не уходите со страницы`
                  : 'Запустить сейчас'}
              </button>
              <TokenBadge />
              {running && (
                <button className="ghost" onClick={() => (stop.current = true)}>
                  Пауза
                </button>
              )}
            </>
          ) : (
            <span className="muted small">
              Запустить вручную может только владелец бота.
            </span>
          )}
        </div>
      </section>

      {run &&
        LISTS.map((list) => (
          <AuditList
            key={list.kind}
            title={list.title}
            lead={list.lead}
            items={run.items.filter((i) => i.kind === list.kind)}
            deferred={(run.deferred ?? []).filter(
              (d) => d.kind === list.kind,
            )}
            sent={run.posts.some((p) => p.kind === list.kind)}
          />
        ))}

      {run && Object.keys(run.findings).length > 0 && (
        <details className="card">
          <summary>Что модель нашла на каждом шаге</summary>
          {PHASES.filter((p) => run.findings[p.id]).map((p) => (
            <div key={p.id}>
              <h3>{p.title}</h3>
              <div className="review-text">{run.findings[p.id]}</div>
            </div>
          ))}
        </details>
      )}
      {modal}
    </>
  );
}

function AuditList({
  title,
  lead,
  items,
  deferred = [],
  sent,
}: {
  title: string;
  lead: string;
  items: AuditItem[];
  // Found but not on the list: being fixed already, or a later release
  deferred?: AuditDeferred[];
  sent: boolean;
}) {
  const checked = items.filter((i) => i.checkedBy).length;
  return (
    <section className="card">
      <div className="verdict-head">
        <h2>{title}</h2>
        {items.length > 0 && (
          <span className="muted small">
            посмотрели {checked} из {items.length}
            {sent ? '' : ' · ещё не отправлено'}
          </span>
        )}
      </div>
      <p className="muted">{lead}</p>
      {items.length === 0 ? (
        <p className="muted">Пунктов нет.</p>
      ) : (
        <ul className="issues">
          {items.map((i) => (
            <li key={i.index}>
              <div>
                {i.checkedBy ? '✅' : '⬜'} <b>{i.title}</b>
                <span className="tags">
                  {i.release && <span className="tag warn">к релизу</span>}
                  {i.fix && (
                    <span className="tag">менять: {FIX_LABEL[i.fix]}</span>
                  )}
                  {i.areas.map((a) => (
                    <span key={a} className="tag">
                      {a}
                    </span>
                  ))}
                  {i.repeat && (
                    <span className="tag warn">уже было в прошлый раз</span>
                  )}
                </span>
              </div>
              <div className="muted small">{i.detail}</div>
              {i.checkedBy && (
                <div className="muted small">
                  Посмотрел(а): {i.checkedBy.name}, {when(i.checkedBy.at)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {deferred.length > 0 && (
        <div className="muted small">
          {(['in_progress', 'later'] as const).map((bucket) => {
            const rows = deferred.filter((d) => d.bucket === bucket);
            return rows.length ? (
              <p key={bucket}>
                <b>
                  {bucket === 'in_progress'
                    ? 'Уже в работе, не в списке:'
                    : 'Позже, не в текущем релизе:'}
                </b>{' '}
                {rows
                  .map((d) => (d.ref ? `${d.title} (${d.ref})` : d.title))
                  .join('; ')}
              </p>
            ) : null;
          })}
        </div>
      )}
    </section>
  );
}

const FIX_LABEL: Record<NonNullable<AuditItem['fix']>, string> = {
  design: 'дизайн',
  web: 'веб',
  mobile: 'мобилка',
  backend: 'бэкенд',
};
