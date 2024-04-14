import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const URL = 'https://api.binance.com';

@Injectable()
export class BinanceService {
  private apiKey: string;
  private apiSecret: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('B_API_KEY');
    this.apiSecret = this.configService.get<string>('B_API_SECRET');
    axios.defaults.headers.common['X-MBX-APIKEY'] = this.apiKey;
  }

  async getLatestPrice(symbol: string): Promise<string> {
    try {
      const response = await axios.get(
        `${URL}/api/v3/ticker/price?symbol=${symbol}`,
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch price: ${error.message}`);
    }
  }

  async getMyPrices(): Promise<string[]> {
    try {
      const response = await axios.get(
        `${URL}/api/v3/ticker/price?symbols=%5B%22BTCUSDT%22,%22STRKUSDT%22,%22OPUSDT%22,%22ARBUSDT%22%5D`,
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch price: ${error.message}`);
    }
  }

  async getAccountInfo(): Promise<any> {
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = this.sign(query);

    try {
      const response = await axios.get(
        `${URL}/api/v3/account?${query}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': this.apiKey },
        },
      );

      const nonZeroBalances = response.data.balances.filter(
        (balance: { free: string; locked: string }) => {
          return parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0;
        },
      );
      return { ...response.data, balances: nonZeroBalances };
    } catch (error) {
      throw new Error(`Failed to fetch account info: ${error.message}`);
    }
  }

  private sign(queryString: string): string {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }
}
