import { Usage } from './api';

const fmt = (n: number) => n.toLocaleString('ru-RU');

export function UsagePanel({ usage }: { usage: Usage }) {
  const { feedback } = usage;
  return (
    <section className="card">
      <h2>Сегодня ({usage.day}, UTC)</h2>
      <div className="stats">
        <div>
          <span className="stat">{fmt(feedback.answers)}</span>
          <span className="label">ответов с учётом (последние 100)</span>
        </div>
        <div>
          <span className="stat">
            👍 {feedback.up} · 👎 {feedback.down}
          </span>
          <span className="label">оценки</span>
        </div>
        <div>
          <span className="stat">{feedback.avgSeconds.toFixed(1)} с</span>
          <span className="label">среднее время ответа</span>
        </div>
        <div>
          <span className="stat">{fmt(feedback.avgOutputTokens)}</span>
          <span className="label">выходных токенов в среднем</span>
        </div>
        <div>
          <span className="stat">{fmt(feedback.avgCacheReadTokens)}</span>
          <span className="label">токенов из кэша в среднем</span>
        </div>
      </div>

      <h3>Вопросы по людям</h3>
      {usage.questions.length ? (
        <table>
          <thead>
            <tr>
              <th>Кто</th>
              <th>Вопросов</th>
            </tr>
          </thead>
          <tbody>
            {usage.questions.map((q) => (
              <tr key={q.userId}>
                <td>{q.username ? `@${q.username}` : `id ${q.userId}`}</td>
                <td>
                  {q.count}
                  {usage.limit ? ` из ${usage.limit}` : ''}
                  {usage.limit && q.count > usage.limit
                    ? ' · упёрся в лимит'
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">
          Сегодня никто с лимитом не спрашивал. Вы и люди без лимита здесь не
          считаются.
        </p>
      )}

      {feedback.disliked.length > 0 && (
        <>
          <h3>Ответы с 👎</h3>
          <ul className="list">
            {feedback.disliked.map((d, i) => (
              <li key={i}>
                <span className="muted">
                  {new Date(d.at).toLocaleString('ru-RU')}
                </span>{' '}
                {d.question}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
