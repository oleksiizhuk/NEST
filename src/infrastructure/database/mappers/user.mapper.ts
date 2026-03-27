import { User } from '../../../domain/user/user.entity';
import { UserDocument } from '../schemas/user.schema';

export class UserMapper {
  static toDomain(doc: UserDocument): User {
    return new User(
      (doc._id as any).toString(),
      doc.firstName,
      doc.lastName,
      doc.age,
      doc.email,
      doc.password,
      doc.shoppingCartId,
    );
  }
}
