import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RefreshTokenUseCase } from '../refresh-token.use-case';

describe('RefreshTokenUseCase', () => {
  let useCase: RefreshTokenUseCase;
  const mockJwtService = { decode: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenUseCase,
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();
    useCase = module.get(RefreshTokenUseCase);
    jest.clearAllMocks();
  });

  it('returns decoded payload for valid token', () => {
    const payload = { email: 'john@test.com' };
    mockJwtService.decode.mockReturnValue(payload);
    const result = useCase.execute('valid-token');
    expect(result).toEqual(payload);
  });

  it('throws BadRequestException for invalid token', () => {
    mockJwtService.decode.mockReturnValue(null);
    expect(() => useCase.execute('bad-token')).toThrow(BadRequestException);
  });
});
