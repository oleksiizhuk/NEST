import { Injectable } from '@nestjs/common';
import { createWorker } from 'tesseract.js';

@Injectable()
export class OcrService {
  async convertImageToText(fileBuffer: Buffer): Promise<string> {
    const worker = await createWorker();

    try {
      const {
        data: { text },
      } = await worker.recognize(fileBuffer);
      await worker.terminate();
      return text;
    } catch (error) {
      console.error('Error during OCR processing:', error);
      await worker.terminate(); // Ensure worker termination even in case of error
      throw error;
    }
  }
}
