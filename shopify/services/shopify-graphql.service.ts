import 'dd-trace/init';
import tracer from 'dd-trace';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { ShopifyAuth } from '@nestjs-shopify/auth';
import { GraphQLClient } from 'graphql-request';
import { ShopifyService } from './shopify.service';
import { Product, Collection, Order, Partner, Promotion, CustomizationOption, GameAudioSetting, DesignCollaboration } from '../schemas';

@Injectable()
export class ShopifyGraphQLService {
  private readonly logger = new Logger(ShopifyGraphQLService.name);
  private client: GraphQLClient;

  constructor(
    private readonly configService: ConfigService,
    private httpService: HttpService,
    @Inject(ShopifyAuth) private readonly shopifyAuth: ShopifyAuth,
    private readonly shopifyService: ShopifyService,
  ) {
    this.initializeClient();
  }

  private initializeClient() {
    const shopifyUrl = this.configService.get<string>('SHOPIFY_GRAPHQL_URL');
    const accessToken = this.configService.get<string>('SHOPIFY_ACCESS_TOKEN');
    
    this.client = new GraphQLClient(shopifyUrl, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
    });
  }

  async query(query: string, variables: any = {}): Promise<any> {
    const span = tracer.startSpan('shopify.graphql.query');
    try {
      return await this.client.request(query, variables);
    } catch (error) {
      this.logger.error(`GraphQL query failed: ${error.message}`, error.stack);
      throw error;
    } finally {
      span.finish();
    }
  }

  async mutate(mutation: string, variables: any = {}): Promise<any> {
    return this.query(mutation, variables);
  }

  // Product-related methods
  async getProductById(id: string): Promise<Product> {
    const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          description
          images(first: 1) {
            edges {
              node {
                originalSrc
              }
            }
          }
          variants(first: 1) {
            edges {
              node {
                id
                price
              }
            }
          }
        }
      }
    `;
    const variables = { id };
    const data = await this.query(query, variables);
    return data.product;
  }

  async getProducts(queryString: string): Promise<Product[]> {
    const query = `
      query getProducts($query: String!) {
        products(first: 10, query: $query) {
          edges {
            node {
              id
              title
              handle
              description
              images(first: 1) {
                edges {
                  node {
                    originalSrc
                  }
                }
              }
              variants(first: 1) {
                edges {
                  node {
                    id
                    price
                  }
                }
              }
            }
          }
        }
      }
    `;
    const variables = { query: queryString };
    const data = await this.query(query, variables);
    return data.products.edges.map((edge) => edge.node);
  }

  async createProduct(product: Product): Promise<Product> {
    const mutation = `
      mutation createProduct($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            title
            handle
            description
            images(first: 1) {
              edges {
                node {
                  originalSrc
                }
              }
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  price
                }
              }
            }
          }
        }
      }
    `;
    const variables = { input: product };
    const data = await this.mutate(mutation, variables);
    return data.productCreate.product;
  }

  async updateProduct(id: string, product: Product): Promise<Product> {
    const mutation = `
      mutation updateProduct($id: ID!, $input: ProductInput!) {
        productUpdate(input: { id: $id, product: $input }) {
          product {
            id
            title
            handle
            description
            images(first: 1) {
              edges {
                node {
                  originalSrc
                }
              }
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  price
                }
              }
            }
          }
        }
      }
    `;
    const variables = { id, input: product };
    const data = await this.mutate(mutation, variables);
    return data.productUpdate.product;
  }

  async deleteProduct(id: string): Promise<boolean> {
    const mutation = `
      mutation deleteProduct($id: ID!) {
        productDelete(input: { id: $id }) {
          deletedProductId
        }
      }
    `;
    const variables = { id };
    const data = await this.mutate(mutation, variables);
    return !!data.productDelete.deletedProductId;
  }

  // Collection-related methods
  async getCollections(): Promise<Collection[]> {
    const query = `
      query getCollections {
        collections(first: 10) {
          edges {
            node {
              id
              title
              handle
              description
              image {
                originalSrc
              }
            }
          }
        }
      }
    `;
    const data = await this.query(query);
    return data.collections.edges.map((edge) => edge.node);
  }

  // ... (implement createCollection, updateCollection, deleteCollection)

  // Order-related methods
  async getOrders(): Promise<Order[]> {
    const query = `
      query getOrders {
        orders(first: 10) {
          edges {
            node {
              id
              name
              email
              totalQuantity
              totalPrice
              createdAt
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    price
                  }
                }
              }
            }
          }
        }
      }
    `;
    const data = await this.query(query);
    return data.orders.edges.map((edge) => edge.node);
  }

  // ... (implement getOrderById, createOrder, updateOrder, deleteOrder)

  // Partner-related methods
  async getPartners(): Promise<Partner[]> {
    const query = `
      query getPartners {
        partners(first: 10) {
          edges {
            node {
              id
              name
              email
              phone
              address
              website
            }
          }
        }
      }
    `;
    const data = await this.query(query);
    return data.partners.edges.map((edge) => edge.node);
  }

  // ... (implement createPartner, updatePartner, deletePartner)

  // Promotion-related methods
  async getPromotions(): Promise<Promotion[]> {
    const query = `
      query getPromotions {
        promotions(first: 10) {
          edges {
            node {
              id
              code
              description
              startDate
              endDate
              discountType
              discountValue
              usageLimit
              usageCount
            }
          }
        }
      }
    `;
    const data = await this.query(query);
    return data.promotions.edges.map((edge) => edge.node);
  }

  // ... (implement createPromotion, updatePromotion, deletePromotion)

  // CustomizationOption-related methods
  async getCustomizationOptions(productId: string): Promise<CustomizationOption[]> {
    const query = `
      query getCustomizationOptions($productId: ID!) {
        product(id: $productId) {
          options {
            id
            name
            values
          }
        }
      }
    `;
    const variables = { productId };
    const data = await this.query(query, variables);
    return data.product.options;
  }

  // ... (implement createCustomizationOption, updateCustomizationOption, deleteCustomizationOption)

  // GameAudioSetting-related methods
  async getGameAudioSettings(gameName?: string): Promise<GameAudioSetting[]> {
    const query = `
      query getGameAudioSettings($gameName: String) {
        gameAudioSettings(gameName: $gameName) {
          id
          gameName
          audioUrl
          createdAt
        }
      }
    `;
    const variables = { gameName };
    const data = await this.query(query, variables);
    return data.gameAudioSettings;
  }

  // ... (implement createGameAudioSetting, updateGameAudioSetting, deleteGameAudioSetting)

  // DesignCollaboration-related methods
  async getDesignCollaborations(): Promise<DesignCollaboration[]> {
    const query = `
      query getDesignCollaborations {
        designCollaborations {
          id
          designerId
          clientName
          projectName
          createdAt
        }
      }
    `;
    const data = await this.query(query);
    return data.designCollaborations;
  }

 // ... (previous code remains the same)

  // Collection-related methods (continued)
  async createCollection(collection: Partial<Collection>): Promise<Collection> {
    const mutation = `
      mutation createCollection($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection {
            id
            title
            handle
            description
            image {
              originalSrc
            }
          }
        }
      }
    `;
    const variables = { input: collection };
    const data = await this.mutate(mutation, variables);
    return data.collectionCreate.collection;
  }

  async updateCollection(id: string, collection: Partial<Collection>): Promise<Collection> {
    const mutation = `
      mutation updateCollection($id: ID!, $input: CollectionInput!) {
        collectionUpdate(input: { id: $id, collection: $input }) {
          collection {
            id
            title
            handle
            description
            image {
              originalSrc
            }
          }
        }
      }
    `;
    const variables = { id, input: collection };
    const data = await this.mutate(mutation, variables);
    return data.collectionUpdate.collection;
  }

  async deleteCollection(id: string): Promise<boolean> {
    const mutation = `
      mutation deleteCollection($id: ID!) {
        collectionDelete(input: { id: $id }) {
          deletedCollectionId
        }
      }
    `;
    const variables = { id };
    const data = await this.mutate(mutation, variables);
    return !!data.collectionDelete.deletedCollectionId;
  }

  // Order-related methods (continued)
  async getOrderById(id: string): Promise<Order> {
    const query = `
      query getOrder($id: ID!) {
        order(id: $id) {
          id
          name
          email
          totalQuantity
          totalPrice
          createdAt
          lineItems(first: 10) {
            edges {
              node {
                title
                quantity
                price
              }
            }
          }
        }
      }
    `;
    const variables = { id };
    const data = await this.query(query, variables);
    return data.order;
  }

  async createOrder(order: Partial<Order>): Promise<Order> {
    const mutation = `
      mutation createOrder($input: OrderInput!) {
        orderCreate(input: $input) {
          order {
            id
            name
            email
            totalQuantity
            totalPrice
            createdAt
            lineItems(first: 10) {
              edges {
                node {
                  title
                  quantity
                  price
                }
              }
            }
          }
        }
      }
    `;
    const variables = { input: order };
    const data = await this.mutate(mutation, variables);
    return data.orderCreate.order;
  }

  async updateOrder(id: string, order: Partial<Order>): Promise<Order> {
    const mutation = `
      mutation updateOrder($id: ID!, $input: OrderInput!) {
        orderUpdate(input: { id: $id, order: $input }) {
          order {
            id
            name
            email
            totalQuantity
            totalPrice
            createdAt
            lineItems(first: 10) {
              edges {
                node {
                  title
                  quantity
                  price
                }
              }
            }
          }
        }
      }
    `;
    const variables = { id, input: order };
    const data = await this.mutate(mutation, variables);
    return data.orderUpdate.order;
  }

  async deleteOrder(id: string): Promise<boolean> {
    const mutation = `
      mutation deleteOrder($id: ID!) {
        orderDelete(input: { id: $id }) {
          deletedOrderId
        }
      }
    `;
    const variables = { id };
    const data = await this.mutate(mutation, variables);
    return !!data.orderDelete.deletedOrderId;
  }

  // Partner-related methods (continued)
  async createPartner(partner: Partial<Partner>): Promise<Partner> {
    const mutation = `
      mutation createPartner($input: PartnerInput!) {
        partnerCreate(input: $input) {
          partner {
            id
            name
            email
            phone
            address
            website
          }
        }
      }
    `;
    const variables = { input: partner };
    const data = await this.mutate(mutation, variables);
    return data.partnerCreate.partner;
  }

  async updatePartner(id: string, partner: Partial<Partner>): Promise<Partner> {
    const mutation = `
      mutation updatePartner($id: ID!, $input: PartnerInput!) {
        partnerUpdate(input: { id: $id, partner: $input }) {
          partner {
            id
            name
            email
            phone
            address
            website
          }
        }
      }
    `;
    const variables = { id, input: partner };
    const data = await this.mutate(mutation, variables);
    return data.partnerUpdate.partner;
  }

  async deletePartner(id: string): Promise<boolean> {
    const mutation = `
      mutation deletePartner($id: ID!) {
        partnerDelete(input: { id: $id }) {
          deletedPartnerId
        }
      }
    `;
    const variables = { id };
    const data = await this.mutate(mutation, variables);
    return !!data.partnerDelete.deletedPartnerId;
  }

  // Promotion-related methods (continued)
  async createPromotion(promotion: Partial<Promotion>): Promise<Promotion> {
    const mutation = `
      mutation createPromotion($input: PromotionInput!) {
        promotionCreate(input: $input) {
          promotion {
            id
            code
            description
            startDate
            endDate
            discountType
            discountValue
            usageLimit
            usageCount
          }
        }
      }
    `;
    const variables = { input: promotion };
    const data = await this.mutate(mutation, variables);
    return data.promotionCreate.promotion;
  }

  async updatePromotion(id: string, promotion: Partial<Promotion>): Promise<Promotion> {
    const mutation = `
      mutation updatePromotion($id: ID!, $input: PromotionInput!) {
        promotionUpdate(input: { id: $id, promotion: $input }) {
          promotion {
            id
            code
            description
            startDate
            endDate
            discountType
            discountValue
            usageLimit
            usageCount
          }
        }
      }
    `;
    const variables = { id, input: promotion };
    const data = await this.mutate(mutation, variables);
    return data.promotionUpdate.promotion;
  }

  async deletePromotion(id: string): Promise<boolean> {
    const mutation = `
      mutation deletePromotion($id: ID!) {
        promotionDelete(input: { id: $id }) {
          deletedPromotionId
        }
      }
    `;
    const variables = { id };
    const data = await this.mutate(mutation, variables);
    return !!data.promotionDelete.deletedPromotionId;
  }

  // CustomizationOption-related methods (continued)
  async createCustomizationOption(productId: string, option: Partial<CustomizationOption>): Promise<CustomizationOption> {
    const mutation = `
      mutation createCustomizationOption($productId: ID!, $input: ProductOptionInput!) {
        productOptionCreate(input: { productId: $productId, option: $input }) {
          productOption {
            id
            name
            values
          }
        }
      }
    `;
    const variables = { productId, input: option };
    const data = await this.mutate(mutation, variables);
    return data.productOptionCreate.productOption;
  }

  async updateCustomizationOption(id: string, option: Partial<CustomizationOption>): Promise<CustomizationOption> {
    const mutation = `
      mutation updateCustomizationOption($id: ID!, $input: ProductOptionInput!) {
        productOptionUpdate(input: { id: $id, option: $input }) {
          productOption {
            id
            name
            values
          }
        }
      }
    `;
    const variables = { id, input: option };
    const data = await this.mutate(mutation, variables);
    return data.productOptionUpdate.productOption;
  }

  async deleteCustomizationOption(id: string): Promise<boolean> {
    const mutation = `
      mutation deleteCustomizationOption($id: ID!) {
        productOptionDelete(input: { id: $id }) {
          deletedProductOptionId
        }
      }
    `;
    const variables = { id };
    const data = await this.mutate(mutation, variables);
    return !!data.productOptionDelete.deletedProductOptionId;
  }

  // GameAudioSetting-related methods (continued)
  async createGameAudioSetting(setting: Partial<GameAudioSetting>): Promise<GameAudioSetting> {
    const mutation = `
      mutation createGameAudioSetting($input: GameAudioSettingInput!) {
        gameAudioSettingCreate(input: $input) {
          gameAudioSetting {
            id
            gameName
            audioUrl
            createdAt
          }
        }
      }
    `;
    const variables = { input: setting };
    const data = await this.mutate(mutation, variables);
    return data.gameAudioSettingCreate.gameAudioSetting;
  }

  async updateGameAudioSetting(id: string, setting: Partial<GameAudioSetting>): Promise<GameAudioSetting> {
    const mutation = `
      mutation updateGameAudioSetting($id: ID!, $input: GameAudioSettingInput!) {
        gameAudioSettingUpdate(input: { id: $id, gameAudioSetting: $input }) {
          gameAudioSetting {
            id
            gameName
            audioUrl
            createdAt
          }
        }
      }
    `;
    const variables = { id, input: setting };
    const data = await this.mutate(mutation, variables);
    return data.gameAudioSettingUpdate.gameAudioSetting;
  }

  async deleteGameAudioSetting(id: string): Promise<boolean> {
    const mutation = `
      mutation deleteGameAudioSetting($id: ID!) {
        gameAudioSettingDelete(input: { id: $id }) {
          deletedGameAudioSettingId
        }
      }
    `;
    const variables = { id };
    const data = await this.mutate(mutation, variables);
    return !!data.gameAudioSettingDelete.deletedGameAudioSettingId;
  }

  // DesignCollaboration-related methods (continued)
  async createDesignCollaboration(collaboration: Partial<DesignCollaboration>): Promise<DesignCollaboration> {
    const mutation = `
      mutation createDesignCollaboration($input: DesignCollaborationInput!) {
        designCollaborationCreate(input: $input) {
          designCollaboration {
            id
            designerId
            clientName
            projectName
            createdAt
          }
        }
      }
    `;
    const variables = { input: collaboration };
    const data = await this.mutate(mutation, variables);
    return data.designCollaborationCreate.designCollaboration;
  }

  async updateDesignCollaboration(id: string, collaboration: Partial<DesignCollaboration>): Promise<DesignCollaboration> {
    const mutation = `
      mutation updateDesignCollaboration($id: ID!, $input: DesignCollaborationInput!) {
        designCollaborationUpdate(input: { id: $id, designCollaboration: $input }) {
          designCollaboration {
            id
            designerId
            clientName
            projectName
            createdAt
          }
        }
      }
    `;
    const variables = { id, input: collaboration };
    const data = await this.mutate(mutation, variables);
    return data.designCollaborationUpdate.designCollaboration;
  }

  async deleteDesignCollaboration(id: string): Promise<boolean> {
    const mutation = `
      mutation deleteDesignCollaboration($id: ID!) {
        designCollaborationDelete(input: { id: $id }) {
          deletedDesignCollaborationId
        }
      }
    `;
    const variables = { id };
    const data = await this.mutate(mutation, variables);
    return !!data.designCollaborationDelete.deletedDesignCollaborationId;
  }
}