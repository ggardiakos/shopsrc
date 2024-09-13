import { Module } from "@nestjs/common";
import { ShopifyGraphqlProxyModule } from "@nestjs-shopify/graphql";
import { GraphQLResolver } from "./graphql.resolver";

@Module({
  imports: [ShopifyGraphqlProxyModule],
  providers: [GraphQLResolver],
})
export class GraphQLModule {}