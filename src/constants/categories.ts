export type CategoryId =
  | 'atta_rice_dal'
  | 'oil_ghee'
  | 'dairy_eggs'
  | 'bakery'
  | 'masala_spices'
  | 'snacks_biscuits'
  | 'beverages'
  | 'personal_care'
  | 'household'
  | 'fruits_vegetables';

export type Category = { id: CategoryId; label: string };

export const CATEGORIES: Category[] = [
  { id: 'atta_rice_dal', label: 'Atta, Rice & Dal' },
  { id: 'oil_ghee', label: 'Oil & Ghee' },
  { id: 'dairy_eggs', label: 'Dairy & Eggs' },
  { id: 'bakery', label: 'Bakery' },
  { id: 'masala_spices', label: 'Masala & Spices' },
  { id: 'snacks_biscuits', label: 'Snacks & Biscuits' },
  { id: 'beverages', label: 'Beverages' },
  { id: 'personal_care', label: 'Personal Care' },
  { id: 'household', label: 'Household' },
  { id: 'fruits_vegetables', label: 'Fruits & Vegetables' },
];
