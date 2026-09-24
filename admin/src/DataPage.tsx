import { useEffect, useRef, useState } from 'react';
import { api, IndexSource, IndexStatus, Unauthorized } from './api';

const NAMES: Record<IndexSource, string> = {
  jira: 'Задачи (Jira)',
  confluence: 'Документация (Confluence)',
  figma: 'Дизайн (Figma)',
  github: 'Pull requests (GitHub)',
};
const WHAT: Record<IndexSource, string> = {
  jira: 'все задачи в любом статусе: описание, автор, исполнитель, комментарии',
  confluence: 'все страницы разрешённых пространств, кроме страниц с доступами',
  figma: 'фреймы всех файлов и все комментарии',
  github: 'последние 300 PR каждого репозитория с описанием',
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '—';

export function DataPage({
  refreshKey,
  onUnauthorized,
}: {
  refreshKey: number;
  onUnauthorized: () => void;
}) {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  const handle = (e: unknown) => {
    if (e instanceof Unauthorized) onUnauthorized();
    else setError((e as Error).message);
  };

  const load = () => api.indexStatus().then(setStatus).catch(handle);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Only leaving the page stops a running collection, not a refresh
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );

  // Each step runs up to ~3 minutes on the server; keep calling until done
  const collect = async () => {
    setRunning(true);
    setError(null);
    setMessage(null);
    stop.current = false;
    try {
      let job = await api.indexStart();
      while (job.status === 'running' && !stop.current) {
        setStatus((s) => (s ? { ...s, job } : s));
        job = await api.indexStep();
      }
      await load();
      if (job.status === 'failed') setError(`Сбор остановился: ${job.error}`);
      else if (job.status === 'done') setMessage('Готово: всё собрано.');
      else
        setMessage(
          'Сбор на паузе. Нажмите «Собрать всё», чтобы продолжить с того же места.',
        );
    } catch (e) {
      handle(e);
    } finally {
      setRunning(false);
    }
  };

  const refreshSnapshot = async () => {
    setRefreshing(true);
    setError(null);
    setMessage(null);
    try {
      const r = await api.refreshData();
      const failed = r.sources.filter((x) => !x.ok);
      setMessage(
        failed.length
          ? `Сводка обновлена, но не прочитались: ${failed
              .map((x) => x.source)
              .join(', ')}`
          : 'Сводка обновлена.',
      );
    } catch (e) {
      handle(e);
    } finally {
      setRefreshing(false);
    }
  };

  const job = status?.job;
  return (
    <>
      {error && <p className="error">{error}</p>}
      {message && <p className="ok">{message}</p>}

      <section className="card">
        <h2>Полный сбор</h2>
        <p className="muted">
          Бот копирует к себе всё по проекту и потом ищет по этой копии. Сбор
          только читает Jira, Confluence, GitHub и Figma — модель не вызывается,
          токены не тратятся. Ответы бота берут из копии лишь несколько
          найденных кусочков. Сбор идёт сам каждую ночь; кнопка — чтобы сейчас.
        </p>
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Источник</th>
                <th>Что собирается</th>
                <th>В копии</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(NAMES) as IndexSource[]).map((s) => {
                const on = status?.sources.includes(s);
                return (
                  <tr key={s}>
                    <td data-label="Источник">
                      <div className="cell">{NAMES[s]}</div>
                    </td>
                    <td data-label="Что собирается">
                      <div className="cell muted">
                        {on ? WHAT[s] : 'не настроен'}
                      </div>
                    </td>
                    <td data-label="В копии">
                      <div className="cell">
                        {status?.counts[s] ?? 0}
                        {running && job?.stage === s && (
                          <span className="muted"> · сейчас собирается</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          {job
            ? job.status === 'done'
              ? `Последний сбор: ${when(job.finishedAt)}`
              : job.status === 'failed'
              ? `Последний сбор остановился: ${job.error}`
              : `Идёт сбор с ${when(job.startedAt)}: ${
                  NAMES[job.stage as IndexSource] ?? ''
                }`
            : 'Ещё не собиралось.'}
        </p>
        <div className="actions">
          <button onClick={collect} disabled={running}>
            {running
              ? 'Собираю… можно не закрывать, займёт несколько минут'
              : 'Собрать всё'}
          </button>
          {running && (
            <button className="ghost" onClick={() => (stop.current = true)}>
              Пауза
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Сводка проекта</h2>
        <p className="muted">
          Короткая сводка, которую бот держит в каждом ответе: открытые задачи,
          PR, CI, изменения дизайна и выбранные страницы. Обновляется утром и в
          08, 11, 14 UTC.
        </p>
        <div className="actions">
          <button
            className="ghost"
            onClick={refreshSnapshot}
            disabled={refreshing}
          >
            {refreshing ? 'Обновляю…' : 'Обновить сводку сейчас'}
          </button>
        </div>
      </section>
    </>
  );
}
