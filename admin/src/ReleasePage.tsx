import { useEffect, useMemo, useState } from 'react';
import { api, ReleaseData, ReleaseView, Unauthorized } from './api';
import { Key } from './signals';

const ru = (iso: string | null) => {
  if (!iso) return '—';
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}`;
};

const addWorkingDays = (from: Date, n: number): string => {
  const day = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  let left = Math.ceil(n);
  while (left > 0) {
    day.setUTCDate(day.getUTCDate() + 1);
    const w = day.getUTCDay();
    if (w !== 0 && w !== 6) left -= 1;
  }
  return day.toISOString().slice(0, 10);
};

const VERDICT = {
  'on-track': { label: 'Успеваем', cls: 'ok' },
  'at-risk': { label: 'Под риском', cls: 'warn' },
  late: { label: 'Опаздываем', cls: 'bad' },
  unknown: { label: 'Прогноза нет', cls: 'muted' },
} as const;

const LOW = /^(low|lowest|minor|trivial)$/i;

function Burnup({ points }: { points: ReleaseData['burnup'] }) {
  const W = 560;
  const H = 150;
  const max = Math.max(1, ...points.map((p) => p.scope));
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * W;
  const y = (v: number) => H - (v / max) * H;
  const line = (k: 'scope' | 'done') =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[k])}`).join(' ');
  return (
    <figure className="flow-chart">
      <svg
        viewBox={`-4 -6 ${W + 8} ${H + 26}`}
        role="img"
        aria-label="Объём релиза и сделано по дням"
      >
        <line x1={0} x2={W} y1={H} y2={H} className="axis" />
        <path d={line('scope')} className="burn scope" />
        <path d={line('done')} className="burn done" />
        {points.map((p, i) => (
          <rect
            key={p.day}
            x={x(i) - W / points.length / 2}
            y={0}
            width={W / points.length}
            height={H}
            className="hit"
          >
            <title>
              {ru(p.day)}: в релизе {p.scope}, сделано {p.done}
            </title>
          </rect>
        ))}
        {[0, Math.floor(points.length / 2), points.length - 1].map((i, n) => (
          <text
            key={i}
            x={x(i)}
            y={H + 16}
            className="tick"
            style={{
              textAnchor: n === 0 ? 'start' : n === 2 ? 'end' : 'middle',
            }}
          >
            {ru(points[i]?.day ?? null)}
          </text>
        ))}
      </svg>
      <figcaption className="legend">
        <span>
          <i className="swatch created" /> объём релиза
        </span>
        <span>
          <i className="swatch done" /> сделано
        </span>
        <span className="muted">наведите на график, чтобы увидеть день</span>
      </figcaption>
    </figure>
  );
}

function SprintsCard({
  rows,
  error,
}: {
  rows: ReleaseView['sprints'];
  error: string | null;
}) {
  if (!rows && error)
    return (
      <section className="card">
        <h2>Обещали — сделали</h2>
        <p className="muted small">
          Спринты не прочитались из Jira: {error}. Если доска канбан, спринтов у
          неё нет.
        </p>
      </section>
    );
  if (!rows)
    return (
      <section className="card">
        <h2>Обещали — сделали</h2>
        <p className="muted small">
          Чтобы видеть спринты, задайте в Vercel номер доски Jira
          (PM_JIRA_BOARD_ID) и обновите данные.
        </p>
      </section>
    );
  const closed = rows.filter((r) => r.state === 'closed' && r.sayDo !== null);
  const avg = closed.length
    ? Math.round(
        (closed.reduce((n, r) => n + (r.sayDo ?? 0), 0) / closed.length) * 100,
      )
    : null;
  return (
    <section className="card">
      <h2>Обещали — сделали</h2>
      <p className="muted small">
        «Обещали» — задачи, которые были в спринте на старте; добавленные по
        ходу считаются отдельно.{' '}
        {avg !== null && `В среднем выполняется ${avg}% обещанного.`} Устойчиво
        меньше 70% — планируют больше, чем успевают: стоит брать в спринт
        меньше.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Спринт</th>
              <th>Обещали</th>
              <th>Сделали из обещанного</th>
              <th>Добавили по ходу</th>
              <th title="Обещанное, но не сделанное к концу спринта">
                Перенесли
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={
                  r.sayDo !== null && r.sayDo < 0.7 && r.state === 'closed'
                    ? 'row-warn'
                    : ''
                }
              >
                <td>
                  {r.name}
                  {r.state === 'active' && <span className="tag">идёт</span>}
                </td>
                <td>{r.committed}</td>
                <td>
                  {r.doneCommitted}
                  {r.sayDo !== null && ` (${Math.round(r.sayDo * 100)}%)`}
                </td>
                <td>
                  {r.added}
                  {r.added > 0 && ` (сделано ${r.doneAdded})`}
                </td>
                <td>{r.state === 'closed' ? r.carried : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WhatIf({ r }: { r: ReleaseData }) {
  const [dropLow, setDropLow] = useState(false);
  const [pacePct, setPacePct] = useState(100);
  const [target, setTarget] = useState(r.releaseDate ?? '');
  const low = r.open.filter((i) => LOW.test(i.priority ?? '')).length;
  const remaining = r.open.length - (dropLow ? low : 0);
  const pace = r.pace.perDay ? (r.pace.perDay * pacePct) / 100 : null;
  const eta = useMemo(
    () =>
      remaining === 0
        ? new Date().toISOString().slice(0, 10)
        : pace
        ? addWorkingDays(new Date(), remaining / pace)
        : null,
    [remaining, pace],
  );
  const ok = eta && target ? eta <= target : null;
  return (
    <section className="card">
      <h2>Что если</h2>
      <p className="muted small">
        Меняйте условия — прогноз пересчитается здесь же, в данных ничего не
        меняется.
      </p>
      <div className="whatif">
        <label className="check">
          <input
            type="checkbox"
            checked={dropLow}
            disabled={!low}
            onChange={(e) => setDropLow(e.target.checked)}
          />
          Убрать из релиза низкий приоритет ({low})
        </label>
        <label>
          Темп команды: {pacePct}%
          <input
            type="range"
            min={50}
            max={150}
            step={10}
            value={pacePct}
            onChange={(e) => setPacePct(Number(e.target.value))}
          />
          <span className="muted small">
            Меньше 100% — кто-то в отпуске или отвлечён, больше — добавили
            людей.
          </span>
        </label>
        <label>
          Целевая дата
          <input
            type="date"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
      </div>
      <p className={`whatif-result ${ok === null ? '' : ok ? 'ok' : 'bad'}`}>
        Осталось {remaining}, темп{' '}
        {pace ? `${pace.toFixed(2)} в день` : 'неизвестен'} → готово к{' '}
        <b>{ru(eta)}</b>
        {ok !== null && (ok ? ' — успеваем к цели.' : ' — к цели не успеваем.')}
      </p>
    </section>
  );
}

export function ReleasePage({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [view, setView] = useState<ReleaseView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState('');

  const handle = (e: unknown) => {
    if (e instanceof Unauthorized) onUnauthorized();
    else setError((e as Error).message);
  };

  useEffect(() => {
    api
      .release()
      .then((v) => {
        setView(v);
        setBaseline(v?.release?.creep.custom ? v.release.creep.baseline : '');
      })
      .catch(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveBaseline = async (date: string | null) => {
    try {
      const v = await api.setBaseline(date);
      setView(v);
      setBaseline(v?.release?.creep.custom ? v.release.creep.baseline : '');
    } catch (e) {
      handle(e);
    }
  };

  if (error && view === undefined) return <p className="error">{error}</p>;
  if (view === undefined) return <p className="muted">Загрузка…</p>;
  const r = view?.release;
  if (view?.releaseError)
    return (
      <>
        view?.releaseError) return (
        <section className="card">
          <h2>Релиз не прочитался</h2>
          <p className="muted">
            При последнем обновлении Jira ответила ошибкой: {view.releaseError}.
            Попробуйте обновить данные позже — настройки менять не нужно.
          </p>
        </section>
        <SprintsCard rows={view.sprints} error={view.sprintsError} />
      </>
    );
  if (!view || !r)
    return (
      <>
        <section className="card">
          <h2>Релиз не задан</h2>
          <p className="muted">
            Укажите в Vercel версию релиза в Jira (PM_RELEASE_VERSION) и дату
            (PM_RELEASE_DATE), затем обновите данные. Страница считает всё по
            задачам этой версии.
          </p>
        </section>
        {view && <SprintsCard rows={view.sprints} error={view.sprintsError} />}
      </>
    );

  const links = view.links;
  const v = VERDICT[r.eta.verdict];
  const pct = r.scope.total
    ? Math.round((r.scope.done / r.scope.total) * 100)
    : 0;

  return (
    <>
      {error && <p className="error">{error}</p>}
      <section className={`card verdict ${v.cls}`}>
        <div className="verdict-head">
          <span className={`badge ${v.cls}`}>{v.label}</span>
          <h2>
            Релиз {r.version}
            {r.releaseDate ? ` · цель ${ru(r.releaseDate)}` : ''}
          </h2>
        </div>
        <p>
          {r.eta.date ? (
            <>
              Прогноз готовности: <b>{ru(r.eta.date)}</b>
              {r.eta.early && r.eta.early !== r.eta.date
                ? r.eta.late
                  ? ` (от ${ru(r.eta.early)} до ${ru(
                      r.eta.late,
                    )} по лучшей и худшей неделе)`
                  : ` (при лучшей неделе — ${ru(
                      r.eta.early,
                    )}; была неделя без закрытий, поэтому поздней границы нет)`
                : ''}
              {r.eta.daysLate
                ? ` — позже цели на ${r.eta.daysLate} раб. дн.`
                : '.'}
            </>
          ) : (
            'Прогноза нет: за две недели по релизу ничего не закрыто, при таком темпе релиз не закончится.'
          )}
        </p>
        <p className="small">
          Сделано {r.scope.done} из {r.scope.total} ({pct}%), в работе{' '}
          {r.scope.inProgress}, осталось {r.scope.open}. Темп по релизу:{' '}
          {r.pace.perDay === null
            ? 'за 2 недели ничего не закрыто'
            : `${r.pace.perDay.toFixed(1)} задачи в рабочий день`}
          {r.workingDaysLeft !== null
            ? `. До цели ${r.workingDaysLeft} раб. дн.`
            : '.'}
        </p>
        {r.capped && (
          <p className="muted small">
            В версии больше 500 задач: список обрезан, цифры занижены.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Объём и сделанное по дням</h2>
        <p className="muted small">
          Если линия объёма растёт так же быстро, как сделанное, релиз не
          приближается — стоит обсудить, что отложить.
        </p>
        <Burnup points={r.burnup} />
      </section>

      <WhatIf r={r} />

      <SprintsCard rows={view.sprints} error={view.sprintsError} />

      <section className="card">
        <h2>Что добавили в релиз по ходу</h2>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveBaseline(baseline || null);
          }}
        >
          <label className="small">
            Считать с{r.creep.custom ? '' : ' (сейчас — последние 30 дней)'}{' '}
            <input
              type="date"
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
            />
          </label>
          <button type="submit">OK</button>
          {r.creep.custom && (
            <button
              type="button"
              className="ghost"
              onClick={() => saveBaseline(null)}
            >
              Последние 30 дней
            </button>
          )}
          <button
            type="button"
            className="ghost"
            onClick={() => saveBaseline(new Date().toISOString().slice(0, 10))}
          >
            Зафиксировать сегодня
          </button>
        </form>
        <p className="small">
          На {ru(r.creep.baseline)} в релизе было {r.creep.atBaseline}, с тех
          пор добавили <b>{r.creep.added.length}</b>
          {r.creep.percent !== null ? ` (+${r.creep.percent}%)` : ''}, за
          последнюю неделю {r.creep.addedLast7}.
        </p>
        {r.creep.added.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Задача</th>
                  <th>Тип</th>
                  <th>Кто завёл</th>
                  <th>Добавлена</th>
                </tr>
              </thead>
              <tbody>
                {r.creep.added.slice(0, 25).map((a) => (
                  <tr key={a.key}>
                    <td>
                      <Key k={a.key} links={links} /> {a.summary}
                      {a.done && <span className="tag">сделана</span>}
                    </td>
                    <td>{a.type}</td>
                    <td>{a.reporter ?? '—'}</td>
                    <td>{ru(a.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Что держит остальных</h2>
        {r.critical.length ? (
          <ul className="issues">
            {r.critical.map((c) => (
              <li key={c.key}>
                <Key k={c.key} links={links} /> {c.summary}
                <span className="tags">
                  {c.waiting > 0 && (
                    <span className="tag warn">ждут {c.waiting}</span>
                  )}
                  {c.blockedBy.length > 0 && (
                    <span className="tag">
                      заблокирована {c.blockedBy.join(', ')}
                    </span>
                  )}
                  <span className="tag">{c.assignee ?? 'без исполнителя'}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Блокировок между задачами релиза нет.</p>
        )}
      </section>

      <section className="card">
        <h2>У кого остаток релиза</h2>
        {r.people.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Кто</th>
                  <th>Осталось</th>
                  <th>Доля</th>
                  <th>Нужно дней по его темпу</th>
                </tr>
              </thead>
              <tbody>
                {r.people.map((p) => (
                  <tr key={p.name} className={p.risk ? 'row-warn' : ''}>
                    <td>{p.name}</td>
                    <td>{p.open}</td>
                    <td>{Math.round(p.share * 100)}%</td>
                    <td>{p.daysNeeded ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Открытых релизных задач с исполнителем нет.</p>
        )}
        <p className="muted small">
          Выделены те, у кого больше 40% остатка или кто по своему темпу не
          успевает к цели: этим людям нельзя уходить без передачи дел, а часть
          их задач стоит отдать.
        </p>
      </section>

      <section className="card">
        <h2>Jira против кода</h2>
        {!view.hasCode ? (
          <p className="muted">GitHub не подключён — сверять не с чем.</p>
        ) : r.mismatches.length ? (
          <ul className="issues">
            {r.mismatches.map((m) => (
              <li key={`${m.kind}${m.key}`}>
                <Key k={m.key} links={links} /> {m.detail}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Расхождений не найдено.</p>
        )}
        <p className="muted small">
          Сверка по ключу задачи в названиях PR (открытых и смёрженных за 14
          дней). Если команда не пишет ключ в названии PR, здесь будут ложные
          «PR не видно».
        </p>
      </section>
    </>
  );
}
