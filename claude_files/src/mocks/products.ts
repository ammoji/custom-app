import { Product } from '../types';

export const MOCK_PRODUCTS: Product[] = [
  // shop_001 — Sharma Kirana
  { id: 'p_001_atta_5kg', shopId: 'shop_001', name: 'Aashirvaad Whole Wheat Atta', brand: 'Aashirvaad', category: 'atta_rice_dal', imageUrl: 'https://picsum.photos/seed/atta5/300/300', packSize: { value: 5, unit: 'kg' }, mrp: 275, price: 260, inStock: true, tags: ['bestseller'] },
  { id: 'p_001_milk_1l', shopId: 'shop_001', name: 'Amul Taaza Toned Milk', brand: 'Amul', category: 'dairy_eggs', imageUrl: 'https://picsum.photos/seed/amul1l/300/300', packSize: { value: 1, unit: 'litre' }, mrp: 70, price: 68, inStock: true },
  { id: 'p_001_parleg', shopId: 'shop_001', name: 'Parle-G Original Biscuits', brand: 'Parle', category: 'snacks_biscuits', imageUrl: 'https://picsum.photos/seed/parleg/300/300', packSize: { value: 800, unit: 'g' }, mrp: 80, price: 75, inStock: true },
  { id: 'p_001_dettol', shopId: 'shop_001', name: 'Dettol Liquid Handwash', brand: 'Dettol', category: 'household', imageUrl: 'https://picsum.photos/seed/dettol/300/300', packSize: { value: 200, unit: 'ml' }, mrp: 99, price: 89, inStock: true },
  { id: 'p_001_eggs', shopId: 'shop_001', name: 'Farm Fresh Eggs', category: 'dairy_eggs', imageUrl: 'https://picsum.photos/seed/eggs/300/300', packSize: { value: 6, unit: 'piece' }, mrp: 48, price: 45, inStock: true },

  // shop_002 — Gupta General
  { id: 'p_002_rice_5kg', shopId: 'shop_002', name: 'India Gate Basmati Rice', brand: 'India Gate', category: 'atta_rice_dal', imageUrl: 'https://picsum.photos/seed/rice/300/300', packSize: { value: 5, unit: 'kg' }, mrp: 720, price: 689, inStock: true },
  { id: 'p_002_oil_1l', shopId: 'shop_002', name: 'Fortune Sunflower Oil', brand: 'Fortune', category: 'oil_ghee', imageUrl: 'https://picsum.photos/seed/fortuneoil/300/300', packSize: { value: 1, unit: 'litre' }, mrp: 165, price: 159, inStock: true },
  { id: 'p_002_bread', shopId: 'shop_002', name: 'Britannia Whole Wheat Bread', brand: 'Britannia', category: 'bakery', imageUrl: 'https://picsum.photos/seed/bread/300/300', packSize: { value: 400, unit: 'g' }, mrp: 50, price: 48, inStock: true },
  { id: 'p_002_tea', shopId: 'shop_002', name: 'Tata Premium Tea', brand: 'Tata', category: 'beverages', imageUrl: 'https://picsum.photos/seed/tea/300/300', packSize: { value: 500, unit: 'g' }, mrp: 280, price: 265, inStock: true },
  { id: 'p_002_maggi', shopId: 'shop_002', name: 'Maggi Masala Noodles', brand: 'Maggi', category: 'snacks_biscuits', imageUrl: 'https://picsum.photos/seed/maggi/300/300', packSize: { value: 70, unit: 'g' }, mrp: 14, price: 14, inStock: true },

  // shop_003 — Krishna Dairy (closed)
  { id: 'p_003_paneer', shopId: 'shop_003', name: 'Mother Dairy Paneer', brand: 'Mother Dairy', category: 'dairy_eggs', imageUrl: 'https://picsum.photos/seed/paneer/300/300', packSize: { value: 200, unit: 'g' }, mrp: 95, price: 92, inStock: true },
  { id: 'p_003_curd', shopId: 'shop_003', name: 'Amul Dahi Curd', brand: 'Amul', category: 'dairy_eggs', imageUrl: 'https://picsum.photos/seed/curd/300/300', packSize: { value: 400, unit: 'g' }, mrp: 50, price: 48, inStock: true },
  { id: 'p_003_butter', shopId: 'shop_003', name: 'Amul Butter', brand: 'Amul', category: 'dairy_eggs', imageUrl: 'https://picsum.photos/seed/butter/300/300', packSize: { value: 100, unit: 'g' }, mrp: 56, price: 55, inStock: true },
  { id: 'p_003_rusk', shopId: 'shop_003', name: 'Britannia Premium Rusk', brand: 'Britannia', category: 'bakery', imageUrl: 'https://picsum.photos/seed/rusk/300/300', packSize: { value: 300, unit: 'g' }, mrp: 60, price: 58, inStock: true },

  // shop_004 — Singh Fresh Mart
  { id: 'p_004_onion', shopId: 'shop_004', name: 'Fresh Onions', category: 'fruits_vegetables', imageUrl: 'https://picsum.photos/seed/onion/300/300', packSize: { value: 1, unit: 'kg' }, mrp: 40, price: 35, inStock: true },
  { id: 'p_004_potato', shopId: 'shop_004', name: 'Fresh Potatoes', category: 'fruits_vegetables', imageUrl: 'https://picsum.photos/seed/potato/300/300', packSize: { value: 1, unit: 'kg' }, mrp: 30, price: 28, inStock: true },
  { id: 'p_004_tomato', shopId: 'shop_004', name: 'Fresh Tomatoes', category: 'fruits_vegetables', imageUrl: 'https://picsum.photos/seed/tomato/300/300', packSize: { value: 500, unit: 'g' }, mrp: 25, price: 22, inStock: true },
  { id: 'p_004_banana', shopId: 'shop_004', name: 'Yelakki Bananas', category: 'fruits_vegetables', imageUrl: 'https://picsum.photos/seed/banana/300/300', packSize: { value: 1, unit: 'dozen' }, mrp: 60, price: 55, inStock: true },
  { id: 'p_004_haldi', shopId: 'shop_004', name: 'Everest Haldi Powder', brand: 'Everest', category: 'masala_spices', imageUrl: 'https://picsum.photos/seed/haldi/300/300', packSize: { value: 100, unit: 'g' }, mrp: 60, price: 55, inStock: true },

  // shop_005 — Verma Provision
  { id: 'p_005_toor', shopId: 'shop_005', name: 'Tata Sampann Toor Dal', brand: 'Tata Sampann', category: 'atta_rice_dal', imageUrl: 'https://picsum.photos/seed/toor/300/300', packSize: { value: 1, unit: 'kg' }, mrp: 180, price: 169, inStock: true },
  { id: 'p_005_soap', shopId: 'shop_005', name: 'Dove Beauty Bar', brand: 'Dove', category: 'personal_care', imageUrl: 'https://picsum.photos/seed/dove/300/300', packSize: { value: 100, unit: 'g' }, mrp: 65, price: 60, inStock: true },
  { id: 'p_005_paste', shopId: 'shop_005', name: 'Colgate MaxFresh Toothpaste', brand: 'Colgate', category: 'personal_care', imageUrl: 'https://picsum.photos/seed/colgate/300/300', packSize: { value: 150, unit: 'g' }, mrp: 115, price: 105, inStock: false },
  { id: 'p_005_surf', shopId: 'shop_005', name: 'Surf Excel Detergent', brand: 'Surf Excel', category: 'household', imageUrl: 'https://picsum.photos/seed/surf/300/300', packSize: { value: 1, unit: 'kg' }, mrp: 220, price: 210, inStock: true },

  // shop_006 — Modern Bazaar
  { id: 'p_006_cola', shopId: 'shop_006', name: 'Coca-Cola Bottle', brand: 'Coca-Cola', category: 'beverages', imageUrl: 'https://picsum.photos/seed/cola/300/300', packSize: { value: 750, unit: 'ml' }, mrp: 45, price: 40, inStock: true },
  { id: 'p_006_lays', shopId: 'shop_006', name: 'Lays Magic Masala', brand: 'Lays', category: 'snacks_biscuits', imageUrl: 'https://picsum.photos/seed/lays/300/300', packSize: { value: 75, unit: 'g' }, mrp: 30, price: 28, inStock: true },
  { id: 'p_006_kurkure', shopId: 'shop_006', name: 'Kurkure Masala Munch', brand: 'Kurkure', category: 'snacks_biscuits', imageUrl: 'https://picsum.photos/seed/kurkure/300/300', packSize: { value: 90, unit: 'g' }, mrp: 20, price: 20, inStock: true },
  { id: 'p_006_shampoo', shopId: 'shop_006', name: 'Head & Shoulders Shampoo', brand: 'Head & Shoulders', category: 'personal_care', imageUrl: 'https://picsum.photos/seed/shampoo/300/300', packSize: { value: 340, unit: 'ml' }, mrp: 399, price: 369, inStock: true },

  // shop_007 — Annapurna Stores
  { id: 'p_007_chana', shopId: 'shop_007', name: 'Tata Sampann Chana Dal', brand: 'Tata Sampann', category: 'atta_rice_dal', imageUrl: 'https://picsum.photos/seed/chana/300/300', packSize: { value: 1, unit: 'kg' }, mrp: 130, price: 119, inStock: true },
  { id: 'p_007_ghee', shopId: 'shop_007', name: 'Amul Pure Ghee', brand: 'Amul', category: 'oil_ghee', imageUrl: 'https://picsum.photos/seed/ghee/300/300', packSize: { value: 1, unit: 'litre' }, mrp: 650, price: 620, inStock: true },
  { id: 'p_007_salt', shopId: 'shop_007', name: 'Tata Salt', brand: 'Tata', category: 'masala_spices', imageUrl: 'https://picsum.photos/seed/tatasalt/300/300', packSize: { value: 1, unit: 'kg' }, mrp: 28, price: 28, inStock: true },
  { id: 'p_007_garam', shopId: 'shop_007', name: 'MDH Garam Masala', brand: 'MDH', category: 'masala_spices', imageUrl: 'https://picsum.photos/seed/mdh/300/300', packSize: { value: 100, unit: 'g' }, mrp: 80, price: 75, inStock: true },

  // shop_008 — Lal Kirana (closed)
  { id: 'p_008_atta', shopId: 'shop_008', name: 'Pillsbury Chakki Atta', brand: 'Pillsbury', category: 'atta_rice_dal', imageUrl: 'https://picsum.photos/seed/pillsbury/300/300', packSize: { value: 5, unit: 'kg' }, mrp: 265, price: 255, inStock: true },
  { id: 'p_008_milk', shopId: 'shop_008', name: 'Mother Dairy Full Cream Milk', brand: 'Mother Dairy', category: 'dairy_eggs', imageUrl: 'https://picsum.photos/seed/motherdairy/300/300', packSize: { value: 1, unit: 'litre' }, mrp: 72, price: 70, inStock: true },
  { id: 'p_008_oreo', shopId: 'shop_008', name: 'Oreo Vanilla Biscuits', brand: 'Oreo', category: 'snacks_biscuits', imageUrl: 'https://picsum.photos/seed/oreo/300/300', packSize: { value: 120, unit: 'g' }, mrp: 30, price: 28, inStock: true },
];
