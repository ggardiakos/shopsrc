export class InvalidHandlerClassError extends Error {
    constructor(className: string) {
      super(`Invalid handler class: ${className}`);
      this.name = 'InvalidHandlerClassError';
    }
  }
  
  export class WebhookRegistrationError extends Error {
    constructor(topic: string, shop: string, message: string) {
      super(`Failed to register webhook for topic ${topic} in shop ${shop}: ${message}`);
      this.name = 'WebhookRegistrationError';
    }
  }
  
  export class WebhookUnregistrationError extends Error {
    constructor(shop: string, message: string) {
      super(`Failed to unregister webhooks for shop ${shop}: ${message}`);
      this.name = 'WebhookUnregistrationError';
    }
  }