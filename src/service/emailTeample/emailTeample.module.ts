import { Module } from '@nestjs/common';

import { EmailTemplateService } from './emailTeample.service';

@Module({
  providers: [EmailTemplateService],
  exports: [EmailTemplateService],
})
export class EmailTemplateModule {}
