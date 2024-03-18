import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ShoppingCartService } from './shoppingCart.service';
import { JwtAuthGuard } from '../../guards/guards/jwt-auth.guard';

@ApiTags('ShoppingCart')
@Controller('shoppingCart')
export class ShoppingCartController {
  constructor(private readonly shoppingCartService: ShoppingCartService) {}

  @UseGuards(JwtAuthGuard)
  @Post('/createShoppingCart')
  async createShoppingCart(@Request() req) {
    return await this.shoppingCartService.createShoppingCart(
      req.user.email.email,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('/addItem')
  async addItem(
    @Request() req,
    @Body() { itemID, count }: { itemID: string; count: number },
  ) {
    return await this.shoppingCartService.addItem(
      req.user.email.email,
      itemID,
      count,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('/')
  async getCart(@Request() req) {
    return await this.shoppingCartService.getCart(req.user.email.email);
  }

  @UseGuards(JwtAuthGuard)
  @Post('/completeOrder')
  async completeOrder(@Request() req) {
    return await this.shoppingCartService.completeOrder(req.user.email.email);
  }
}
