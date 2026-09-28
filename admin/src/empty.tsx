import { useState } from 'react';
import { api, Unauthorized } from './api';

// One empty state for every page: what is missing and a button that fixes
// it right here, instead of sending the owner to another page
export function NoData({
  onDone,
  onUnauthorized,
  title = 'Данных ещё нет',
}: {
  onDone: () => void;
  onUnauthorized: () => void;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted">
        Для этой страницы у бота ещё нет данных из Jira и GitHub. Соберите их —
        это около минуты. Дальше они обновляются сами несколько раз в день.
      </p>
      {error && <p className="error small">{error}</p>}
      <div className="actions">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await api.refreshData();
              const failed = r.sources.filter((x) => !x.ok);
              const jira = r.sources.find((x) => x.source === 'issues');
              if (failed.length)
                setError(
                  `Не прочитались: ${failed
                    .map((x) => `${x.source} (${x.error})`)
                    .join(
                      ', ',
                    )}. Если ошибка повторяется — передайте её разработчику.`,
                );
              // Without Jira the page would come back empty again
              if (!jira || jira.ok) onDone();
            } catch (e) {
              if (e instanceof Unauthorized) onUnauthorized();
              else setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Собираю данные из Jira и GitHub…' : 'Собрать данные'}
        </button>
      </div>
    </section>
  );
}
