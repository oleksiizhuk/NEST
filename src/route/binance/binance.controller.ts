import {
  Controller,
  Get,
  Query,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
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

  @Get('prices')
  @ApiQuery({
    description: 'BTCUSDT, OPUSDT, ARBUSDY, STRKUSDT',
  })
  getMyPrices() {
    return this.binanceService.getMyPrices();
  }

  @Get('account-info')
  async getAccountInfo() {
    try {
      return await this.binanceService.getAccountInfo();
    } catch (error) {
      throw new HttpException(
        'Failed to get account info',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
