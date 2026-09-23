import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IPendingActions,
  PENDING_ACTIONS,
  PendingAction,
} from '@application/project-manager/pending-action.interface';
import {
  ADMIN_TARGETS,
  BrandTarget,
  IAdminTargets,
  IStagingAdmin,
  NewBrand,
  PublishResult,
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

  // Lets a bare "да" go to the model when there is nothing to confirm
  async hasPending(chatId: number, now = new Date()): Promise<boolean> {
    return Boolean(await this.actions.latestPending(chatId, now));
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
      const text =
        action.kind === 'create_brand'
          ? await this.createBrand(admin, tier, action.payload as NewBrand)
          : await this.changeBrand(
              admin,
              tier,
              action.kind,
              action.payload as BrandTarget,
            );
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

  private async createBrand(
    admin: IStagingAdmin,
    tier: string,
    payload: NewBrand,
  ): Promise<string> {
    // Re-check right before writing: someone may have created it meanwhile
    const existing = (await admin.findBrands(payload.nameEn)).find(
      (b) => b.name.trim().toLowerCase() === payload.nameEn.toLowerCase(),
    );
    if (existing) {
      return `Бренд "${existing.name}" уже есть на ${tier} (id ${existing.id}) — новый не создавал.`;
    }
    const brand = await admin.createBrand(payload);
    return `Готово: на ${tier} создан бренд "${brand.name}" (id ${
      brand.id
    }) с магазином в "${payload.mallName}"${
      brand.note ? ` — ${brand.note}` : ''
    }.`;
  }

  private async changeBrand(
    admin: IStagingAdmin,
    tier: string,
    kind: string,
    target: BrandTarget,
  ): Promise<string> {
    if (kind === 'delete_brand') {
      await admin.deleteBrand(target.brandId);
      return `Готово: бренд "${target.brandName}" удалён на ${tier}.`;
    }
    const brand = await admin.getBrand(target.brandId);
    const ids = brand.stores.map((s) => s.id);
    if (!ids.length)
      return `У бренда "${brand.name}" на ${tier} нет магазинов — нечего менять.`;
    const publish = kind === 'publish_brand';
    const result: PublishResult = publish
      ? await admin.publishStores(ids)
      : await admin.unpublishStores(ids);
    const verb = publish ? 'опубликовано' : 'снято с публикации';
    const failed = result.failed.length
      ? ` Не получилось для ${result.failed.length}: ${result.failed
          .map(
            (f) =>
              `${f.id}${
                f.missingFields.length
                  ? ` (не хватает: ${f.missingFields.join(', ')})`
                  : ''
              }`,
          )
          .join('; ')}.`
      : '';
    return `Готово на ${tier}: у бренда "${brand.name}" ${verb} магазинов: ${result.done.length} из ${ids.length}.${failed}`;
  }
}
