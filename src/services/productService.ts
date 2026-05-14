import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { Product } from '../types';
import { db } from './firebase';

export const productService = {
  async getByShop(shopId: string): Promise<Product[]> {
    const q = query(collection(db, 'products'), where('shopId', '==', shopId));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Product);
  },
  async getById(productId: string): Promise<Product | null> {
    const snap = await getDoc(doc(db, 'products', productId));
    return snap.exists() ? (snap.data() as Product) : null;
  },
};
