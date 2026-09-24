import { useEffect, useState } from 'react';
import { api, Person, TeamIssue, TeamView, Unauthorized } from './api';

const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

function Issue({ i }: { i: TeamIssue }) {
  return (
    <li>
      <span className="key">{i.key}</span> {i.summary}
      <span className="tags">
        {i.priority && <span className="tag">{i.priority}</span>}
        {i.days !== undefined && i.days !== null && (
          <span className={`tag${i.days > 5 ? ' warn' : ''}`}>
            {i.days} раб. дн.
          </span>
        )}
        {!i.inScope && <span className="tag warn">не в релизе</span>}
        {i.blocked && <span className="tag warn">заблокировано</span>}
      </span>
    </li>
  );
}

function PersonCard({
  p,
  onGithub,
}: {
  p: Person;
  onGithub: (login: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [login, setLogin] = useState(p.github ?? '');
  const warns = p.signals.filter((s) => s.level === 'warn').length;

  return (
    <article className={`card person${warns ? ' has-warn' : ''}`}>
      <header className="person-head">
        <div>
          <h2>{p.name}</h2>
          {editing ? (
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await onGithub(login.trim() || null);
                setEditing(false);
              }}
            >
              <input
                value={login}
                placeholder="логин GitHub"
                onChange={(e) => setLogin(e.target.value)}
              />
              <button type="submit">OK</button>
              <button
                type="button"
                className="ghost"
                onClick={() => setEditing(false)}
              >
                Отмена
              </button>
            </form>
          ) : (
            <button className="link small" onClick={() => setEditing(true)}>
              {p.github ? `GitHub: ${p.github}` : 'Привязать GitHub'}
            </button>
          )}
        </div>
        <div className="chips">
          <span className="chip">В работе {p.inProgress.length}</span>
          <span className="chip">Очередь {p.queue.length}</span>
          <span className="chip">Закрыто 14 дн. {p.done14.length}</span>
          {p.github && <span className="chip">PR {p.pulls.length}</span>}
        </div>
      </header>

      <ul className="signals">
        {p.signals.map((s, i) => (
          <li key={i} className={s.level}>
            {s.text}
          </li>
        ))}
      </ul>

      <button className="link" onClick={() => setOpen((v) => !v)}>
        {open ? 'Скрыть детали' : 'Показать, над чем работает'}
      </button>

      {open && (
        <div className="person-details">
          <h3>В работе</h3>
          {p.inProgress.length ? (
            <ul className="issues">
              {p.inProgress.map((i) => (
                <Issue key={i.key} i={i} />
              ))}
            </ul>
          ) : (
            <p className="muted">Ничего</p>
          )}
          <h3>Очередь</h3>
          {p.queue.length ? (
            <ul className="issues">
              {p.queue.slice(0, 8).map((i) => (
                <Issue key={i.key} i={i} />
              ))}
            </ul>
          ) : (
            <p className="muted">Пусто</p>
          )}
          {p.queue.length > 8 && (
            <p className="muted small">и ещё {p.queue.length - 8}</p>
          )}
          <h3>Закрыто за 14 дней</h3>
          {p.done14.length ? (
            <ul className="issues">
              {p.done14.map((d) => (
                <li key={d.key}>
                  <span className="key">{d.key}</span> {d.summary}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Ничего</p>
          )}
          {p.github && (
            <>
              <h3>Pull requests</h3>
              {p.pulls.length ? (
                <ul className="issues">
                  {p.pulls.map((x) => (
                    <li key={`${x.repo}${x.number}`}>
                      <span className="key">
                        {x.repo}#{x.number}
                      </span>{' '}
                      {x.title}
                      <span className="tags">
                        {x.draft && <span className="tag">черновик</span>}
                        <span
                          className={`tag${
                            x.review === 'no review yet' && x.waitingDays > 2
                              ? ' warn'
                              : ''
                          }`}
                        >
                          {x.review === 'no review yet'
                            ? `без ревью ${x.waitingDays} дн.`
                            : x.review === 'APPROVED'
                            ? 'одобрен'
                            : x.review === 'CHANGES_REQUESTED'
                            ? 'нужны правки'
                            : x.review}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Открытых нет</p>
              )}
              <p className="muted small">
                Смёржено за 14 дней: {p.merged14.length}
              </p>
            </>
          )}
        </div>
      )}
    </article>
  );
}

export function TeamPage({
  refreshKey,
  onUnauthorized,
}: {
  refreshKey: number;
  onUnauthorized: () => void;
}) {
  const [view, setView] = useState<TeamView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyWarn, setOnlyWarn] = useState(false);

  const handle = (e: unknown) => {
    if (e instanceof Unauthorized) onUnauthorized();
    else setError((e as Error).message);
  };

  useEffect(() => {
    setError(null);
    api.team().then(setView).catch(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const review = async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.teamReview(force);
      setView((v) => (v ? { ...v, review: r } : v));
    } catch (e) {
      handle(e);
    } finally {
      setBusy(false);
    }
  };

  if (!view)
    return error ? (
      <p className="error">{error}</p>
    ) : (
      <p className="muted">Загрузка…</p>
    );
  const team = view.team;
  const people = (team?.people ?? []).filter(
    (p) => !onlyWarn || p.signals.some((s) => s.level === 'warn'),
  );

  return (
    <>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <div className="review-head">
          <h2>Анализ для митинга</h2>
          {view.review && (
            <span className="muted small">от {when(view.review.at)}</span>
          )}
        </div>
        {busy ? (
          <p className="muted">
            Модель готовит разбор по каждому человеку — это до 2 минут…
          </p>
        ) : view.review ? (
          <div className="review-text">{view.review.text}</div>
        ) : (
          <p className="muted">
            Разбор по каждому: над чем работает, в ту ли сторону идёт и что
            посоветовать на встрече. Готовится моделью по данным ниже;
            сохраняется на день.
          </p>
        )}
        <div className="actions">
          <button onClick={() => review(Boolean(view.review))} disabled={busy}>
            {view.review ? 'Подготовить заново' : 'Подготовить анализ'}
          </button>
        </div>
      </section>

      {!team ? (
        <p className="muted">Нет данных: снимок проекта ещё не собран.</p>
      ) : (
        <>
          <div className="team-bar">
            <span className="muted small">
              Данные на {when(team.asOf)}
              {team.releaseVersion
                ? ` · релиз ${team.releaseVersion}`
                : ' · версия релиза не задана'}
              {team.capped ? ' · список Jira обрезан' : ''}
            </span>
            <label className="check">
              <input
                type="checkbox"
                checked={onlyWarn}
                onChange={(e) => setOnlyWarn(e.target.checked)}
              />
              Только с замечаниями
            </label>
          </div>
          <div className="people">
            {people.map((p) => (
              <PersonCard
                key={p.name}
                p={p}
                onGithub={async (login) => {
                  try {
                    setView(await api.setGithub(p.name, login));
                  } catch (e) {
                    handle(e);
                  }
                }}
              />
            ))}
          </div>
          {!people.length && (
            <p className="muted">
              {onlyWarn ? 'Замечаний нет.' : 'В Jira нет исполнителей.'}
            </p>
          )}
          {team.unmatchedGithub.length > 0 && (
            <p className="muted small">
              GitHub без привязки к человеку: {team.unmatchedGithub.join(', ')}
            </p>
          )}
        </>
      )}
    </>
  );
}
