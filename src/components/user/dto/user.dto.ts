import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength, IsOptional } from 'class-validator';

class UserDto {
  @IsString()
  @MinLength(2)
  @ApiProperty()
  name: string;

  @IsString()
  @IsOptional()
  @MinLength(4)
  @ApiProperty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  password: string;
}

export { UserDto };
