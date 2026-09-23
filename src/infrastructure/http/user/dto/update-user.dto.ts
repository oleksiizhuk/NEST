import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Every field optional; anything not listed here is rejected by the global
// ValidationPipe, so shoppingCartId and other internal fields can't be set.
export class UpdateUserHttpDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @ApiPropertyOptional()
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @ApiPropertyOptional()
  lastName?: string;

  @IsOptional()
  @IsNumber()
  @Max(100, { message: 'Max age is 100' })
  @Min(14, { message: 'min age is 14' })
  @ApiPropertyOptional()
  age?: number;

  @IsOptional()
  @IsEmail()
  @ApiPropertyOptional()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @ApiPropertyOptional()
  password?: string;
}
