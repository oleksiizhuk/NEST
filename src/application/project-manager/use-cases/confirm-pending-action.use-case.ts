import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IPendingActions,
  PENDING_ACTIONS,
  PendingAction,
} from '@application/project-manager/pending-action.interface';
import {
  ADMIN_TARGETS,
  IAdminTargets,
} from '@application/project-manager/staging-admin.interface';

export class StagingHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// Deterministic: no model is involved in deciding whether an action runs.
@Injectable()
export class ConfirmPendingActionUseCase {
  private readonly logger = new Logger(ConfirmPendingActionUseCase.name);

  constructor(
    @Inject(PENDING_ACTIONS) private readonly actions: IPendingActions,
    @Inject(ADMIN_TARGETS) private readonly targets: IAdminTargets,
  ) {}

  // id null = the newest pending action in this chat (a bare "да")
  async confirm(
    id: string | null,
    chatId: number,
    userId: number,
    authorised: boolean,
    now = new Date(),
  ): Promise<string> {
    if (!authorised) return 'Нет прав на подтверждение действий.';
    const target =
      id ?? (await this.actions.latestPending(chatId, now))?.id ?? null;
    if (!target) return 'Нет действий, ожидающих подтверждения.';

    const action = await this.actions.claim(
      target.toUpperCase(),
      chatId,
      userId,
      now,
    );
    if (!action) {
      return `Действие ${target.toUpperCase()} не найдено, уже выполнено или истекло.`;
    }
    this.logger.log(
      `action ${action.id} ${action.kind} confirmed by ${userId}`,
    );
    return this.execute(action);
  }

  async cancel(
    id: string,
    chatId: number,
    authorised: boolean,
  ): Promise<string> {
    if (!authorised) return 'Нет прав на отмену действий.';
    return (await this.actions.cancel(id.toUpperCase(), chatId))
      ? `Действие ${id.toUpperCase()} отменено.`
      : `Действие ${id.toUpperCase()} не найдено или уже не ожидает.`;
  }

  private async execute(action: PendingAction): Promise<string> {
    // Proposals from before tiers existed were always staging
    const tier = action.payload.tier || 'staging';
    try {
      const admin = this.targets.target(tier);
      // Re-check right before writing: someone may have created it meanwhile
      const existing = (await admin.findBrands(action.payload.nameEn)).find(
        (b) =>
          b.name.trim().toLowerCase() === action.payload.nameEn.toLowerCase(),
      );
      if (existing) {
        const text = `Бренд "${existing.name}" уже есть на ${tier} (id ${existing.id}) — новый не создавал.`;
        await this.actions.finish(action.id, 'done', text);
        return text;
      }
      const brand = await admin.createBrand(action.payload);
      const text = `Готово: на ${tier} создан бренд "${brand.name}" (id ${
        brand.id
      }) с магазином в "${action.payload.mallName}"${
        brand.note ? ` — ${brand.note}` : ''
      }.`;
      await this.actions.finish(action.id, 'done', text);
      return text;
    } catch (error) {
      const known = error instanceof StagingHttpError && error.status < 500;
      const text = known
        ? `Не получилось: ${tier} ответил ${
            (error as StagingHttpError).status
          } — ${error.message.slice(0, 300)}`
        : `Результат неизвестен (таймаут или ошибка сервера). Проверьте на ${tier}, прежде чем повторять.`;
      try {
        await this.actions.finish(
          action.id,
          known ? 'failed' : 'unknown',
          `${text} [${String((error as Error).message).slice(0, 300)}]`,
        );
      } catch {
        // the reply still goes out; the audit row is best effort here
      }
      this.logger.error(
        `action ${action.id} failed: ${(error as Error).message}`,
      );
      return text;
    }
  }
}
