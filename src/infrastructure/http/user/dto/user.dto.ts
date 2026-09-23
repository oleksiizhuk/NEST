import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MinLength,
  IsNumber,
  IsEmail,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

export class UserHttpDto {
  @IsString()
  @MinLength(2)
  @ApiProperty()
  firstName: string;

  @IsString()
  @MinLength(2)
  @ApiProperty()
  lastName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  @Max(100, { message: 'Max age is 100' })
  @Min(14, { message: 'min age is 14' })
  age: number;

  @IsEmail()
  @ApiProperty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(72)
  @ApiProperty()
  password: string;
}
