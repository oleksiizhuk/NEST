import mongoose, { Types } from 'mongoose';
import { ProductSchema } from '@infrastructure/database/schemas/product.schema';
import { ShoppingCartSchema } from '@infrastructure/database/schemas/shopping-cart.schema';

// Schema-level checks without a database: casting and validation run
// in-process, which is where the cart/product id bugs lived.
const Product = mongoose.model('ProductSchemaSpec', ProductSchema);
const Cart = mongoose.model('CartSchemaSpec', ShoppingCartSchema);

const productData = {
  age: 0,
  type: 'phone',
  imageUrl: 'img.png',
  name: 'Phone',
  snippet: 's',
  price: 10,
  discount: 1,
  screen: '6"',
  capacity: '128GB',
  ram: '4GB',
};

describe('Mongo schemas', () => {
  it('accepts a new product without a client-supplied id', () => {
    const _id = new Types.ObjectId();
    const doc = new Product({ ...productData, _id, id: _id.toString() });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('stores a cart line referencing the product _id string', () => {
    const productId = new Types.ObjectId().toString();
    const cart = new Cart({
      id: 'cart-1',
      items: [{ count: 2, item: productId }],
      price: { price: 20, discount: 2, finalPrice: 18 },
    });
    expect(cart.validateSync()).toBeUndefined();
    expect(String(cart.items[0].item)).toBe(productId);
  });

  it('refuses a cart line whose reference is not an ObjectId', () => {
    const cart = new Cart({
      id: 'cart-1',
      items: [{ count: 1, item: 'motorola-xoom' }],
    });
    expect(cart.validateSync()).toBeDefined();
  });
});
