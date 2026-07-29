#!/usr/bin/env node
/*
 * Ask the bot to file a task without touching Jira.
 *
 * The real prompt, the real tool schemas and the real model run; only the task
 * tracker is stubbed, so you see exactly what would have been created.
 *
 *   npm run build
 *   node scripts/dry-run-task.js "створи таску: відклади заміну іконок"
 *
 * Reads ANTHROPIC_KEY from .env or the environment.
 */
// dotenv is not a dependency here — read .env directly
for (const line of require('fs')
  .readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8')
  .split('\n')) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const {
  AnthropicReplyService,
} = require('../dist/infrastructure/telegram/anthropic-reply.service');

const message = process.argv.slice(2).join(' ');
if (!message) {
  console.error('Usage: node scripts/dry-run-task.js "<повідомлення в чат>"');
  process.exit(1);
}
if (!process.env.ANTHROPIC_KEY) {
  console.error('ANTHROPIC_KEY is not set — put it in .env or pass it inline');
  process.exit(1);
}

const captured = [];
const stubTracker = {
  createTask: async (task) => {
    captured.push({ action: 'create', ...task });
    return { key: 'KAN-000', url: 'https://example.invalid/browse/KAN-000' };
  },
  updateTask: async (key, changes) => {
    captured.push({ action: 'update', key, ...changes });
    return { key, url: `https://example.invalid/browse/${key}` };
  },
  transitionTask: async (key, status) => {
    captured.push({ action: 'transition', key, status });
    return { key, url: `https://example.invalid/browse/${key}`, status };
  },
};

const config = { get: (key) => process.env[key] };

const line = (label) => `\n${'─'.repeat(60)}\n${label}\n${'─'.repeat(60)}`;

(async () => {
  const service = new AnthropicReplyService(config, stubTracker);
  const reply = await service.generateReply(`Dry run @dryrun: ${message}`);

  if (!captured.length) {
    console.log(line('ЖОДНОГО ІНСТРУМЕНТА НЕ ВИКЛИКАНО'));
    console.log('Бот вирішив відповісти текстом, не заводячи задачу.');
  }

  for (const call of captured) {
    console.log(line(`JIRA ${call.action.toUpperCase()} (нікуди не відправлено)`));
    for (const [field, value] of Object.entries(call)) {
      if (field === 'action') continue;
      console.log(`\n${field}:\n${value}`);
    }
  }

  console.log(line('ВІДПОВІДЬ У ЧАТ'));
  console.log(reply);
})().catch((error) => {
  console.error('Dry run failed:', error.message);
  process.exit(1);
});
