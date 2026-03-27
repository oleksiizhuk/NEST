# Testing Guide — NestJS Clean Architecture

## Philosophy

Clean Architecture makes unit testing easy: **use cases have zero framework dependencies**, so tests need no NestJS `Test.createTestingModule()`.

---

## Unit Testing Use Cases

Mock only the repository interface. No Mongoose, no HTTP, no NestJS.

```typescript
// src/application/auth/use-cases/login.use-case.spec.ts
import { LoginUseCase } from './login.use-case';
import { IUserRepository } from '../../../domain/user/user.repository.interface';
import { User } from '../../../domain/user/user.entity';
import { BadRequestException } from '@nestjs/common';

const mockUser = new User('id1', 'John', 'Doe', 25, 'john@test.com', 'pass123', null);

const mockRepo: IUserRepository = {
  findAll: jest.fn(),
  findById: jest.fn(),
  findByEmail: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  updateShoppingCart: jest.fn(),
};

const mockJwtGenerator = { generateJWT: jest.fn().mockReturnValue({ accessToken: 'at', refreshToken: 'rt' }) };

describe('LoginUseCase', () => {
  let useCase: LoginUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new LoginUseCase(mockRepo as any, mockJwtGenerator as any);
  });

  it('returns tokens on valid credentials', async () => {
    (mockRepo.findByEmail as jest.Mock).mockResolvedValue(mockUser);
    const result = await useCase.execute({ email: 'john@test.com', password: 'pass123' });
    expect(result.accessToken).toBe('at');
    expect(result.user).toBe(mockUser);
  });

  it('throws BadRequestException on wrong password', async () => {
    (mockRepo.findByEmail as jest.Mock).mockResolvedValue(mockUser);
    await expect(useCase.execute({ email: 'john@test.com', password: 'wrong' }))
      .rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when user not found', async () => {
    (mockRepo.findByEmail as jest.Mock).mockResolvedValue(null);
    await expect(useCase.execute({ email: 'x@x.com', password: 'pass' }))
      .rejects.toThrow(BadRequestException);
  });
});
```

---

## Integration Testing Controllers

Use `@nestjs/testing` when you need to test the full HTTP layer.

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { UserController } from './user.controller';
import { GetUsersUseCase } from '../../../application/user/use-cases/get-users.use-case';

describe('UserController (integration)', () => {
  let app: INestApplication;
  const mockGetUsersUseCase = { execute: jest.fn().mockResolvedValue([]) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: GetUsersUseCase, useValue: mockGetUsersUseCase }],
      // ... other use cases
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /user returns array', () => {
    return request(app.getHttpServer())
      .get('/user')
      .expect(200)
      .expect([]);
  });
});
```

---

## Test file locations

```
src/application/<domain>/use-cases/<name>.use-case.spec.ts   ← unit tests (no NestJS)
src/infrastructure/http/<domain>/<name>.controller.spec.ts   ← controller integration tests
```

## Run tests

```bash
npm test              # all tests
npm run test:watch    # watch mode
npm run test:cov      # coverage report
```