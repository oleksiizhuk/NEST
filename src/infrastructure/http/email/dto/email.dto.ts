import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class EmailDto {
  @IsEmail()
  @ApiProperty()
  email: string;

  @IsString()
  @MaxLength(5000)
  @ApiProperty()
  message: string;
}

export class EmailWithTemplateDto {
  @IsEmail()
  @ApiProperty()
  email: string;
}
