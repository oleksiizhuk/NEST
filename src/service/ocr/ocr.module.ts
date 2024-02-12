import { Module } from '@nestjs/common';

import { OcrService } from './ocr.service';

@Module({
  providers: [OcrService],
  exports: [OcrService], // This makes OcrService available for import in other modules
})
export class OcrModule {}
