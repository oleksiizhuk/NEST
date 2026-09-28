import { createContext, useContext, useState } from 'react';
import { Signal } from './api';
import { RULES } from './signals';

// Opens a topic with the bot about what is on the screen. Provided by App;
// null outside it, and the buttons then hide themselves
export type OpenTopic = (title: string, context: string) => Promise<void>;
export const AskContext = createContext<OpenTopic | null>(null);

// What the bot is told about a signal: the rule, the numbers and the tip
export const signalContext = (s: Signal, person?: string): string =>
  [
    person && `Человек: ${person}`,
    `Сигнал: ${RULES[s.rule]?.title ?? s.rule} (правило ${s.rule}, уровень ${
      s.level
    })`,
    `Текст: ${s.text}`,
    s.why && `Данные: ${s.why}`,
    s.keys.length > 0 && `Задачи и PR: ${s.keys.join(', ')}`,
    RULES[s.rule]?.hint && `Совет на странице: ${RULES[s.rule].hint}`,
    s.say && `Предложенная фраза: «${s.say}»`,
  ]
    .filter(Boolean)
    .join('\n');

// Everything the page shows, as text, so "почему так?" has the numbers
export const pageContext = (title: string): string => {
  const main = document.querySelector('main.content') as HTMLElement | null;
  const text = (main?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim();
  return `Раздел админки «${title}».\n\n${text}`.slice(0, 8_000);
};

export function AskButton({
  title,
  context,
  label = 'спросить бота',
  className = 'link small',
}: {
  title: string;
  // Read when pressed, so the latest page text goes along
  context: () => string;
  label?: string;
  className?: string;
}) {
  const open = useContext(AskContext);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return (
    <button
      className={className}
      disabled={busy}
      title="Откроет тему в «Спросить бота»; вопрос вы зададите сами"
      onClick={async () => {
        setBusy(true);
        try {
          await open(title, context());
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </button>
  );
}
