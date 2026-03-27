import { Controller, Get, Query, Post, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags, ApiQuery } from '@nestjs/swagger';
import { ProductDTO } from '@infrastructure/http/product/dto/product.dto';
import { GetProductsUseCase } from '@application/product/use-cases/get-products.use-case';
import { GetProductByIdUseCase } from '@application/product/use-cases/get-product-by-id.use-case';
import { AddProductUseCase } from '@application/product/use-cases/add-product.use-case';

@ApiTags('Product')
@Controller('product')
export class ProductController {
  constructor(
    private readonly getProductsUseCase: GetProductsUseCase,
    private readonly getProductByIdUseCase: GetProductByIdUseCase,
    private readonly addProductUseCase: AddProductUseCase,
  ) {}

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
    return this.getProductsUseCase.execute(pageNumber, limitNumber);
  }

  @ApiBearerAuth()
  @Get('/:id')
  async getByID(@Query('id') id: string) {
    return this.getProductByIdUseCase.execute(id);
  }

  @ApiBearerAuth()
  @Post('/')
  @ApiBody({ type: ProductDTO })
  async addProduct(@Body() product: ProductDTO) {
    return this.addProductUseCase.execute(product);
  }
}
