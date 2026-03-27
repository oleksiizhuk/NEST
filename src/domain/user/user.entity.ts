export class User {
  constructor(
    public readonly id: string,
    public firstName: string,
    public lastName: string,
    public age: number,
    public email: string,
    public password: string,
    public shoppingCartId: string | null,
  ) {}

  toPublicProfile(): Omit<User, 'password' | 'toPublicProfile'> {
    return {
      id: this.id,
      firstName: this.firstName,
      lastName: this.lastName,
      age: this.age,
      email: this.email,
      shoppingCartId: this.shoppingCartId,
    };
  }
}
