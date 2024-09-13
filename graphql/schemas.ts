export interface Product {
    id: string;
    title: string;
    description: string;
    // Add other product fields here based on your Contentful content model
  }
  
  export interface Collection {
    id: string;
    title: string;
    description: string;
    products: Product[]; // Assuming your collections have linked products
  }
  
  export interface Order {
    id: string;
    name: string; // Customer name or identifier
    totalPrice: number;
    createdAt: string; // ISO date string
    fulfillmentStatus: string; // e.g., 'pending', 'fulfilled', etc.
    lineItems: OrderLineItem[]; 
  }
  
  export interface OrderLineItem {
    title: string;
    quantity: number;
    variant: {
      id: string;
      title: string;
      price: number;
    };
  }
  
  export interface ProductComparison {
    products: Product[];
    commonFeatures: string[];
    comparisonMatrix: string[][];
  }
  
  export interface CustomizationOption {
    id: string;
    name: string;
    type: string; // e.g., 'dropdown', 'text', 'color'
    availableChoices: string[];
  }
  
  export interface CustomizedProduct extends Product {
    customizations: {
      option: CustomizationOption;
      chosenValue: string;
    }[];
  }