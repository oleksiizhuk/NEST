import { useEffect, useState } from 'react';
import {
  api,
  Links,
  Person,
  ReviewKind,
  SignalRule,
  TeamIssue,
  TeamView,
  Thresholds,
  Unauthorized,
} from './api';
import { Key, RULES, SignalLine } from './signals';
import { Sparkline, TeamFlowChart } from './charts';
import { NudgeForm } from './nudge';

const TOGGLEABLE: SignalRule[] = [
  'wip',
  'stale',
  'off-release',
  'priority',
  'overdue',
  'blocked',
  'idle',
  'no-output',
  'pr-wait',
  'changes',
  'overload',
  'underload',
  'runway',
];

const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

function Issue({
  i,
  links,
  stale,
}: {
  i: TeamIssue;
  links: Links | null;
  stale: number;
}) {
  return (
    <li>
      <Key k={i.key} links={links} /> {i.summary}
      <span className="tags">
        {i.status && <span className="tag">{i.status}</span>}
        {i.priority && <span className="tag">{i.priority}</span>}
        {i.days !== undefined && i.days !== null && (
          <span className={`tag${i.days > stale ? ' warn' : ''}`}>
            {i.days} раб. дн.
          </span>
        )}
        {!i.inScope && <span className="tag warn">не в релизе</span>}
        {i.blocked && <span className="tag warn">заблокировано</span>}
      </span>
    </li>
  );
}

const ruDay = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
};

function AwayEditor({
  p,
  onAway,
}: {
  p: Person;
  onAway: (until: string | null, note: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [until, setUntil] = useState(p.away?.until ?? '');
  const [note, setNote] = useState(p.away?.note ?? '');
  const today = new Date().toISOString().slice(0, 10);
  const away = p.away && p.away.until >= today ? p.away : null;

  if (!editing)
    return (
      <button className="link small" onClick={() => setEditing(true)}>
        {away
          ? `Отсутствует до ${ruDay(away.until)}${
              away.note ? ` (${away.note})` : ''
            }`
          : 'Отметить отсутствие'}
      </button>
    );
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await onAway(until || null, note.trim() || null);
        setEditing(false);
      }}
    >
      <input
        type="date"
        value={until}
        min={today}
        aria-label="Отсутствует до (включительно)"
        onChange={(e) => setUntil(e.target.value)}
      />
      <input
        value={note}
        maxLength={60}
        placeholder="отпуск, больничный…"
        onChange={(e) => setNote(e.target.value)}
      />
      <button type="submit">OK</button>
      {p.away && (
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            await onAway(null, null);
            setEditing(false);
          }}
        >
          Вернулся
        </button>
      )}
      <button type="button" className="ghost" onClick={() => setEditing(false)}>
        Отмена
      </button>
    </form>
  );
}

function ThresholdsPanel({
  value,
  onSave,
}: {
  value: Thresholds;
  onSave: (t: Thresholds) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Thresholds>(value);
  const [busy, setBusy] = useState(false);
  const num = (
    k: 'wipLimit' | 'staleDays' | 'reviewWaitDays' | 'runwayDays',
  ) => (
    <input
      type="number"
      min={1}
      max={k === 'staleDays' ? 30 : k === 'reviewWaitDays' ? 14 : 10}
      value={draft[k]}
      onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })}
    />
  );
  if (!open)
    return (
      <button className="link small" onClick={() => setOpen(true)}>
        Пороги сигналов: в работе &gt; {value.wipLimit}, застряла &gt;{' '}
        {value.staleDays} дн., ревью &gt; {value.reviewWaitDays} дн.
        {value.off.length ? ` · выключено ${value.off.length}` : ''}
      </button>
    );
  return (
    <section className="card thresholds">
      <h2>Пороги сигналов</h2>
      <div className="threshold-grid">
        <label>
          Задач в работе одновременно, не больше
          {num('wipLimit')}
          <span className="muted small">
            Обычно 1–2 на человека: так задачи быстрее доходят до конца.
          </span>
        </label>
        <label>
          Рабочих дней в работе, после которых задача «застряла»
          {num('staleDays')}
          <span className="muted small">
            Типичная задача — 2–5 дней. Больше — повод спросить, что мешает.
          </span>
        </label>
        <label>
          Рабочих дней ожидания ревью PR
          {num('reviewWaitDays')}
          <span className="muted small">
            Хорошо — ревью в течение дня, терпимо — два.
          </span>
        </label>
        <label>
          Рабочих дней работы в запасе, меньше которых — «скоро нечего делать»
          {num('runwayDays')}
          <span className="muted small">
            Считается по личному темпу за 4 недели. 2 дня — время заранее
            выбрать следующую задачу.
          </span>
        </label>
      </div>
      <h3>Какие сигналы показывать</h3>
      <div className="rule-toggles">
        {TOGGLEABLE.map((r) => (
          <label key={r} className="check">
            <input
              type="checkbox"
              checked={!draft.off.includes(r)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  off: e.target.checked
                    ? draft.off.filter((x) => x !== r)
                    : [...draft.off, r],
                })
              }
            />
            {RULES[r].title}
          </label>
        ))}
      </div>
      <div className="actions">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(draft);
              setOpen(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          Сохранить
        </button>
        <button
          className="ghost"
          onClick={() => {
            setDraft(value);
            setOpen(false);
          }}
        >
          Отмена
        </button>
      </div>
    </section>
  );
}

const BADGE = {
  over: 'перегружен',
  under: 'недогружен',
  normal: 'норма',
} as const;

function LoadRow({ p, weeks }: { p: Person; weeks: string[] }) {
  const l = p.load;
  const max = Math.max(l.total, l.median * 2, 1);
  return (
    <div className="load">
      <div
        className="load-bar"
        title={`Открыто ${l.total}, медиана команды ${l.median}`}
      >
        <span
          className={`load-fill ${l.badge ?? 'normal'}`}
          style={{ width: `${(l.total / max) * 100}%` }}
        />
        {l.median > 0 && (
          <span
            className="load-median"
            style={{ left: `${(l.median / max) * 100}%` }}
          />
        )}
      </div>
      <div className="load-text small">
        {l.badge && l.badge !== 'normal' && (
          <span className={`tag ${l.badge === 'over' ? 'warn' : ''}`}>
            {BADGE[l.badge]}
          </span>
        )}{' '}
        Открыто {l.total}
        {l.median ? ` · медиана ${l.median}` : ''}
        {' · '}
        {l.pace === null
          ? 'темп неизвестен'
          : `темп ${l.pace.toFixed(1)} задачи/день`}
        {l.runwayDays !== null &&
          ` · работы на ~${Math.round(l.runwayDays)} раб. дн.`}
      </div>
      {l.weekly && weeks.length > 0 && (
        <div className="load-spark small muted">
          {l.weekly.some(Boolean) ? (
            <>
              <Sparkline values={l.weekly} weeks={weeks} /> закрыто по неделям
            </>
          ) : (
            `За ${weeks.length} недель закрытых задач нет`
          )}
        </div>
      )}
    </div>
  );
}

function FlowCard({ team }: { team: NonNullable<TeamView['team']> }) {
  const flow = team.flow;
  const releaseFree = team.unassigned.filter((i) => i.inScope).length;
  if (!flow)
    return (
      <section className="card">
        <h2>Темп команды</h2>
        <p className="muted">
          Недельная история появится после следующего обновления данных.
        </p>
      </section>
    );
  const full = (list: number[]) =>
    list
      .slice(0, -1)
      .slice(-4)
      .reduce((a, b) => a + b, 0);
  return (
    <section className="card">
      <h2>Темп команды</h2>
      <p className="small">
        За последние 4 полные недели закрыто <b>{full(flow.done)}</b>, пришло
        новых <b>{full(flow.created)}</b>.
        {team.unassigned.length > 0 &&
          ` Свободных задач без исполнителя: ${team.unassigned.length}${
            team.releaseVersion ? `, из них в релизе ${releaseFree}` : ''
          }.`}
      </p>
      {team.scopeGrowing && (
        <p className="warn-line small">
          Две недели подряд приходит больше задач, чем закрывается: объём растёт
          быстрее, чем команда успевает. Стоит обсудить, что отложить.
        </p>
      )}
      <TeamFlowChart flow={flow} />
      {flow.capped && (
        <p className="muted small">
          Список Jira упёрся в лимит: самые старые недели занижены.
        </p>
      )}
    </section>
  );
}

const KINDS: Array<{ id: ReviewKind; title: string; lead: string }> = [
  {
    id: 'meeting',
    title: 'Митинг',
    lead: 'Разбор по каждому: над чем работает, в ту ли сторону идёт и что посоветовать.',
  },
  {
    id: 'standup',
    title: 'Стендап',
    lead: 'Повестка на 5 минут: по строке на человека и три вещи, которые разблокировать сегодня.',
  },
  {
    id: 'retro',
    title: 'Ретро',
    lead: 'Итоги двух недель: что шло хорошо, где задачи ждали, вопросы команде и два эксперимента.',
  },
];

type Notes = { text: string; at: string } | null;

function MeetingCard({
  initial,
  onError,
}: {
  initial: Notes;
  onError: (e: unknown) => void;
}) {
  const [kind, setKind] = useState<ReviewKind>('meeting');
  const [notes, setNotes] = useState<Record<string, Notes>>({
    meeting: initial,
  });
  const [busy, setBusy] = useState(false);
  const current = notes[kind];
  const meta = KINDS.find((k) => k.id === kind) ?? KINDS[0];

  const pick = async (k: ReviewKind) => {
    setKind(k);
    if (notes[k] !== undefined) return;
    try {
      const n = await api.reviewLatest(k);
      setNotes((all) => ({ ...all, [k]: n }));
    } catch (e) {
      onError(e);
    }
  };

  const prepare = async () => {
    setBusy(true);
    try {
      const n = await api.teamReview(Boolean(current), kind);
      setNotes((all) => ({ ...all, [kind]: n }));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="review-head">
        <h2>Подготовка к встрече</h2>
        {current && <span className="muted small">от {when(current.at)}</span>}
      </div>
      <div className="tabs" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k.id}
            role="tab"
            aria-selected={k.id === kind}
            className={`tab${k.id === kind ? ' active' : ''}`}
            onClick={() => pick(k.id)}
          >
            {k.title}
          </button>
        ))}
      </div>
      {busy ? (
        <p className="muted">Модель готовит — это до 2 минут…</p>
      ) : current ? (
        <div className="review-text">{current.text}</div>
      ) : (
        <p className="muted">
          {meta.lead} Готовится моделью по данным ниже; сохраняется на день.
        </p>
      )}
      <div className="actions">
        <button onClick={prepare} disabled={busy}>
          {current ? 'Подготовить заново' : 'Подготовить'}
        </button>
      </div>
    </section>
  );
}

function OneOnOne({ name }: { name: string }) {
  const [notes, setNotes] = useState<Notes | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .reviewLatest('oneonone', name)
      .then(setNotes)
      .catch((e) => setError((e as Error).message));
  }, [name]);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      setNotes(await api.teamReview(Boolean(notes), 'oneonone', name));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="oneonone">
      <h3>Встреча один на один</h3>
      {error && <p className="error small">{error}</p>}
      {busy ? (
        <p className="muted small">Готовлю повестку — до 2 минут…</p>
      ) : notes ? (
        <>
          <p className="muted small">от {when(notes.at)}</p>
          <div className="review-text small">{notes.text}</div>
        </>
      ) : (
        <p className="muted small">
          Повестка: успехи, трудности как вопросы, тема для роста и вопрос о
          нагрузке. Без оценок и сравнений с другими.
        </p>
      )}
      <button className="ghost" onClick={prepare} disabled={busy}>
        {notes ? 'Подготовить заново' : 'Подготовить повестку'}
      </button>
    </div>
  );
}

function TelegramEditor({
  username,
  onSave,
}: {
  username: string | null;
  onSave: (u: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(username ?? '');
  if (!editing)
    return (
      <button className="link small" onClick={() => setEditing(true)}>
        {username ? `Telegram: @${username}` : 'Привязать Telegram'}
      </button>
    );
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave(value.trim() || null);
        setEditing(false);
      }}
    >
      <input
        value={value}
        placeholder="@username"
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit">OK</button>
      <button type="button" className="ghost" onClick={() => setEditing(false)}>
        Отмена
      </button>
    </form>
  );
}

function PersonCard({
  p,
  links,
  stale,
  weeks,
  telegram,
  onGithub,
  onAway,
  onTelegram,
}: {
  p: Person;
  links: Links | null;
  stale: number;
  weeks: string[];
  telegram: string | null;
  onGithub: (login: string | null) => Promise<void>;
  onTelegram: (username: string | null) => Promise<void>;
  onAway: (until: string | null, note: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [login, setLogin] = useState(p.github ?? '');
  const [nudge, setNudge] = useState<string | null>(null);
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
          <div>
            <TelegramEditor username={telegram} onSave={onTelegram} />
          </div>
          <div>
            <AwayEditor p={p} onAway={onAway} />
          </div>
        </div>
        <div className="chips">
          <span className="chip">В работе {p.inProgress.length}</span>
          <span className="chip">Очередь {p.queue.length}</span>
          <span className="chip">Закрыто 14 дн. {p.done14.length}</span>
          {p.github && <span className="chip">PR {p.pulls.length}</span>}
        </div>
      </header>

      <LoadRow p={p} weeks={weeks} />

      <ul className="signals">
        {p.signals.map((s, i) => (
          <SignalLine
            key={i}
            s={s}
            links={links}
            onSay={s.say ? () => setNudge(s.say ?? '') : undefined}
          />
        ))}
      </ul>
      {nudge !== null && (
        <NudgeForm person={p.name} text={nudge} onDone={() => setNudge(null)} />
      )}

      <button className="link" onClick={() => setOpen((v) => !v)}>
        {open ? 'Скрыть детали' : 'Показать, над чем работает'}
      </button>

      {open && (
        <div className="person-details">
          <OneOnOne name={p.name} />
          <h3>В работе</h3>
          {p.inProgress.length ? (
            <ul className="issues">
              {p.inProgress.map((i) => (
                <Issue key={i.key} i={i} links={links} stale={stale} />
              ))}
            </ul>
          ) : (
            <p className="muted">Ничего</p>
          )}
          <h3>Очередь</h3>
          {p.queue.length ? (
            <ul className="issues">
              {p.queue.slice(0, 8).map((i) => (
                <Issue key={i.key} i={i} links={links} stale={stale} />
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
                  <Key k={d.key} links={links} /> {d.summary}
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
                      <Key k={`${x.repo}#${x.number}`} links={links} />{' '}
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

export function TeamPage({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [view, setView] = useState<TeamView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyWarn, setOnlyWarn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refreshData = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const r = await api.refreshData();
      const failed = r.sources.filter((x) => !x.ok);
      if (failed.length)
        setError(
          `Не прочитались: ${failed
            .map((x) => `${x.source} (${x.error})`)
            .join(', ')}`,
        );
      setView(await api.team());
    } catch (e) {
      handle(e);
    } finally {
      setRefreshing(false);
    }
  };

  const handle = (e: unknown) => {
    if (e instanceof Unauthorized) onUnauthorized();
    else setError((e as Error).message);
  };

  useEffect(() => {
    setError(null);
    api.team().then(setView).catch(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      <MeetingCard initial={view.review} onError={handle} />

      {!team || !team.hasDetails ? (
        <section className="card">
          <h2>Данных по людям пока нет</h2>
          <p className="muted">
            {team
              ? `Последний снимок проекта (${when(
                  team.asOf,
                )}) собран до появления этой вкладки.`
              : 'Снимок проекта ещё не собран.'}{' '}
            Обновите данные — это займёт до минуты. Дальше они обновляются сами
            утром и в 08, 11 и 14 UTC.
          </p>
          <div className="actions">
            <button onClick={refreshData} disabled={refreshing}>
              {refreshing
                ? 'Собираю данные из Jira и GitHub…'
                : 'Обновить данные сейчас'}
            </button>
          </div>
        </section>
      ) : (
        <>
          <FlowCard team={team} />
          <div className="team-bar">
            <span className="muted small">
              Данные на {when(team.asOf)}
              {team.releaseVersion
                ? ` · релиз ${team.releaseVersion}`
                : ' · версия релиза не задана'}
              {team.capped ? ' · список Jira обрезан' : ''}
              {' · '}
              <button
                className="link small"
                onClick={refreshData}
                disabled={refreshing}
              >
                {refreshing ? 'обновляю…' : 'обновить сейчас'}
              </button>
            </span>
            <ThresholdsPanel
              key={JSON.stringify(team.thresholds)}
              value={team.thresholds}
              onSave={async (t) => {
                try {
                  await api.save({ teamThresholds: t });
                  setView(await api.team());
                } catch (e) {
                  handle(e);
                  throw e;
                }
              }}
            />
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
                links={team.links}
                stale={team.thresholds.staleDays}
                weeks={team.flow?.weeks ?? []}
                telegram={team.telegram?.[p.name] ?? null}
                onTelegram={async (username) => {
                  try {
                    setView(await api.setTelegram(p.name, username));
                  } catch (e) {
                    handle(e);
                  }
                }}
                onAway={async (until, note) => {
                  try {
                    setView(await api.setAway(p.name, until, note));
                  } catch (e) {
                    handle(e);
                  }
                }}
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
