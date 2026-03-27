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
import { AuthGuard } from '@nestjs/passport';
import { UserHttpDto } from '@infrastructure/http/user/dto/user.dto';
import { GetUsersUseCase } from '@application/user/use-cases/get-users.use-case';
import { CreateUserUseCase } from '@application/user/use-cases/create-user.use-case';
import { GetUserByIdUseCase } from '@application/user/use-cases/get-user-by-id.use-case';
import { UpdateUserUseCase } from '@application/user/use-cases/update-user.use-case';
import { DeleteUserUseCase } from '@application/user/use-cases/delete-user.use-case';

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(
    private readonly getUsersUseCase: GetUsersUseCase,
    private readonly createUserUseCase: CreateUserUseCase,
    private readonly getUserByIdUseCase: GetUserByIdUseCase,
    private readonly updateUserUseCase: UpdateUserUseCase,
    private readonly deleteUserUseCase: DeleteUserUseCase,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Get('/')
  getUsers() {
    return this.getUsersUseCase.execute();
  }

  @Post('/')
  @ApiBody({ type: UserHttpDto })
  createUser(@Body() dto: UserHttpDto) {
    return this.createUserUseCase.execute(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Get('/:id')
  getUserById(@Param('id') id: string) {
    return this.getUserByIdUseCase.execute(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Patch('/:id')
  patchUser(@Param('id') id: string, @Body() dto: UserHttpDto) {
    return this.updateUserUseCase.execute(id, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Delete('/:id')
  @HttpCode(204)
  delete(@Param('id') id: string) {
    return this.deleteUserUseCase.execute(id);
  }
}
