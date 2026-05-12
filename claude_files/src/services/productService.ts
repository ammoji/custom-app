import { MOCK_PRODUCTS } from '../mocks/products';
import { Product } from '../types';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export const productService = {
  async getByShop(shopId: string): Promise<Product[]> {
    await delay(200);
    return MOCK_PRODUCTS.filter(p => p.shopId === shopId);
  },
  async getById(productId: string): Promise<Product | null> {
    await delay(100);
    return MOCK_PRODUCTS.find(p => p.id === productId) ?? null;
  },
};
