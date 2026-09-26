import { useEffect, useMemo, useState } from 'react';
import { api, HangingItem, HangingView, Unauthorized } from './api';
import { Key } from './signals';

type Group = 'progress' | 'idle' | 'backlog' | 'unassigned' | 'all';

const GROUPS: Array<{ id: Group; title: string; hint: string }> = [
  {
    id: 'progress',
    title: 'Давно в работе',
    hint: 'В работе, но статус не менялся дольше порога. Спросите, что мешает, или верните в очередь.',
  },
  {
    id: 'idle',
    title: 'Никто не трогал',
    hint: 'Ни комментариев, ни изменений дольше порога. Либо задача не нужна (закрыть), либо о ней забыли (назначить срок).',
  },
  {
    id: 'backlog',
    title: 'Старый бэклог',
    hint: 'В очереди дольше порога с момента создания. Раз в месяц такие стоит пересмотреть: закрыть или поднять приоритет.',
  },
  {
    id: 'unassigned',
    title: 'Без исполнителя',
    hint: 'Никто не отвечает за задачу. Назначьте человека или закройте.',
  },
  { id: 'all', title: 'Все открытые', hint: '' },
];

const THRESHOLDS: Record<Group, number[]> = {
  progress: [5, 10, 20, 30],
  idle: [14, 30, 60, 90],
  backlog: [30, 60, 90, 180],
  unassigned: [7, 14, 30, 60],
  all: [0],
};

const DEFAULT: Record<Group, number> = {
  progress: 10,
  idle: 30,
  backlog: 60,
  unassigned: 14,
  all: 0,
};

const matches = (g: Group, i: HangingItem, min: number) => {
  switch (g) {
    case 'progress':
      return i.category === 'indeterminate' && (i.inStatusDays ?? 0) >= min;
    case 'idle':
      return (i.idleDays ?? 0) >= min;
    case 'backlog':
      return i.category === 'new' && (i.openDays ?? 0) >= min;
    case 'unassigned':
      return !i.assignee && (i.openDays ?? 0) >= min;
    default:
      return true;
  }
};

export function HangingPage({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [view, setView] = useState<HangingView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>('progress');
  const [min, setMin] = useState(DEFAULT.progress);
  const [who, setWho] = useState('');
  const [releaseOnly, setReleaseOnly] = useState(false);

  useEffect(() => {
    api
      .hanging()
      .then(setView)
      .catch((e) => {
        if (e instanceof Unauthorized) onUnauthorized();
        else setError((e as Error).message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = view?.hanging?.items ?? [];
  const people = useMemo(
    () =>
      [
        ...new Set(items.map((i) => i.assignee).filter(Boolean)),
      ].sort() as string[],
    [items],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        GROUPS.map((g) => [
          g.id,
          items.filter((i) => matches(g.id, i, DEFAULT[g.id])).length,
        ]),
      ) as Record<Group, number>,
    [items],
  );
  const shown = items
    .filter((i) => matches(group, i, min))
    .filter((i) => !who || i.assignee === who)
    .filter((i) => !releaseOnly || i.inScope);

  if (error) return <p className="error">{error}</p>;
  if (view === undefined) return <p className="muted">Загрузка…</p>;
  if (!view?.hanging)
    return (
      <section className="card">
        <h2>Списка пока нет</h2>
        <p className="muted">
          Он собирается при обновлении данных из Jira. Обновите данные на
          странице «Сотрудники».
        </p>
      </section>
    );

  const meta = GROUPS.find((g) => g.id === group) ?? GROUPS[0];
  const sortKey =
    group === 'progress'
      ? 'inStatusDays'
      : group === 'backlog' || group === 'unassigned'
      ? 'openDays'
      : 'idleDays';
  const sorted = [...shown].sort(
    (a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0),
  );

  return (
    <>
      {view.stale && (
        <p className="warn-line small">
          Последнее обновление не прочитало Jira — список от предыдущего раза.
        </p>
      )}
      {view.hanging.capped && (
        <p className="muted small">
          Открытых задач больше 400: часть старого бэклога с низким приоритетом
          может не попасть в список.
        </p>
      )}
      <div className="tabs" role="tablist">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            role="tab"
            aria-selected={g.id === group}
            className={`tab${g.id === group ? ' active' : ''}`}
            onClick={() => {
              setGroup(g.id);
              setMin(DEFAULT[g.id]);
            }}
          >
            {g.title}
            {g.id !== 'all' && ` · ${counts[g.id]}`}
          </button>
        ))}
      </div>
      {meta.hint && <p className="muted small">{meta.hint}</p>}
      <div className="filters">
        {group !== 'all' && (
          <label className="small">
            Дольше
            <select
              value={min}
              onChange={(e) => setMin(Number(e.target.value))}
            >
              {THRESHOLDS[group].map((d) => (
                <option key={d} value={d}>
                  {d} дней
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="small">
          Кто
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">все</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {view.hanging.releaseVersion && (
          <label className="check small">
            <input
              type="checkbox"
              checked={releaseOnly}
              onChange={(e) => setReleaseOnly(e.target.checked)}
            />
            только релиз {view.hanging.releaseVersion}
          </label>
        )}
      </div>
      <section className="card">
        <h2>
          {meta.title}: {sorted.length}
        </h2>
        {sorted.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Задача</th>
                  <th>Статус</th>
                  <th>Кто</th>
                  <th>Открыта</th>
                  <th>Не трогали</th>
                  <th>В статусе</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 200).map((i) => (
                  <tr key={i.key}>
                    <td>
                      <Key k={i.key} links={view.links} /> {i.summary}
                      <span className="tags">
                        {i.priority && (
                          <span className="tag">{i.priority}</span>
                        )}
                        {i.inScope && <span className="tag warn">релиз</span>}
                      </span>
                    </td>
                    <td>{i.status}</td>
                    <td>{i.assignee ?? '—'}</td>
                    <td>{i.openDays ?? '—'} дн.</td>
                    <td>{i.idleDays ?? '—'} дн.</td>
                    <td>{i.inStatusDays ?? '—'} дн.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Таких задач нет.</p>
        )}
        {sorted.length > 200 && (
          <p className="muted small">Показаны первые 200 из {sorted.length}.</p>
        )}
      </section>
    </>
  );
}
