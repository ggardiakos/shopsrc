export interface Product {
  id: string;
  title: string;
  description: string;
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
  comparisonMatrix: string[][];
}

export interface CustomizationOption {
  id: string;
  name: string;
  type: string;
  availableChoices: string[];
}

export interface CustomizedProduct extends Product {
  customizations: {
    option: CustomizationOption;
    chosenValue: string;
  }[];
}