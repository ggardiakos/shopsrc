declare global {
    namespace NodeJS {
      interface ProcessEnv {
        SHOPIFY_API_SECRET: string;
        SCOPES: string;
        HOST: string;
        // Add other environment variables here
      }
    }
  }
  
  export {};