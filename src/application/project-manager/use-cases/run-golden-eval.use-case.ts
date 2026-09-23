import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  GoldenCase,
  GoldenResult,
  IGoldenStore,
  PM_GOLDEN,
} from '@application/project-manager/golden.interface';
import {
  IPmConfig,
  PM_CONFIG,
} from '@application/project-manager/pm.config.interface';
import {
  ITelegramGateway,
  TELEGRAM_GATEWAY,
} from '@application/telegram/telegram.gateway.interface';
import {
  IAlertLog,
  PM_ALERT_LOG,
} from '@application/project-manager/alert-log.interface';
import { AnswerProjectQuestionUseCase } from '@application/project-manager/use-cases/answer-project-question.use-case';

const DAY_MS = 86_400_000;
// Inside the 300 s function limit, with room to save and report
const RUN_BUDGET_MS = 230_000;
const MARGIN_MS = 10_000;

// "/pattern/flags" is a regex; anything else is a case-insensitive substring
const matches = (answer: string, rule: string): boolean => {
  const re = rule.match(/^\/(.+)\/([a-z]*)$/);
  if (re) {
    try {
      return new RegExp(re[1], re[2]).test(answer);
    } catch {
      return false;
    }
  }
  return answer.toLowerCase().includes(rule.toLowerCase());
};

export const checkAnswer = (
  c: Pick<GoldenCase, 'mustContain' | 'mustNotContain' | 'maxSeconds'>,
  answer: string,
  seconds: number,
): string[] => [
  ...c.mustContain
    .filter((rule) => !matches(answer, rule))
    .map((rule) => `missing: ${rule}`),
  ...c.mustNotContain
    .filter((rule) => matches(answer, rule))
    .map((rule) => `should not contain: ${rule}`),
  ...(seconds > c.maxSeconds
    ? [`slow: ${Math.round(seconds)}s > ${c.maxSeconds}s`]
    : []),
];

// ISO week label, so the report goes out once a week
const weekOf = (d: Date): string => {
  const t = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  );
  return `${t.getUTCFullYear()}-W${week}`;
};

// Runs the golden questions through the real answer pipeline (chat 0:
// nothing is posted, proposals can never be confirmed), a few per call
// within the time limit, and reports to the alert chats when all are done.
@Injectable()
export class RunGoldenEvalUseCase {
  private readonly logger = new Logger(RunGoldenEvalUseCase.name);

  constructor(
    @Inject(PM_GOLDEN) private readonly golden: IGoldenStore,
    private readonly answer: AnswerProjectQuestionUseCase,
    @Inject(TELEGRAM_GATEWAY) private readonly telegram: ITelegramGateway,
    @Inject(PM_CONFIG) private readonly config: IPmConfig,
    @Inject(PM_ALERT_LOG) private readonly alerts: IAlertLog,
  ) {}

  async execute(
    now = new Date(),
    budgetMs = RUN_BUDGET_MS,
  ): Promise<{ ran: string[]; remaining: number; reported: boolean }> {
    const started = Date.now();
    const cases = await this.golden.all();
    // Due = not run yet this ISO week; the week's slots share the work
    const week = weekOf(now);
    const due = cases
      .filter((c) => !c.last || weekOf(c.last.at) !== week)
      .sort(
        (a, b) => (a.last?.at.getTime() ?? 0) - (b.last?.at.getTime() ?? 0),
      );
    const ran: string[] = [];
    for (const c of due) {
      const left = started + budgetMs - Date.now();
      // A shorter case later in the list may still fit
      if (left < c.maxSeconds * 1000 + MARGIN_MS) continue;
      const t0 = Date.now();
      let result: GoldenResult;
      try {
        const answer = await this.answer.execute(
          `eval: ${c.question}`,
          [],
          { chatId: 0, requesterId: 0 },
          new Date(),
          Date.now() + Math.min(left - MARGIN_MS, 240_000),
        );
        const seconds = (Date.now() - t0) / 1000;
        const failures = checkAnswer(c, answer.text, seconds);
        result = {
          at: now,
          pass: !failures.length,
          seconds,
          failures,
          answer: answer.text.slice(0, 2000),
        };
      } catch (error) {
        result = {
          at: now,
          pass: false,
          seconds: (Date.now() - t0) / 1000,
          failures: [
            `error: ${String((error as Error)?.message ?? error).slice(
              0,
              200,
            )}`,
          ],
          answer: '',
        };
      }
      await this.golden.saveResult(c.id, result);
      ran.push(c.id);
    }
    const remaining = due.length - ran.length;
    const reported =
      remaining === 0 && cases.length > 0 ? await this.report(now) : false;
    return { ran, remaining, reported };
  }

  private async report(now: Date): Promise<boolean> {
    const cases = await this.golden.all();
    const failed = cases.filter((c) => c.last && !c.last.pass);
    const passed = cases.filter((c) => c.last?.pass).length;
    const text = [
      `🧪 Проверка бота на эталонных вопросах: ${passed}/${cases.length} пройдено`,
      ...failed.map(
        (c) =>
          `❌ ${c.id}: ${c.last?.failures.join('; ')}\n   «${c.question.slice(
            0,
            120,
          )}»`,
      ),
    ].join('\n');
    let sent = false;
    const key = `eval:${weekOf(now)}`;
    for (const chatId of this.config.alertChatIds ?? []) {
      if (!(await this.alerts.claim(chatId, key, now))) continue;
      try {
        await this.telegram.sendMessage(chatId, text);
        sent = true;
      } catch (error) {
        this.logger.error(`eval report to ${chatId}: ${error}`);
        await this.alerts.release(chatId, [key]).catch(() => undefined);
      }
    }
    return sent;
  }
}
