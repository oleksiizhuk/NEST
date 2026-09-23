import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@infrastructure/http/auth/guards/jwt-auth.guard';
import { CurrentUserEmail } from '@infrastructure/http/auth/auth-user.decorator';
import { AddItemHttpDto } from '@infrastructure/http/shopping-cart/dto/add-item.dto';
import { CreateShoppingCartUseCase } from '@application/shopping-cart/use-cases/create-shopping-cart.use-case';
import { AddItemUseCase } from '@application/shopping-cart/use-cases/add-item.use-case';
import { GetCartUseCase } from '@application/shopping-cart/use-cases/get-cart.use-case';
import { CompleteOrderUseCase } from '@application/shopping-cart/use-cases/complete-order.use-case';

@ApiTags('ShoppingCart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shoppingCart')
export class ShoppingCartController {
  constructor(
    private readonly createShoppingCartUseCase: CreateShoppingCartUseCase,
    private readonly addItemUseCase: AddItemUseCase,
    private readonly getCartUseCase: GetCartUseCase,
    private readonly completeOrderUseCase: CompleteOrderUseCase,
  ) {}

  @Post('/createShoppingCart')
  createShoppingCart(@CurrentUserEmail() email: string) {
    return this.createShoppingCartUseCase.execute(email);
  }

  @Post('/addItem')
  @ApiBody({ type: AddItemHttpDto })
  addItem(
    @CurrentUserEmail() email: string,
    @Body() { itemID, count }: AddItemHttpDto,
  ) {
    return this.addItemUseCase.execute(email, itemID, count);
  }

  @Get('/')
  getCart(@CurrentUserEmail() email: string) {
    return this.getCartUseCase.execute(email);
  }

  @Post('/completeOrder')
  completeOrder(@CurrentUserEmail() email: string) {
    return this.completeOrderUseCase.execute(email);
  }
}
