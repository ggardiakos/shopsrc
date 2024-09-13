import { InputType, Field, ID, Float, Int } from '@nestjs/graphql';

@InputType()
export class CreateProductInput {
  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => [ProductVariantInput], { nullable: true })
  variants?: ProductVariantInput[];

  @Field(() => [String], { nullable: true })
  tags?: string[];

  @Field(() => ProductImageInput, { nullable: true })
  images?: ProductImageInput[];

  @Field(() => Boolean, { nullable: true })
  publishedStatus?: boolean;
}

@InputType()
class ProductVariantInput {
  @Field()
  title: string;

  @Field(() => Float)
  price: number;

  @Field(() => Int)
  inventoryQuantity: number;

  @Field({ nullable: true })
  sku?: string;
}

@InputType()
class ProductImageInput {
  @Field()
  src: string;

  @Field({ nullable: true })
  altText?: string;
}

@InputType()
export class UpdateProductInput {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => [ProductVariantInput], { nullable: true })
  variants?: ProductVariantInput[];

  @Field(() => [String], { nullable: true })
  tags?: string[];

  @Field(() => [ProductImageInput], { nullable: true })
  images?: ProductImageInput[];

  @Field(() => Boolean, { nullable: true })
  publishedStatus?: boolean;
}

@InputType()
export class CreateCollectionInput {
  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => [ID], { nullable: true })
  productIds?: string[];

  @Field(() => Boolean, { nullable: true })
  isPublished?: boolean;
}

@InputType()
export class OrderItemInput {
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
class CustomizationInput {
  @Field(() => ID)
  optionId: string;

  @Field()
  chosenValue: string;
}