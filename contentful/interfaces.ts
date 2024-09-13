export interface Product {
  id: string;
  title: string;
  description: string;
  price: number;
  // Add other product fields
}

export interface Collection {
  id: string;
  title: string;
  // Add other collection fields
}

export interface Order {
  id: string;
  // Add order fields
}

export interface ProductComparison {
  products: Product[];
  commonFeatures: string[];
}