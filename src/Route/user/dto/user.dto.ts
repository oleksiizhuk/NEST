import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MinLength,
  IsNumber,
  Max,
  Min,
} from 'class-validator';

class UserDto {
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
  @Max(100, {
    message: 'Max age is 100',
  })
  @Min(14, {
    message: 'min age is 14',
  })
  age: number;

  @IsString()
  @MinLength(4)
  @ApiProperty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  password: string;
}

export { UserDto };
