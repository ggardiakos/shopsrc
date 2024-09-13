export class ShopifyError extends Error {
  constructor(message: string, public originalError?: Error) {
    super(message);
    this.name = 'ShopifyError';
  }
}