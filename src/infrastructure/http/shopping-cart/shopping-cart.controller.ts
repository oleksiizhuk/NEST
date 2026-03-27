import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateShoppingCartUseCase } from '../../../application/shopping-cart/use-cases/create-shopping-cart.use-case';
import { AddItemUseCase } from '../../../application/shopping-cart/use-cases/add-item.use-case';
import { GetCartUseCase } from '../../../application/shopping-cart/use-cases/get-cart.use-case';
import { CompleteOrderUseCase } from '../../../application/shopping-cart/use-cases/complete-order.use-case';

@ApiTags('ShoppingCart')
@Controller('shoppingCart')
export class ShoppingCartController {
  constructor(
    private readonly createShoppingCartUseCase: CreateShoppingCartUseCase,
    private readonly addItemUseCase: AddItemUseCase,
    private readonly getCartUseCase: GetCartUseCase,
    private readonly completeOrderUseCase: CompleteOrderUseCase,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('/createShoppingCart')
  async createShoppingCart(@Request() req) {
    return this.createShoppingCartUseCase.execute(req.user.email.email);
  }

  @UseGuards(JwtAuthGuard)
  @Post('/addItem')
  async addItem(
    @Request() req,
    @Body() { itemID, count }: { itemID: string; count: number },
  ) {
    return this.addItemUseCase.execute(req.user.email.email, itemID, count);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/')
  async getCart(@Request() req) {
    return this.getCartUseCase.execute(req.user.email.email);
  }

  @UseGuards(JwtAuthGuard)
  @Post('/completeOrder')
  async completeOrder(@Request() req) {
    return this.completeOrderUseCase.execute(req.user.email.email);
  }
}