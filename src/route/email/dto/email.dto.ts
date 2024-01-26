import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

class EmailDto {
  @IsString()
  @MinLength(4)
  @ApiProperty()
  email: string;
}

export { EmailDto };
