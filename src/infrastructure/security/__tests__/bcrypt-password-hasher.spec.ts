import { BcryptPasswordHasher } from '@infrastructure/security/bcrypt-password-hasher';

describe('BcryptPasswordHasher', () => {
  const hasher = new BcryptPasswordHasher();

  it('hashes so that the hash verifies and the plain text is not stored', async () => {
    const hash = await hasher.hash('Secret1!');
    expect(hash).not.toContain('Secret1!');
    expect(hasher.isLegacy(hash)).toBe(false);
    await expect(hasher.verify('Secret1!', hash)).resolves.toBe(true);
    await expect(hasher.verify('wrong', hash)).resolves.toBe(false);
  });

  it('still verifies a legacy plain-text password', async () => {
    expect(hasher.isLegacy('pass123')).toBe(true);
    await expect(hasher.verify('pass123', 'pass123')).resolves.toBe(true);
    await expect(hasher.verify('pass12', 'pass123')).resolves.toBe(false);
  });

  it('never verifies against an empty stored value', async () => {
    await expect(hasher.verify('', '')).resolves.toBe(false);
  });
});
