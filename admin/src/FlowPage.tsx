import { useEffect, useState } from 'react';
import { api, FlowView, ReviewLoad, Stage, Unauthorized } from './api';
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

const h = (n: number | null) =>
  n === null ? '—' : n < 48 ? `${n} ч` : `${Math.round(n / 24)} дн.`;

function Reviews({
  r,
  names,
  links,
}: {
  r: ReviewLoad;
  names: Record<string, string>;
  links: FlowView['links'];
}) {
  const who = (login: string) =>
    names[login] ? `${names[login]} (${login})` : login;
  return (
    <section className="card">
      <h2>Ревью</h2>
      <p className="muted small">
        PR, смёрженные за {r.windowDays} дней ({r.merged}), и открытые.
        Считается только ревью от другого человека, не от бота.
      </p>
      <div className="tiles">
        <div className="tile">
          <span className="tile-value">{h(r.firstReview.p50)}</span>
          <span className="small muted">
            обычно ждут первого ревью (85% — до {h(r.firstReview.p85)});
            открытые без ревью считаются с тем, сколько уже ждут
          </span>
        </div>
        <div className="tile">
          <span className="tile-value">
            {r.size.medianLines === null ? '—' : `${r.size.medianLines} строк`}
          </span>
          <span className="small muted">
            типичный размер PR; больше 400 строк —{' '}
            {Math.round(r.size.bigShare * 100)}% ({r.size.big})
          </span>
        </div>
      </div>
      {r.missing && r.missing.length > 0 && (
        <p className="warn-line small">
          Не прочитались репозитории: {r.missing.join(', ')} — цифры ниже без
          них.
        </p>
      )}
      {r.concentration && (
        <p className="warn-line small">
          {who(r.concentration.login)} делает{' '}
          {Math.round(r.concentration.share * 100)}% всех ревью: если он занят
          или в отпуске, все ждут. Стоит подключить к ревью ещё людей.
        </p>
      )}
      {r.reviewers.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ревьюер</th>
                <th>Сделал ревью</th>
                <th>Доля</th>
                <th>Ждут его сейчас</th>
              </tr>
            </thead>
            <tbody>
              {r.reviewers.map((x) => (
                <tr key={x.login} className={x.pending >= 3 ? 'row-warn' : ''}>
                  <td>{who(x.login)}</td>
                  <td>{x.reviewed}</td>
                  <td>{Math.round(x.share * 100)}%</td>
                  <td>{x.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.waiting.length > 0 && (
        <>
          <h3>Ждут первого ревью</h3>
          <ul className="issues">
            {r.waiting.map((w) => (
              <li key={`${w.repo}${w.number}`}>
                <Key k={`${w.repo}#${w.number}`} links={links} />{' '}
                {who(w.author)} · ждёт {h(w.hours)}
                {w.requested.length
                  ? ` · назначены: ${w.requested.map(who).join(', ')}`
                  : ' · ревьюер не назначен'}
              </li>
            ))}
          </ul>
        </>
      )}
      {r.noReview.length > 0 && (
        <p className="small">
          Смёржены без ревью:{' '}
          {r.noReview.map((x, i) => (
            <span key={`${x.repo}${x.number}`}>
              {i > 0 && ', '}
              <Key k={`${x.repo}#${x.number}`} links={links} />
            </span>
          ))}
        </p>
      )}
      {r.manyRounds.length > 0 && (
        <p className="small muted">
          Много кругов правок (2+):{' '}
          {r.manyRounds
            .map((x) => `${x.repo}#${x.number} ×${x.rounds}`)
            .join(', ')}
          . Обычно это большой PR или неясная задача.
        </p>
      )}
    </section>
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
      <>
        <section className="card">
          <h2>Истории статусов пока нет</h2>
          <p className="muted">
            Она собирается при обновлении данных из истории изменений Jira.
            Обновите данные на странице «Сотрудники» или дождитесь утреннего
            обновления.
          </p>
        </section>
        {view?.reviews && (
          <Reviews
            r={view.reviews}
            names={view.names ?? {}}
            links={view.links}
          />
        )}
      </>
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

      {view.reviews ? (
        <Reviews r={view.reviews} names={view.names ?? {}} links={links} />
      ) : null}

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
