// No fallback: a guessable default secret would let anyone forge tokens.
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Configure it in the environment.');
  }
  return secret;
}

export const ACCESS_TOKEN_TTL = '24h';
export const REFRESH_TOKEN_TTL = '100h';
