import { useEffect, useState } from 'react';
import { api, FlowView, Stage, Unauthorized } from './api';
import { Key } from './signals';

const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

const STAGE: Record<Stage, string> = {
  todo: 'к выполнению',
  dev: 'разработка',
  review: 'ревью',
  qa: 'QA',
  blocked: 'в блоке',
  done: 'готово',
};

const SOURCE = {
  map: 'из PM_STATUS_MAP',
  name: 'по названию',
  category: 'по категории Jira',
} as const;

const d = (n: number | null) =>
  n === null ? '—' : `${Math.round(n * 10) / 10} раб. дн.`;

function StageBars({
  medians,
}: {
  medians: NonNullable<FlowView['stages']>['stageMedians'];
}) {
  const rows = (['dev', 'review', 'qa', 'blocked'] as const).map((k) => ({
    k,
    v: medians[k],
  }));
  const max = Math.max(1, ...rows.map((r) => r.v ?? 0));
  const worst = rows
    .filter((r) => r.k !== 'dev' && r.v !== null)
    .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))[0];
  return (
    <>
      <div className="stage-bars">
        {rows.map((r) => (
          <div key={r.k} className="stage-row">
            <span className="stage-name">{STAGE[r.k]}</span>
            <span className="stage-track">
              {r.v !== null && (
                <span
                  className={`stage-fill${r.k === 'blocked' ? ' warn' : ''}`}
                  style={{ width: `${(r.v / max) * 100}%` }}
                  title={`${STAGE[r.k]}: медиана ${d(r.v)}`}
                />
              )}
            </span>
            <span className="stage-value small">{d(r.v)}</span>
          </div>
        ))}
      </div>
      {worst && medians.dev !== null && (worst.v ?? 0) >= medians.dev && (
        <p className="warn-line small">
          Задачи ждут на этапе «{STAGE[worst.k]}» не меньше, чем
          разрабатываются: узкое место скорее там, а не в разработке.
        </p>
      )}
    </>
  );
}

export function FlowPage({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [view, setView] = useState<FlowView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .flow()
      .then(setView)
      .catch((e) => {
        if (e instanceof Unauthorized) onUnauthorized();
        else setError((e as Error).message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (view === undefined) return <p className="muted">Загрузка…</p>;
  if (!view?.stages)
    return (
      <section className="card">
        <h2>Истории статусов пока нет</h2>
        <p className="muted">
          Она собирается при обновлении данных из истории изменений Jira.
          Обновите данные на странице «Сотрудники» или дождитесь утреннего
          обновления.
        </p>
      </section>
    );

  const s = view.stages;
  const links = view.links;
  const bounceRate = s.bounces.total
    ? Math.round((s.bounces.count / s.bounces.total) * 100)
    : 0;

  return (
    <>
      <p className="muted small">
        По данным на {when(view.asOf)} · закрыто за {s.windowDays} дней:{' '}
        {s.finished}
      </p>

      <section className="card">
        <h2>Сколько задачи проводят на этапах</h2>
        <p className="muted small">
          Медиана по задачам, закрытым за {s.windowDays} дней.
        </p>
        <StageBars medians={s.stageMedians} />
        <div className="tiles">
          <div className="tile">
            <span className="tile-value">{d(s.cycle.p50)}</span>
            <span className="small muted">
              половина задач проходит путь от начала работы до «готово»
            </span>
          </div>
          <div className="tile">
            <span className="tile-value">{d(s.cycle.p85)}</span>
            <span className="small muted">
              так закрываются 85% задач — реалистичный срок для обещаний
            </span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Стареющие задачи</h2>
        <p className="muted small">
          Открытые задачи в работе, самые старые сверху. Выделены те, что идут
          дольше, чем 85% закрытых задач, — их стоит разобрать первыми.
        </p>
        {s.aging.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Задача</th>
                  <th>Кто</th>
                  <th>Статус</th>
                  <th>С начала</th>
                  <th>В статусе</th>
                </tr>
              </thead>
              <tbody>
                {s.aging.slice(0, 20).map((a) => (
                  <tr key={a.key} className={a.overP85 ? 'row-warn' : ''}>
                    <td>
                      <Key k={a.key} links={links} />
                    </td>
                    <td>{a.assignee ?? '—'}</td>
                    <td>
                      {a.status}{' '}
                      <span className="muted small">({STAGE[a.stage]})</span>
                    </td>
                    <td>{a.ageDays} дн.</td>
                    <td>{a.stageDays} дн.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Открытых задач в работе нет.</p>
        )}
      </section>

      <section className="card">
        <h2>Возвраты</h2>
        <p className="muted small">
          Считаются движения за последние {s.windowDays} дней.
        </p>
        <p className="small">
          Двигались назад по этапам: <b>{s.bounces.count}</b> из{' '}
          {s.bounces.total} задач ({bounceRate}%). Переоткрыты после «готово»:{' '}
          <b>{s.bounces.reopened}</b>.
        </p>
        {Object.keys(s.bounces.from).length > 0 && (
          <p className="small muted">
            Откуда возвращали:{' '}
            {Object.entries(s.bounces.from)
              .map(([k, v]) => `${STAGE[k as Stage]} — ${v}`)
              .join(', ')}
            . Частые возвраты из QA обычно значат нечёткие требования или
            спешку; из ревью — большие PR.
          </p>
        )}
        {s.bounces.worst.length > 0 && (
          <p className="small">
            Чаще всего:{' '}
            {s.bounces.worst.map((w, i) => (
              <span key={w.key}>
                {i > 0 && ', '}
                <Key k={w.key} links={links} /> ×{w.times}
              </span>
            ))}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Передачи между людьми</h2>
        <p className="muted small">За последние {s.windowDays} дней.</p>
        {s.handoffs.pairs.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>От кого</th>
                  <th>Кому</th>
                  <th>Раз</th>
                  <th>Ждёт после передачи</th>
                </tr>
              </thead>
              <tbody>
                {s.handoffs.pairs.map((p) => (
                  <tr key={`${p.from}${p.to}`}>
                    <td>{p.from}</td>
                    <td>{p.to}</td>
                    <td>{p.count}</td>
                    <td>{d(p.waitDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Передач не было.</p>
        )}
        {s.handoffs.many.length > 0 && (
          <p className="small muted">
            Прошли через 3+ человек:{' '}
            {s.handoffs.many.map((m, i) => (
              <span key={m.key}>
                {i > 0 && ', '}
                <Key k={m.key} links={links} /> ({m.people})
              </span>
            ))}
            . Чем больше рук, тем дольше задача ждёт между ними.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Блоки</h2>
        <p className="small">
          За {s.windowDays} дней задачи провели в блоке{' '}
          <b>{s.blocked.daysInWindow}</b> раб. дн. суммарно.
        </p>
        {s.blocked.current.length ? (
          <ul className="issues">
            {s.blocked.current.map((b) => (
              <li key={b.key}>
                <Key k={b.key} links={links} /> {b.assignee ?? '—'} · в блоке{' '}
                {b.days} дн.
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Сейчас заблокированных задач нет.</p>
        )}
      </section>

      <details className="card">
        <summary>Как статусы Jira разложены по этапам</summary>
        <p className="muted small">
          Если что-то не так, задайте в Vercel переменную PM_STATUS_MAP,
          например «Ожидает клиента=blocked, Проверка=qa». Этапы: todo, dev,
          review, qa, blocked, done.
        </p>
        <ul className="issues">
          {s.statuses.map((x) => (
            <li key={x.name}>
              {x.name} → <b>{STAGE[x.stage]}</b>{' '}
              <span className="muted small">({SOURCE[x.source]})</span>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
