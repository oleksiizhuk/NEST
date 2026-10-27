import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  IProjectSnapshotRepository,
  PROJECT_SNAPSHOT_REPOSITORY,
} from '@domain/project-status/project-snapshot.repository.interface';
import {
  IPmConfig,
  PM_CONFIG,
} from '@application/project-manager/pm.config.interface';
import {
  IProjectManagerAiService,
  PM_AI_SERVICE,
  PM_UNAVAILABLE_REPLY,
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
import { loadKnowledge } from '@application/project-manager/knowledge-loader';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';
import { todayLine } from '@application/project-manager/release-clock';
import { PmRuntimeConfig } from '@application/project-manager/pm-runtime-config';
import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import {
  buildRoster,
  rosterBlock,
  tagPeople,
} from '@application/project-manager/team-roster';
import { personalView } from '@application/project-manager/person-scope';
import {
  IProposalStore,
  PM_PROPOSALS,
  proposalButtons,
  proposalText,
  QUIET_WINDOW_DAYS,
  quietFingerprints,
  renderProposalFeedback,
  takeProposals,
} from '@application/project-manager/proposals.interface';

export const DIGEST_REQUEST =
  'Write the daily status digest for the team chat, following the digest ' +
  'format in your instructions.';

// Personal mode: one person's morning, and up to three ways to unblock it
export const personalDigestRequest = (name: string): string =>
  `Write the morning brief for ${name} alone, in a private chat, instead of ` +
  'the team digest. Only their work: leave out everything that does not ' +
  'touch it. Short sections:\n' +
  '1. Today: their tickets in the order to do them, each with why (release, ' +
  'someone waiting, overdue).\n' +
  '2. Blocked: for each blocked or waiting ticket, what stops it (backend, ' +
  'design, a client answer, review, QA, a build, unclear requirements), the ' +
  'evidence (status and since when, link, PR) and who can unblock it.\n' +
  '3. Waiting on them: people, reviews and questions waiting for their ' +
  'answer.\n' +
  '4. One line on the release or the team, only if it changes their day.\n' +
  'No @-mentions. Then, as the very last thing, a fenced ```proposals block ' +
  'with a JSON array of up to 3 proposals that would unblock them faster, ' +
  'most valuable first: {"keys":["KEY-1"],"kind":"backend|design|client|' +
  'review|qa|build|requirements|other","blocker":"what is in the way, one ' +
  'sentence","step":"the concrete step they can take today","ask":"who to ' +
  'ask, or null","draft":"a short ready-to-send message to that person, or ' +
  'null"}. Propose only what the data supports; an empty array is fine. ' +
  'Never propose what <past_proposals> says not to, and lean towards the ' +
  'kind of steps they took.';

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
    // Remembers each digest so the next one can say what changed since
    @Optional()
    @Inject(PROJECT_SNAPSHOT_REPOSITORY)
    private readonly snapshots?: IProjectSnapshotRepository,
    // Roles and Telegram usernames from the Сотрудники page
    @Optional() private readonly runtime?: PmRuntimeConfig,
    // Personal mode: proposals and their ratings
    @Optional()
    @Inject(PM_PROPOSALS)
    private readonly proposals?: IProposalStore,
  ) {}

  // Always rebuilds the snapshot first: the digest is the morning's source
  // of truth, and its prompt warms the cache for the questions that follow.
  async execute(now = new Date()): Promise<{ posted: boolean }> {
    // Refresh + digest share one function run; keep them inside its limit
    const deadline = Date.now() + 250_000;
    const snapshot = await this.refresh.execute(now);
    const live = await this.runtime?.current().catch(() => null);
    const focus = live?.focusPerson?.trim() || null;
    if (focus)
      return this.personal(snapshot, focus, live ?? null, now, deadline);
    const targets = new Set(await this.chats.digestChats().catch(() => []));
    if (this.config.digestChatId !== null)
      targets.add(this.config.digestChatId);
    if (!targets.size) {
      this.logger.log('No digest chat configured; snapshot refreshed only');
      return { posted: false };
    }
    const previous = await this.snapshots
      ?.findLastDigest(snapshot.createdAt)
      .catch(() => null);
    const knowledge = await loadKnowledge(
      this.knowledge,
      this.config.knowledgeInlineChars,
    );
    const roster = buildRoster(
      live?.telegramUsernames ?? this.config.telegramUsernames,
      live?.teamRoles ?? this.config.teamRoles,
    );
    const team = rosterBlock(roster);
    const written = await this.ai.digest({
      history: previous
        ? [
            {
              userText: `(${previous.createdAt
                .toISOString()
                .slice(0, 10)}) ${DIGEST_REQUEST}`,
              botResponse: previous.text,
            },
          ]
        : [],
      brief: knowledge.brief ?? this.config.projectBrief,
      knowledge: knowledge.text,
      snapshot: snapshot.render(),
      question: `${todayLine(
        now,
        this.config.releaseDate,
      )}\n\n${DIGEST_REQUEST}${team ? `\n\n${team}` : ''}`,
      deadline,
    });
    // Only the people on the roster are @-mentioned, never a guessed handle
    const text =
      written === PM_UNAVAILABLE_REPLY ? written : tagPeople(written, roster);
    let delivered = 0;
    for (const chatId of targets) {
      // One unreachable chat (bot removed) must not stop the others
      try {
        await this.telegram.sendMessage(chatId, text);
        delivered += 1;
      } catch (error) {
        this.logger.error(`digest to ${chatId}: ${error}`);
      }
    }
    // Tomorrow's digest builds on this one: keep it only if it is a real
    // digest that someone actually received
    if (delivered && text !== PM_UNAVAILABLE_REPLY) {
      await this.snapshots
        ?.saveDigest(snapshot.id, text)
        .catch((error) => this.logger.error(`digest not saved: ${error}`));
    }
    return { posted: true };
  }

  // Personal mode: only the owner's private chat, only that person's work.
  // A group the bot was removed from never costs a model call again.
  private async personal(
    snapshot: ProjectSnapshot,
    focus: string,
    live: IPmConfig | null,
    now: Date,
    deadline: number,
  ): Promise<{ posted: boolean }> {
    const ownerId = this.config.ownerId;
    if (!ownerId) {
      this.logger.log('Personal mode without TELEGRAM_OWNER_ID; no digest');
      return { posted: false };
    }
    const [previous, knowledge, recent] = await Promise.all([
      this.snapshots?.findLastDigest(snapshot.createdAt).catch(() => null),
      loadKnowledge(this.knowledge, this.config.knowledgeInlineChars),
      this.proposals
        ?.recent(new Date(now.getTime() - QUIET_WINDOW_DAYS * 86_400_000), 200)
        .catch(() => []) ?? Promise.resolve([]),
    ]);
    const feedback = renderProposalFeedback(recent, now);
    const request = personalDigestRequest(focus);
    const written = await this.ai.digest({
      history: previous
        ? [
            {
              userText: `(${previous.createdAt
                .toISOString()
                .slice(0, 10)}) ${request}`,
              botResponse: previous.text,
            },
          ]
        : [],
      brief: knowledge.brief ?? this.config.projectBrief,
      knowledge: knowledge.text,
      snapshot: snapshot.render(
        personalView(snapshot, {
          name: focus,
          githubLogin: live?.githubLogins?.[focus] ?? null,
        }),
      ),
      question: `${todayLine(now, this.config.releaseDate)}\n\n${request}${
        feedback ? `\n\n${feedback}` : ''
      }`,
      deadline,
    });
    if (written === PM_UNAVAILABLE_REPLY) {
      await this.telegram.sendMessage(ownerId, written).catch(() => undefined);
      return { posted: false };
    }
    const { text, proposals } = takeProposals(
      written,
      quietFingerprints(recent, now),
    );
    try {
      await this.telegram.sendMessage(ownerId, text);
    } catch (error) {
      this.logger.error(`personal digest: ${error}`);
      return { posted: false };
    }
    await this.snapshots
      ?.saveDigest(snapshot.id, text)
      .catch((error) => this.logger.error(`digest not saved: ${error}`));
    const saved =
      (await this.proposals?.add(proposals, now).catch((error) => {
        this.logger.error(`proposals not saved: ${error}`);
        return [];
      })) ?? [];
    for (const p of saved) {
      await this.telegram
        .sendWithButtons(ownerId, proposalText(p), proposalButtons(p))
        .catch((error) => this.logger.error(`proposal ${p.id}: ${error}`));
    }
    return { posted: true };
  }
}
