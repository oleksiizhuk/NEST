import { Module } from '@nestjs/common';
import { OcrService } from '@infrastructure/ocr/ocr.service';

@Module({
  providers: [OcrService],
  exports: [OcrService],
})
export class OcrModule {}
