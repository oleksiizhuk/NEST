import { useState } from 'react';

const KEY = 'pm-admin-guide-hidden';

const hidden = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

// The first-visit guide on Сегодня; «Как пользоваться» in the menu brings
// it back
export function showGuide() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // private mode: it shows anyway
  }
}

export function Guide({ force = false }: { force?: boolean }) {
  const [open, setOpen] = useState(force || !hidden());
  if (!open) return null;
  return (
    <section className="card guide">
      <h2>Как здесь всё устроено</h2>
      <p>
        Бот каждый день читает Jira (задачи), GitHub (код) и Figma (дизайн) и
        подсказывает, где команде нужна ваша помощь. В этих системах он ничего
        не меняет.
      </p>
      <ol>
        <li>
          <b>Каждое утро открывайте «Сегодня»</b> — 3–5 дел: кто, что случилось
          и готовая фраза, что сказать человеку.
        </li>
        <li>
          <b>Перед встречей — «Сотрудники».</b> По каждому видно, над чем
          работает и всё ли в порядке; кнопка «Подготовить 1:1» соберёт повестку
          разговора.
        </li>
        <li>
          <b>«Релиз»</b> — успеваем ли к дате выпуска и что можно отложить.
        </li>
        <li>
          <b>Настройте один раз:</b> отметьте отпуска и привяжите Telegram людей
          на «Сотрудниках» (чтобы бот мог их упоминать), включите бота в группе
          команды на «Чатах».
        </li>
      </ol>
      <p className="muted small">
        «Зависшие», «Поток» и «Качество» — для разбора раз в неделю–месяц.
        Непонятное слово? Нажмите «почему?» рядом с замечанием — там написано,
        откуда цифра и что обычно делают. Кнопки с пометкой ⚡ обращаются к
        модели и тратят токены — перед ними появится окно подтверждения.
      </p>
      <div className="actions">
        <button
          onClick={() => {
            try {
              localStorage.setItem(KEY, '1');
            } catch {
              // the card just closes for this visit
            }
            setOpen(false);
          }}
        >
          Понятно, скрыть
        </button>
      </div>
    </section>
  );
}
