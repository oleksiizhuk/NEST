import { Module } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { BinanceController } from './binance.controller';

@Module({
  controllers: [BinanceController],
  providers: [BinanceService],
  exports: [BinanceService],
})
export class BinanceModule {}
