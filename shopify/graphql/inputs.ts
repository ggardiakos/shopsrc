export interface CreateProductInput {
  title: string;
  description: string;
  // Add other fields for product creation
}

export interface UpdateProductInput {
  id: string;
  title?: string;
  description?: string;
  // Add other fields for product update
}

export interface CreateCollectionInput {
  title: string;
  // Add other fields for collection creation
}

export interface OrderItemInput {
  variantId: string;
  quantity: number;
}

export interface CustomizeProductInput {
  productId: string;
  customizations: {
    optionId: string;
    chosenValue: string;
  }[];
}