import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber } from 'class-validator';

class ProductDTO {
  @IsNumber()
  @ApiProperty()
  age: number;

  @IsString()
  @ApiProperty()
  type: string;

  @IsString()
  @ApiProperty()
  imageUrl: string;

  @IsString()
  @ApiProperty()
  name: string;

  @IsString()
  @ApiProperty()
  snippet: string;

  @IsNumber()
  @ApiProperty()
  price: number;

  @IsNumber()
  @ApiProperty()
  discount: number;

  @IsString()
  @ApiProperty()
  screen: string;

  @IsString()
  @ApiProperty()
  capacity: string;

  @IsString()
  @ApiProperty()
  ram: string;
}

export { ProductDTO };
