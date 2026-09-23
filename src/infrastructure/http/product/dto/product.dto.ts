import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, Min } from 'class-validator';

export class ProductDTO {
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
  @Min(0)
  @ApiProperty()
  price: number;

  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Absolute amount off the price, not a percent' })
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
