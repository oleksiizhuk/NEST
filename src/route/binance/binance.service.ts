import { Injectable } from '@nestjs/common';
import axios from 'axios';
const URL = 'https://api.binance.com/api/v3';

@Injectable()
export class BinanceService {
  async getLatestPrice(symbol: string): Promise<string> {
    try {
      const response = await axios.get(
        `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch price: ${error.message}`);
    }
  }

  async getMyPrices(): Promise<string[]> {
    try {
      const response = await axios.get(
        `${URL}/ticker/price?symbols=%5B%22BTCUSDT%22,%22STRKUSDT%22,%22OPUSDT%22,%22ARBUSDT%22%5D`,
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch price: ${error.message}`);
    }
  }
}
