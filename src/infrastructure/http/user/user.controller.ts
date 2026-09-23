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
import { JwtAuthGuard } from '@infrastructure/http/auth/guards/jwt-auth.guard';
import { CurrentUserEmail } from '@infrastructure/http/auth/auth-user.decorator';
import { UserHttpDto } from '@infrastructure/http/user/dto/user.dto';
import { UpdateUserHttpDto } from '@infrastructure/http/user/dto/update-user.dto';
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

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('/:id')
  getUserById(@Param('id') id: string) {
    return this.getUserByIdUseCase.execute(id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch('/:id')
  @ApiBody({ type: UpdateUserHttpDto })
  patchUser(
    @CurrentUserEmail() email: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserHttpDto,
  ) {
    return this.updateUserUseCase.execute(email, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete('/:id')
  @HttpCode(204)
  async delete(@CurrentUserEmail() email: string, @Param('id') id: string) {
    await this.deleteUserUseCase.execute(email, id);
  }
}
