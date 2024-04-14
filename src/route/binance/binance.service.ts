import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class BinanceService {
  async getLatestPrice(symbol: string): Promise<any> {
    try {
      const response = await axios.get(
        `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch price: ${error.message}`);
    }
  }
}
