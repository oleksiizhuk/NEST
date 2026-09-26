import { useEffect, useState } from 'react';
import { api, AreasView, Unauthorized } from './api';
import { Key } from './signals';

const trend = (now: number, before: number) =>
  now > before ? '↑' : now < before ? '↓' : '→';

export function QualityPage({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [view, setView] = useState<AreasView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .areas()
      .then(setView)
      .catch((e) => {
        if (e instanceof Unauthorized) onUnauthorized();
        else setError((e as Error).message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (view === undefined) return <p className="muted">Загрузка…</p>;
  const a = view?.areas;
  if (!view || !a)
    return (
      <section className="card">
        <h2>Данных по областям пока нет</h2>
        <p className="muted">
          Они собираются при обновлении данных из истории Jira за 12 недель.
        </p>
      </section>
    );

  const risky = a.areas.filter((r) => r.busRisk);
  return (
    <>
      <p className="muted small">
        Области — это компоненты Jira. Всё считается по областям и по команде,
        не по людям: баг в области — повод посмотреть на процесс, а не искать
        виноватого.
      </p>
      {a.noAreaShare > 0.5 && (
        <p className="warn-line small">
          У {Math.round(a.noAreaShare * 100)}% открытых задач нет компонента —
          картина по областям неполная. Стоит договориться проставлять
          компоненты.
        </p>
      )}

      {risky.length > 0 && (
        <section className="card">
          <h2>Области, которые знает один человек</h2>
          <p className="muted small">
            Больше 80% задач области за 12 недель закрыл один человек, а работа
            там ещё есть. Если он заболеет или уйдёт в отпуск — область встанет.
          </p>
          <ul className="issues">
            {risky.map((r) => (
              <li key={r.name}>
                <b>{r.name}</b> — {r.owner?.name} (
                {Math.round((r.owner?.share ?? 0) * 100)}%)
                {r.backup
                  ? `; кто ещё что-то делал: ${r.backup} — начните с него`
                  : '; больше никто задач здесь не закрывал'}
                . Открыто {r.open}.
              </li>
            ))}
          </ul>
          <p className="muted small">
            Что обычно делают: парная работа на следующей задаче области,
            короткая документация, ревью кода области другим человеком.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Баги и работа по областям</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Область</th>
                <th>Новых багов, 14 дн.</th>
                <th>Открытых багов</th>
                <th>Открыто задач</th>
                <th>Закрыто, 12 нед.</th>
                <th>Кто в основном закрывал</th>
              </tr>
            </thead>
            <tbody>
              {a.areas.map((r) => (
                <tr
                  key={r.name}
                  className={
                    r.bugsNew > r.bugsBefore && r.bugsNew >= 3 ? 'row-warn' : ''
                  }
                >
                  <td>{r.name}</td>
                  <td>
                    {r.bugsNew} {trend(r.bugsNew, r.bugsBefore)}{' '}
                    <span className="muted small">(было {r.bugsBefore})</span>
                  </td>
                  <td>
                    {r.openBugs}
                    {r.openBugKeys.length > 0 && (
                      <span className="small">
                        {' '}
                        (
                        {r.openBugKeys.map((k, i) => (
                          <span key={k}>
                            {i > 0 && ', '}
                            <Key k={k} links={view.links} />
                          </span>
                        ))}
                        )
                      </span>
                    )}
                  </td>
                  <td>{r.open}</td>
                  <td>{r.done}</td>
                  <td>
                    {r.owner
                      ? `${r.owner.name} ${Math.round(r.owner.share * 100)}%`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Выделены области, где новых багов стало больше, чем две недели назад
          (от 3). Что обычно делают: тесты на эту часть, разбор причин на ретро,
          меньше параллельных изменений в области.
        </p>
      </section>
    </>
  );
}
