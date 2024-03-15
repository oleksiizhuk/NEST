import { Controller, Get, Query, Post, Body } from '@nestjs/common';
import { ProductService } from './product.service';
import { ApiBearerAuth, ApiBody, ApiTags, ApiQuery } from '@nestjs/swagger';
import { ProductDTO } from './dto/product.dto';

@ApiTags('Product')
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get('/')
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Limit of items per page',
  })
  async getProduct(@Query('page') page: string, @Query('limit') limit: string) {
    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber =
      parseInt(limit, 10) > 100 ? 100 : parseInt(limit, 10) || 10;
    return this.productService.getProduct({
      page: pageNumber,
      limit: limitNumber,
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
