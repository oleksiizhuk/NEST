export const TOKEN_SERVICE = 'TOKEN_SERVICE';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenSubject {
  userId: string;
  email: string;
}

export interface ITokenService {
  issue(subject: TokenSubject): AuthTokens;
  // The subject of a valid, unexpired refresh token, otherwise null.
  verifyRefresh(token: string): TokenSubject | null;
}
