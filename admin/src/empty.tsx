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
        Бот ещё не заглядывал в Jira и GitHub. Соберите данные — это около
        минуты. Дальше они обновляются сами несколько раз в день.
      </p>
      {error && <p className="error small">{error}</p>}
      <div className="actions">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.refreshData();
              onDone();
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
