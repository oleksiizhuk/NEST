import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Patch,
  Delete,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserDto } from './dto/user.dto';
import { UserService } from './user.service';
import { IUser } from './interfaces/user.interfaces';
import { AuthGuard } from '@nestjs/passport';

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // @UseGuards(JwtAuthGuard)
  @UseGuards(AuthGuard('local'))
  @ApiBearerAuth()
  @Get('/')
  getUsers(): Promise<IUser[]> {
    return this.userService.getUsers();
  }

  @Post('/')
  @ApiBody({ type: UserDto })
  createUser(@Body() user: UserDto): Promise<IUser> {
    return this.userService.createUser({
      ...user,
      email: user.email.toLowerCase(),
    });
  }

  // @UseGuards(AuthGuard('jwt'))
  // @ApiBearerAuth()
  @Get('/:id')
  getUserById(@Param('id') id: string): Promise<IUser> {
    return this.userService.getUserById(id);
  }

  @Get('/:email')
  getUserByEmail(@Param('email') email: string): Promise<IUser> {
    return this.userService.getUserByEmail(email);
  }

  @Patch('/:id')
  patchUser(@Param('id') id: string, @Body() user: UserDto): Promise<IUser> {
    return this.userService.update(id, user);
  }

  @Delete('/:id')
  @HttpCode(204)
  delete(@Param('id') id: string): Promise<IUser> {
    return this.userService.delete(id);
  }
}
