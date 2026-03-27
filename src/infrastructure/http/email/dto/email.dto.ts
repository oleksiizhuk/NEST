import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class EmailDto {
  @IsString()
  @MinLength(4)
  @ApiProperty()
  email: string;

  @IsString()
  @ApiProperty()
  message: string;
}

export class EmailWithTemplateDto {
  @IsString()
  @MinLength(4)
  @ApiProperty()
  email: string;
}
