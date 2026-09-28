import {
  MAX_FAILED_ATTEMPTS,
  MAX_TASK_ROUNDS,
  McpTask,
} from '@domain/mcp-task/mcp-task.entity';

// The texts that steer the calling IDE model through a task. Every reply
// ends with the one next step, because a weak model follows the last
// instruction it sees and forgets the protocol after a long answer.
// Goals are quoted: they are the caller's words, shown back as data.

const reportCall = (id: string) =>
  `report_outcome { task_id: "${id}", status: "solved" | "not_solved" | ` +
  `"partial" | "abandoned", details: "<what you changed, what you ran, ` +
  `what you saw>" }`;

// The attempt that just failed was the last one allowed
const lastAttempt = (task: McpTask) => task.failures + 1 >= MAX_FAILED_ATTEMPTS;

const handOver = (task: McpTask) =>
  `NEXT STEP: no attempts are left. Call report_outcome with status ` +
  `"not_solved" or "partial" for task_id "${task.id}" and tell the user a ` +
  'person needs to take over.';

const round = (task: McpTask) =>
  `task_id: ${task.id} (round ${task.rounds} of ${MAX_TASK_ROUNDS})`;

export const checklistText = (task: McpTask): string =>
  task.checklist.map((c, i) => `${i + 1}. ${c}`).join('\n');

export const waitingText = (tasks: McpTask[]): string =>
  [
    'Your other open tasks without a report — call report_outcome for each ' +
      '("abandoned" if you dropped it):',
    ...tasks.map((t) => `- ${t.id}: "${t.goal}"`),
  ].join('\n');

// Tasks to remind about: an answer waiting for its report, or anything open
// and idle for over a day (a checklist nobody gathered)
export const needsReminder = (task: McpTask, now: Date): boolean =>
  task.awaitingReport || task.isStale(now);

// start_task, or ask_advice without a task and without material to work on
export const startedText = (
  task: McpTask,
  waiting: McpTask[],
  unanswered = false,
): string => {
  const lines = [
    `Task ${task.id} started: "${task.goal}"`,
    ...(unanswered
      ? [
          'Your question is not answered yet: there was no code or other ' +
            'material to ground the answer in.',
        ]
      : []),
    '',
    'Collect this first (read the files, run the commands, open the docs):',
    checklistText(task),
    '',
    'NEXT STEP: gather the items above, then call ask_advice with task_id ' +
      `"${task.id}", your question in prompt and everything you gathered in ` +
      'context. Do not answer from memory.',
  ];
  if (waiting.length) {
    lines.push('', waitingText(waiting));
  }
  return lines.join('\n');
};

export const needInfoFooter = (
  task: McpTask,
  waiting: McpTask[] = [],
): string =>
  [
    '---',
    round(task),
    task.onLastRound
      ? 'NEXT STEP: this was the last round. Call report_outcome with status ' +
        `"partial" or "not_solved" for task_id "${task.id}", listing what is ` +
        'still missing, and tell the user a person needs to take over.'
      : 'NEXT STEP: collect exactly the items above, then call ask_advice ' +
        `again with task_id "${task.id}" and them in context.`,
    ...(waiting.length ? ['', waitingText(waiting)] : []),
  ].join('\n');

export const answerFooter = (
  task: McpTask,
  unreported: boolean,
  waiting: McpTask[] = [],
): string =>
  [
    '---',
    round(task),
    ...(unreported
      ? [
          'You did not report on the previous answer. Say what happened with ' +
            'it in your next report.',
        ]
      : []),
    'NEXT STEP: apply the change, run the "How to verify" check, then call ' +
      `${reportCall(task.id)}. Report even if it did not work. If this was ` +
      'only a question with nothing to apply, report "solved" with details ' +
      '"answered".' +
      (task.onLastRound
        ? ' This was the last round: if it does not work, report ' +
          '"not_solved" and tell the user a person needs to take over.'
        : ''),
    ...(waiting.length ? ['', waitingText(waiting)] : []),
  ].join('\n');

// What a task's current state asks of the caller, when a write lost a race
export const currentStateText = (task: McpTask, now: Date): string => {
  if (!task.isOpen) return closedText(task);
  if (task.roundInFlight(now)) return inFlightText(task);
  if (task.awaitingReport) return reportFirstText(task);
  if (task.status === 'gathering') {
    return (
      `Task ${task.id} is waiting for material: collect what was asked ` +
      `for, then call ask_advice with task_id "${task.id}".`
    );
  }
  return reportedText(task);
};

export const noAnswerFooter = (task: McpTask): string =>
  [
    '---',
    `task_id: ${task.id} (not counted as a round; failed attempts ` +
      `${task.failures + 1} of ${MAX_FAILED_ATTEMPTS})`,
    lastAttempt(task)
      ? handOver(task)
      : 'NEXT STEP: narrow the question (one file, one problem) or send ' +
        `less context, then call ask_advice again with task_id "${task.id}".`,
  ].join('\n');

export const failedCallText = (task: McpTask): string =>
  'The advice call failed (the model service was busy or timed out); it ' +
  `counts as failed attempt ${task.failures + 1} of ${MAX_FAILED_ATTEMPTS}` +
  ', not as a round. ' +
  (lastAttempt(task)
    ? handOver(task)
    : `NEXT STEP: call ask_advice again with task_id "${task.id}" in a ` +
      'minute, or with a smaller context.');

export const reportedText = (task: McpTask): string => {
  if (task.status === 'solved' || task.status === 'abandoned') {
    return `Task ${task.id} closed as ${task.status}. Thank you for reporting.`;
  }
  return [
    `Recorded: ${task.status} (round ${task.rounds} of ${MAX_TASK_ROUNDS}).`,
    `NEXT STEP: call ask_advice with task_id "${task.id}". In context put ` +
      'the new error output or behaviour, the diff you applied and anything ' +
      'else that changed. The next answer will not repeat what did not work.',
  ].join('\n');
};

export const escalatedText = (task: McpTask): string =>
  [
    `Task ${task.id} used all its rounds (${MAX_TASK_ROUNDS}) or failed ` +
      `attempts (${MAX_FAILED_ATTEMPTS}) and is closed as escalated. ` +
      'STOP trying fixes. Tell the user that this needs a person ' +
      'and give them this summary:',
    `Goal: "${task.goal}"`,
    ...task.history.map(
      (h) => `- ${h.kind}${h.outcome ? ` (${h.outcome})` : ''}: ${h.note}`,
    ),
    `If it gets solved later, call report_outcome with status "solved" for ` +
      `task_id "${task.id}".`,
  ].join('\n');

export const reportInFlightText = (task: McpTask): string =>
  `A round of task ${task.id} is still running. Wait for its answer, then ` +
  'report on that answer with report_outcome.';

export const inFlightText = (task: McpTask): string =>
  `A round of task ${task.id} is still running. Wait for its answer, apply ` +
  'it and call report_outcome; do not ask again in parallel.';

export const reportFirstText = (task: McpTask): string =>
  `Task ${task.id} ` +
  (task.onLastRound
    ? `has used all ${MAX_TASK_ROUNDS} rounds`
    : task.outOfAttempts
    ? `has had ${MAX_FAILED_ATTEMPTS} failed attempts`
    : 'is waiting for your report on its last answer') +
  `. First apply the last answer and call ${reportCall(task.id)}.`;

export const closedText = (task: McpTask): string =>
  `Task ${task.id} is already closed (${task.status}). For a new problem ` +
  'call start_task.';

export const unknownText = (id: string): string =>
  `Unknown task_id "${id}" (tasks expire 30 days after the last call). ` +
  'Call start_task to open a new one.';
