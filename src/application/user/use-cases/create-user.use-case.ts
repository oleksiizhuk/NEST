import { Inject, Injectable } from '@nestjs/common';
import { IUserRepository, USER_REPOSITORY } from '../../../domain/user/user.repository.interface';
import { User } from '../../../domain/user/user.entity';

export interface CreateUserDto {
  firstName: string;
  lastName: string;
  age: number;
  email: string;
  password: string;
}

@Injectable()
export class CreateUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(dto: CreateUserDto): Promise<User> {
    return this.userRepository.create({
      ...dto,
      email: dto.email.toLowerCase(),
      shoppingCartId: null,
    });
  }
}