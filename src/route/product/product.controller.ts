import { Controller, Get, Query, Post, Body, Param } from '@nestjs/common';
import { ProductService } from './product.service';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { ProductDTO } from './dto/product.dto';

@ApiTags('Product')
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get('/:page/:limit')
  async getProduct(@Param('page') page: string, @Param('limit') limit: string) {
    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber =
      parseInt(limit, 10) > 100 ? 100 : parseInt(limit, 10) || 10;
    return this.productService.getProduct({
      page: pageNumber,
      limit: limitNumber,
      route: 'http://your-domain.com/products',
    });
  }

  @ApiBearerAuth()
  @Get('/:id')
  async getByID(@Query('id') id: string) {
    return this.productService.getByID(id);
  }

  @ApiBearerAuth()
  @Post('/')
  @ApiBody({ type: ProductDTO })
  async addProduct(@Body() product: ProductDTO) {
    return this.productService.addProduct(product);
  }
}
