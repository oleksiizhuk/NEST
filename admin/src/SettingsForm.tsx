import { useEffect, useState } from 'react';
import { api, Effort, Settings, SettingsView, Unauthorized } from './api';

type Key = keyof Settings;

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const FIELDS: Array<{
  key: Key;
  title: string;
  hint: string;
  kind: 'number' | 'usernames' | 'ids' | 'effort';
}> = [
  {
    key: 'dailyQuestionLimit',
    title: 'Вопросов в день на человека',
    hint: '0 — без лимита. Вас лимит не касается.',
    kind: 'number',
  },
  {
    key: 'unlimitedUsernames',
    title: 'Без лимита',
    hint: 'Ники Telegram без @, через запятую.',
    kind: 'usernames',
  },
  {
    key: 'dmUsernames',
    title: 'Могут писать боту в личку',
    hint: 'Ники Telegram без @, через запятую.',
    kind: 'usernames',
  },
  {
    key: 'actionUserIds',
    title: 'Могут подтверждать действия',
    hint: 'Числовые Telegram id, через запятую. Вы можете всегда.',
    kind: 'ids',
  },
  {
    key: 'alertChatIds',
    title: 'Получают уведомления и отчёт проверки',
    hint: 'Id чатов через запятую. Ваша личка — ваш Telegram id.',
    kind: 'ids',
  },
  {
    key: 'aiEffort',
    title: 'Усилие модели в чате',
    hint: 'Больше — глубже и дороже. Сводка не меняется.',
    kind: 'effort',
  },
];

const show = (value: unknown): string =>
  Array.isArray(value)
    ? value.join(', ') || '—'
    : value === null || value === undefined || value === ''
    ? '—'
    : String(value);

const toText = (value: unknown): string =>
  Array.isArray(value)
    ? value.join(', ')
    : value === null || value === undefined
    ? ''
    : String(value);

const split = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function SettingsForm({
  view,
  onSaved,
  onUnauthorized,
}: {
  view: SettingsView;
  onSaved: (view: SettingsView) => void;
  onUnauthorized: () => void;
}) {
  // Text per field; "" with no override = use the Vercel value
  const [draft, setDraft] = useState<Record<Key, string>>(
    {} as Record<Key, string>,
  );
  const [reset, setReset] = useState<Set<Key>>(new Set());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = {} as Record<Key, string>;
    for (const f of FIELDS) next[f.key] = toText(view.overrides[f.key]);
    setDraft(next);
    setReset(new Set());
  }, [view]);

  const changed = (key: Key) =>
    draft[key] !== toText(view.overrides[key]) || reset.has(key);

  const save = async () => {
    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) {
      if (!changed(f.key)) continue;
      const text = (draft[f.key] ?? '').trim();
      if (reset.has(f.key) || text === '') {
        patch[f.key] = null;
      } else if (f.kind === 'number') {
        patch[f.key] = Number(text);
      } else if (f.kind === 'effort') {
        patch[f.key] = text;
      } else if (f.kind === 'ids') {
        patch[f.key] = split(text).map(Number);
      } else {
        patch[f.key] = split(text);
      }
    }
    if (!Object.keys(patch).length) {
      setMessage('Нечего сохранять.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      onSaved(await api.save(patch));
      setMessage('Сохранено. Бот применит изменения в течение 30 секунд.');
    } catch (e) {
      if (e instanceof Unauthorized) onUnauthorized();
      else setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h2>Доступы и лимиты</h2>
      <p className="muted">
        Пустое поле — значение из Vercel. Изменения действуют без редеплоя.
        {view.updatedAt &&
          ` Последнее изменение: ${new Date(view.updatedAt).toLocaleString(
            'ru-RU',
          )}.`}
      </p>

      {FIELDS.map((f) => {
        const overridden =
          view.overrides[f.key] !== undefined && !reset.has(f.key);
        return (
          <div
            className={`field${changed(f.key) ? ' changed' : ''}`}
            key={f.key}
          >
            <label htmlFor={f.key}>{f.title}</label>
            {f.kind === 'effort' ? (
              <select
                id={f.key}
                value={reset.has(f.key) ? '' : draft[f.key] ?? ''}
                onChange={(e) => {
                  setReset((r) => new Set([...r].filter((k) => k !== f.key)));
                  setDraft({ ...draft, [f.key]: e.target.value });
                }}
              >
                <option value="">Из Vercel</option>
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={f.key}
                inputMode={f.kind === 'number' ? 'numeric' : undefined}
                value={reset.has(f.key) ? '' : draft[f.key] ?? ''}
                placeholder={show(view.defaults[f.key])}
                onChange={(e) => {
                  setReset((r) => new Set([...r].filter((k) => k !== f.key)));
                  setDraft({ ...draft, [f.key]: e.target.value });
                }}
              />
            )}
            <div className="field-foot">
              <span className="muted">
                {f.hint} Из Vercel: {show(view.defaults[f.key])}
              </span>
              {overridden && (
                <button
                  className="link"
                  onClick={() => setReset((r) => new Set(r).add(f.key))}
                >
                  Сбросить к Vercel
                </button>
              )}
            </div>
          </div>
        );
      })}

      <div className="actions">
        <button onClick={save} disabled={saving}>
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </button>
        {message && <span className="ok">{message}</span>}
        {error && <span className="error">{error}</span>}
      </div>
    </section>
  );
}
