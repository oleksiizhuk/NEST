import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  IPmMemory,
  memoryExpiry,
  PM_MEMORY,
} from '@application/project-manager/memory.interface';
import {
  IPendingActions,
  PENDING_ACTIONS,
  MemoryProposal,
  PendingAction,
} from '@application/project-manager/pending-action.interface';
import {
  ADMIN_TARGETS,
  BrandTarget,
  NewProperty,
  PropertyTarget,
  StoreEdit,
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
    @Optional()
    @Inject(PM_MEMORY)
    private readonly memory?: IPmMemory,
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
    if (!target) {
      return (
        'Нет действий, ожидающих подтверждения. Сначала попросите меня что-то сделать: ' +
        'я пришлю заявку с кнопкой «Подтвердить». Если я только что спросил «ок?», ответьте на вопрос текстом.'
      );
    }

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
    if (action.kind === 'remember') return this.remember(action);
    // Proposals from before tiers existed were always staging
    const tier = action.payload.tier || 'staging';
    try {
      const admin = this.targets.target(tier, action.payload.role ?? 'client');
      const text = await this.run(admin, tier, action);
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

  private async remember(action: PendingAction): Promise<string> {
    const p = action.payload as MemoryProposal;
    try {
      if (!this.memory) throw new Error('memory is not configured');
      const now = new Date();
      const dueAt = p.dueAt ? new Date(`${p.dueAt}T23:59:59Z`) : null;
      const saved = await this.memory.add({
        kind: p.kind,
        text: p.text,
        dueAt,
        expiresAt: memoryExpiry(p.kind, now, dueAt),
        author: p.author,
      });
      const text = `Запомнил (${saved.id}): ${saved.text}. Забыть: /forget ${saved.id}`;
      await this.actions.finish(action.id, 'done', text);
      return text;
    } catch (error) {
      const text = `Не получилось запомнить: ${(error as Error).message}`;
      await this.actions
        .finish(action.id, 'failed', text)
        .catch(() => undefined);
      return text;
    }
  }

  private run(
    admin: IStagingAdmin,
    tier: string,
    action: PendingAction,
  ): Promise<string> {
    switch (action.kind) {
      case 'create_brand':
        return this.createBrand(admin, tier, action.payload as NewBrand);
      case 'update_store':
        return this.updateStore(admin, tier, action.payload as StoreEdit);
      case 'create_property':
        return this.createProperty(admin, tier, action.payload as NewProperty);
      case 'publish_property':
      case 'unpublish_property':
        return this.changeProperty(
          admin,
          tier,
          action.kind,
          action.payload as PropertyTarget,
        );
      default:
        return this.changeBrand(
          admin,
          tier,
          action.kind,
          action.payload as BrandTarget,
        );
    }
  }

  private async updateStore(
    admin: IStagingAdmin,
    tier: string,
    edit: StoreEdit,
  ): Promise<string> {
    await admin.updateStore(edit.brandId, edit.storeId, edit.changes);
    return `Готово на ${tier}: магазин ${edit.storeLabel} бренда "${edit.brandName}" обновлён.`;
  }

  private async createProperty(
    admin: IStagingAdmin,
    tier: string,
    property: NewProperty,
  ): Promise<string> {
    const created = await admin.createProperty(property);
    return `Готово: на ${tier} создан ${property.type} "${created.name}" (id ${
      created.id
    })${created.note ? ` — ${created.note}` : ''}.`;
  }

  private async changeProperty(
    admin: IStagingAdmin,
    tier: string,
    kind: string,
    target: PropertyTarget,
  ): Promise<string> {
    const publish = kind === 'publish_property';
    const result = publish
      ? await admin.publishProperties([target.propertyId])
      : await admin.unpublishProperties([target.propertyId]);
    if (result.failed.length) {
      const missing = result.failed[0].missingFields;
      return `Не получилось ${
        publish ? 'опубликовать' : 'снять с публикации'
      } "${target.propertyName}" на ${tier}${
        missing.length ? `: не хватает ${missing.join(', ')}` : ''
      }.`;
    }
    return `Готово на ${tier}: "${target.propertyName}" ${
      publish ? 'опубликован' : 'снят с публикации'
    }.`;
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
