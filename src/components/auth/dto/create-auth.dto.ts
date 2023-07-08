import {
  IsEmail,
  IsNumber,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  Min,
  Max,
  IsNotEmpty,
  NotContains,
} from 'class-validator';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { Match } from '../../../decorator/match.decorator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAuthDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(8, {
    message: 'is too short',
  })
  @MaxLength(20, {
    message: 'userName is too long',
  })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
    {
      message:
        'Minimum eight characters, at least one uppercase letter, one lowercase letter, one number and one special character',
    },
  )
  password: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  @Match('password', {
    message: 'confirmation password is not matches',
  })
  passwordConfirm: string;

  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(2, {
    message: 'firstName is too short',
  })
  @MaxLength(32, {
    message: 'firstName is too long',
  })
  @NotContains(' ', {
    message: 'without space',
  })
  firstName: string;

  @ApiProperty()
  @IsString()
  @NotContains(' ', {
    message: 'without space',
  })
  @MinLength(2, {
    message: 'lastName is too short',
  })
  @MaxLength(32, {
    message: 'lastName is too long',
  })
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
}
