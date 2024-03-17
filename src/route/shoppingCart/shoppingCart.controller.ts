import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ShoppingCartService } from './shoppingCart.service';

@ApiTags('ShoppingCart')
@Controller('shoppingCart')
export class ShoppingCartController {
  constructor(private readonly shoppingCartService: ShoppingCartService) {}

  @Post('/')
  async add() {
    await this.shoppingCartService.add();
  }
}
