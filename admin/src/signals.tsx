import { useState } from 'react';
import { Links, Signal, SignalRule } from './api';

// What each signal means and what a lead usually does about it, so the
// numbers teach as well as warn
export const RULES: Record<SignalRule, { title: string; hint: string }> = {
  wip: {
    title: 'Много задач сразу',
    hint: 'Попросите довести до конца одну-две, остальные вернуть в очередь. Параллельная работа растягивает всё.',
  },
  stale: {
    title: 'Задача застряла',
    hint: 'Спросите, что мешает: непонятное требование, ждёт кого-то, сложнее, чем думали. Предложите помощь или разбить задачу.',
  },
  'off-release': {
    title: 'Работа не по релизу',
    hint: 'Если релизные задачи ждут, переключите человека на них; остальное отложите после релиза.',
  },
  priority: {
    title: 'Приоритетнее ждёт',
    hint: 'Уточните, почему не взята более важная задача; обычно стоит переключиться.',
  },
  overdue: {
    title: 'Просрочено',
    hint: 'Договоритесь о новой реальной дате и обновите срок в Jira, чтобы прогноз не врал.',
  },
  blocked: {
    title: 'Заблокировано',
    hint: 'Найдите, кто может снять блок, и договоритесь о сроке. Это самое дорогое ожидание.',
  },
  idle: {
    title: 'Нечего делать',
    hint: 'Помогите выбрать следующую задачу из очереди, лучше релизную и приоритетную.',
  },
  'no-output': {
    title: 'Нет результата 14 дней',
    hint: 'Не повод для выводов: спросите, как дела, возможно, задача большая или человек помогает другим.',
  },
  'pr-wait': {
    title: 'PR ждёт ревью',
    hint: 'Назначьте ревьюера. Долгое ревью тормозит автора и копит конфликты.',
  },
  changes: {
    title: 'Попросили правки',
    hint: 'Обычно ничего делать не нужно; следите, чтобы правки не висели дольше пары дней.',
  },
  away: {
    title: 'Отсутствует',
    hint: 'Сигналы по задачам не считаются, пока человека нет.',
  },
  handover: {
    title: 'Передать на время отсутствия',
    hint: 'Релизные задачи не должны ждать отпуска: передайте их или договоритесь, кто подстрахует.',
  },
  ok: { title: 'По плану', hint: '' },
};

// A ticket or PR key as a link when the site is known
export function Key({ k, links }: { k: string; links: Links | null }) {
  const pr = k.match(/^(.+)#(\d+)$/);
  const href = pr
    ? links?.githubOrg
      ? `https://github.com/${links.githubOrg}/${pr[1]}/pull/${pr[2]}`
      : null
    : links?.jira
    ? `${links.jira}/browse/${k}`
    : null;
  return href ? (
    <a className="key" href={href} target="_blank" rel="noreferrer">
      {k}
    </a>
  ) : (
    <span className="key">{k}</span>
  );
}

export function SignalLine({ s, links }: { s: Signal; links: Links | null }) {
  const [open, setOpen] = useState(false);
  const help = RULES[s.rule];
  const more = Boolean(s.why || help?.hint || s.keys.length);
  return (
    <li className={s.level}>
      {s.text}
      {more && s.level !== 'ok' && (
        <button
          className="link small why-btn"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'скрыть' : 'почему?'}
        </button>
      )}
      {open && (
        <div className="why">
          {s.why && (
            <div>
              <b>Данные:</b> {s.why}
            </div>
          )}
          {s.keys.length > 0 && (
            <div>
              <b>Ссылки:</b>{' '}
              {s.keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && ', '}
                  <Key k={k} links={links} />
                </span>
              ))}
            </div>
          )}
          {help?.hint && (
            <div>
              <b>Что обычно делают:</b> {help.hint}
            </div>
          )}
          {s.say && (
            <div>
              <b>Можно сказать:</b> «{s.say}»
            </div>
          )}
        </div>
      )}
    </li>
  );
}
