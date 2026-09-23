import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';

type Check = {
  label: string;
  value: number | undefined;
  ok: (n: number) => boolean;
};

const mark = (c: Check): string => {
  if (c.value === undefined) return `❔ ${c.label}: нет данных`;
  return `${c.ok(c.value) ? '✅' : '❌'} ${c.label}: ${c.value}`;
};

// Gates computed from the snapshot's numbers. Missing numbers (a failed or
// capped source) show as "no data", never as a pass.
export const readinessChecklist = (
  snapshot: ProjectSnapshot,
  definitionOfDone: string | null,
): string => {
  const issues = snapshot.section('issues')?.metrics;
  const code = snapshot.section('code')?.metrics;
  const zero = (n: number) => n === 0;
  const checks: Check[] = [
    { label: 'Блокеры в объёме релиза', value: issues?.blockers, ok: zero },
    {
      label: 'Открытые баги высокого приоритета',
      value: issues?.openHighBugs,
      ok: zero,
    },
    {
      label: 'Задачи высокого приоритета без исполнителя',
      value: issues?.unassignedHigh,
      ok: zero,
    },
    { label: 'Красные пайплайны', value: code?.redPipelines, ok: zero },
    {
      label: 'Недоставленные коммиты между ветками (макс.)',
      value: code?.driftAhead,
      ok: zero,
    },
    {
      label: 'PR ждут ревью больше 2 дней',
      value: code?.waitingReview,
      ok: zero,
    },
  ];
  const failed = checks.filter(
    (c) => c.value !== undefined && !c.ok(c.value),
  ).length;
  const unknown = checks.filter((c) => c.value === undefined).length;
  const verdict = failed
    ? `НЕ ГОТОВ: ${failed} пункт(а) не выполнено`
    : unknown
    ? 'НЕТ ПОЛНЫХ ДАННЫХ'
    : 'ГОТОВ по данным';
  return [
    `Готовность релиза на ${snapshot.createdAt
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ')} UTC — ${verdict}`,
    `Открыто в объёме релиза: ${issues?.scope ?? '?'}`,
    ...checks.map(mark),
    '❔ Вопросы клиента без ответа: проверить через find_open_questions',
    ...(definitionOfDone
      ? [
          `Определение готовности команды (проверить вручную):\n${definitionOfDone.slice(
            0,
            2000,
          )}`,
        ]
      : []),
  ].join('\n');
};
