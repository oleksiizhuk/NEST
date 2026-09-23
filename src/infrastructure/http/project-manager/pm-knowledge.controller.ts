import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CronSecretGuard } from '@infrastructure/http/project-manager/cron-secret.guard';
import {
  IKnowledgeStore,
  PM_KNOWLEDGE,
} from '@application/project-manager/knowledge.interface';

const KEY = /^[a-z0-9][a-z0-9:_-]{1,60}$/;
// Inline docs stay small; ref:* docs are only read on demand, so they may
// be larger
const MAX_INLINE_DOC = 20_000;

export class KnowledgeBody {
  @IsString()
  @MinLength(1)
  @MaxLength(60_000)
  text: string;
}

// Owner-only (CRON_SECRET) upload of reference text such as codebase maps.
// Listing shows sizes, never the text.
@ApiExcludeController()
@UseGuards(CronSecretGuard)
@Controller('cron/pm/knowledge')
export class PmKnowledgeController {
  constructor(@Inject(PM_KNOWLEDGE) private readonly store: IKnowledgeStore) {}

  @Get()
  async list() {
    return (await this.store.all()).map((d) => ({
      key: d.key,
      chars: d.text.length,
      updatedAt: d.updatedAt,
    }));
  }

  @Put(':key')
  async put(@Param('key') key: string, @Body() body: KnowledgeBody) {
    if (!KEY.test(key)) throw new BadRequestException('bad key');
    if (!key.startsWith('ref:') && body.text.length > MAX_INLINE_DOC) {
      throw new BadRequestException(
        `docs are limited to ${MAX_INLINE_DOC} chars; use a ref: key for longer ones`,
      );
    }
    await this.store.upsert(key, body.text);
    return { key, chars: body.text.length };
  }

  @Delete(':key')
  async remove(@Param('key') key: string) {
    if (!KEY.test(key)) throw new BadRequestException('bad key');
    await this.store.remove(key);
    return { key, removed: true };
  }
}
