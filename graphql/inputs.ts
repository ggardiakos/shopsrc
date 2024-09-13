import { InputType, Field, ID, Int } from '@nestjs/graphql';

@InputType()
export class CreateProductInput {
  @Field()
  title: string;

  @Field()
  description: string;

  // ... other input fields for your Contentful 'product' entry
}

@InputType()
export class UpdateProductInput {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field()
  description: string;

  // ... other input fields for your Contentful 'product' entry
}

@InputType()
export class CreateCollectionInput {
  @Field()
  title: string;

  @Field()
  description: string;

  // ... other input fields for your Contentful 'collection' entry
}

@InputType()
export class OrderItemInput {
  @Field(() => ID)
  productId: string;

  @Field(() => ID)
  variantId: string;

  @Field(() => Int)
  quantity: number;
}

@InputType()
export class CustomizeProductInput {
  @Field(() => ID)
  productId: string;

  @Field(() => [CustomizationInput])
  customizations: CustomizationInput[];
}

@InputType()
export class CustomizationInput {
  @Field(() => ID)
  optionId: string;

  @Field()
  chosenValue: string;
}