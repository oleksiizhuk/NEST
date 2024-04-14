import { Controller, Get, Query } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { ApiTags, ApiQuery } from '@nestjs/swagger';

@ApiTags('Binance')
@Controller('binance')
export class BinanceController {
  constructor(private binanceService: BinanceService) {}

  @Get('price')
  @ApiQuery({
    name: 'symbol',
    description: 'The symbol to get the price for, e.g., BTCUSDT',
    required: true,
  })
  getLatestPrice(@Query('symbol') symbol: string) {
    return this.binanceService.getLatestPrice(symbol);
  }

  @Get('test')
  test() {
    return '';
  }
}
