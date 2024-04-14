import { Controller, Get, Query } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('binance')
@Controller('binance')
export class BinanceController {
  constructor(private binanceService: BinanceService) {}

  @Get('price')
  getLatestPrice(@Query('symbol') symbol: string) {
    return this.binanceService.getLatestPrice(symbol);
  }
}
