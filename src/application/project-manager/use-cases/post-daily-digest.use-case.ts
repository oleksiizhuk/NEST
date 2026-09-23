import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IPmConfig,
  PM_CONFIG,
} from '@application/project-manager/pm.config.interface';
import {
  IProjectManagerAiService,
  PM_AI_SERVICE,
} from '@application/project-manager/project-manager-ai.interface';
import {
  ITelegramGateway,
  TELEGRAM_GATEWAY,
} from '@application/telegram/telegram.gateway.interface';
import {
  IPmChatRegistry,
  PM_CHAT_REGISTRY,
} from '@application/project-manager/pm-chat-registry.interface';
import {
  IKnowledgeStore,
  PM_KNOWLEDGE,
} from '@application/project-manager/knowledge.interface';
import { renderKnowledge } from '@application/project-manager/use-cases/answer-project-question.use-case';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';
import { todayLine } from '@application/project-manager/release-clock';

export const DIGEST_REQUEST =
  'Write the daily status digest for the team chat, following the digest ' +
  'format in your instructions.';

@Injectable()
export class PostDailyDigestUseCase {
  private readonly logger = new Logger(PostDailyDigestUseCase.name);

  constructor(
    private readonly refresh: RefreshProjectSnapshotUseCase,
    @Inject(PM_AI_SERVICE) private readonly ai: IProjectManagerAiService,
    @Inject(TELEGRAM_GATEWAY) private readonly telegram: ITelegramGateway,
    @Inject(PM_CONFIG) private readonly config: IPmConfig,
    @Inject(PM_CHAT_REGISTRY) private readonly chats: IPmChatRegistry,
    @Inject(PM_KNOWLEDGE) private readonly knowledge: IKnowledgeStore,
  ) {}

  // Always rebuilds the snapshot first: the digest is the morning's source
  // of truth, and its prompt warms the cache for the questions that follow.
  async execute(now = new Date()): Promise<{ posted: boolean }> {
    // Refresh + digest share one function run; keep them inside its limit
    const deadline = Date.now() + 250_000;
    const snapshot = await this.refresh.execute(now);
    const targets = new Set(await this.chats.digestChats().catch(() => []));
    if (this.config.digestChatId !== null)
      targets.add(this.config.digestChatId);
    if (!targets.size) {
      this.logger.log('No digest chat configured; snapshot refreshed only');
      return { posted: false };
    }
    const text = await this.ai.digest({
      brief: this.config.projectBrief,
      knowledge: await renderKnowledge(this.knowledge),
      snapshot: snapshot.render(),
      question: `${todayLine(
        now,
        this.config.releaseDate,
      )}\n\n${DIGEST_REQUEST}`,
      deadline,
    });
    for (const chatId of targets) {
      // One unreachable chat (bot removed) must not stop the others
      try {
        await this.telegram.sendMessage(chatId, text);
      } catch (error) {
        this.logger.error(`digest to ${chatId}: ${error}`);
      }
    }
    return { posted: true };
  }
}
