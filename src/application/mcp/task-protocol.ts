import { randomBytes } from 'crypto';
import { MAX_TASK_ROUNDS, McpTask } from '@domain/mcp-task/mcp-task.entity';

// The texts that steer the calling IDE model through a task. They end every
// reply with the one next step, because a weak model follows the last
// instruction it sees and forgets the protocol after a long answer.

export const newTaskId = (): string => `t-${randomBytes(5).toString('hex')}`;

const reportCall = (id: string) =>
  `report_outcome { task_id: "${id}", status: "solved" | "not_solved" | ` +
  `"partial", details: "<what you changed, what you ran, what you saw>" }`;

export const checklistText = (task: McpTask): string =>
  task.checklist.map((c, i) => `${i + 1}. ${c}`).join('\n');

export const startedText = (task: McpTask, waiting: McpTask[]): string => {
  const lines = [
    `Task ${task.id} started: ${task.goal}`,
    '',
    'Collect this before asking (read the files, run the commands, open the docs):',
    checklistText(task),
    '',
    `NEXT STEP: gather the items above, then call ask_advice with task_id ` +
      `"${task.id}", your question in prompt and everything you gathered in ` +
      'context. Do not answer from memory.',
  ];
  if (waiting.length) {
    lines.push('', waitingText(waiting));
  }
  return lines.join('\n');
};

export const waitingText = (tasks: McpTask[]): string =>
  [
    'These tasks still wait for your report — call report_outcome for each:',
    ...tasks.map((t) => `- ${t.id}: ${t.goal}`),
  ].join('\n');

export const needInfoFooter = (task: McpTask): string =>
  [
    '---',
    `task_id: ${task.id} (round ${task.rounds} of ${MAX_TASK_ROUNDS})`,
    'NEXT STEP: collect exactly the items above, then call ask_advice again ' +
      `with task_id "${task.id}" and them in context.`,
  ].join('\n');

export const answerFooter = (task: McpTask): string =>
  [
    '---',
    `task_id: ${task.id} (round ${task.rounds} of ${MAX_TASK_ROUNDS})`,
    'NEXT STEP: apply the change, run the "How to verify" check, then call ' +
      `${reportCall(task.id)}. Do not finish without reporting, even if it ` +
      'did not work.',
  ].join('\n');

export const reportedText = (task: McpTask): string => {
  if (task.status === 'solved') {
    return `Task ${task.id} closed as solved. Thank you for reporting.`;
  }
  if (task.rounds >= MAX_TASK_ROUNDS) {
    return escalatedText(task);
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
    `Task ${task.id} used all ${MAX_TASK_ROUNDS} rounds and is closed as ` +
      'escalated. STOP trying fixes. Tell the user that this needs a person ' +
      'and give them this summary:',
    `Goal: ${task.goal}`,
    ...task.history.map(
      (h) => `- ${h.kind}${h.outcome ? ` (${h.outcome})` : ''}: ${h.note}`,
    ),
  ].join('\n');

export const closedText = (task: McpTask): string =>
  `Task ${task.id} is already closed (${task.status}). For a new problem ` +
  'call start_task.';

export const unknownText = (id: string): string =>
  `Unknown task_id "${id}" (tasks expire 30 days after the last call). ` +
  'Call start_task to open a new one.';
