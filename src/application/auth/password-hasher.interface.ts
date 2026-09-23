export const PASSWORD_HASHER = 'PASSWORD_HASHER';

export interface IPasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, stored: string): Promise<boolean>;
  // True for a value stored before hashing was introduced (plain text).
  isLegacy(stored: string): boolean;
}
