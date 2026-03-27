import { Product } from '@domain/product/product.entity';
import { ProductDocument } from '@infrastructure/database/schemas/product.schema';

export class ProductMapper {
  static toDomain(doc: ProductDocument): Product {
    return new Product(
      doc.id,
      doc.age,
      doc.type,
      doc.imageUrl,
      doc.name,
      doc.snippet,
      doc.price,
      doc.discount,
      doc.screen,
      doc.capacity,
      doc.ram,
    );
  }
}
