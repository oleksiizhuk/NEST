import { Controller, Get, Query } from '@nestjs/common';
import { ProductService } from './product.service';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller()
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @ApiBearerAuth()
  @Get()
  async getProduct(@Query('page') page = 1, @Query('limit') limit = 10) {
    limit = limit > 100 ? 100 : limit;
    return this.productService.getProduct({
      page,
      limit,
      route: 'http://your-domain.com/products',
    });
  }

  @ApiBearerAuth()
  @Get('/:id')
  async getByID(@Query('id') id: string) {
    return this.productService.getByID(id);
  }
}
