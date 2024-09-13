import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Inject } from '@nestjs/common';
import type { Logger as WinstonLogger } from 'winston';
import { ShopifyError } from '@shopify/shopify-api'; // Hypothetical import for Shopify SDK errors

@Catch(HttpException, ShopifyError) // Catch both HttpException and Shopify errors
export class ShopifyExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winstonLogger: WinstonLogger, // Use Winston for logging
  ) {}

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    
    // Determine the status code
    const status = exception instanceof HttpException 
      ? exception.getStatus() 
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Use exception message or fallback to a default message
    const message = exception.message || 'Unexpected Shopify API error';
    
    // Log detailed information about the error, including the request body and method
    this.winstonLogger.error('ShopifyExceptionFilter caught an error', {
      message,
      method: request.method,
      path: request.url,
      body: request.body,
      statusCode: status,
      errorStack: exception.stack || 'No stack trace available',
    });

    // In development, include the stack trace in the response
    const errorStack = process.env.NODE_ENV === 'development' ? exception.stack : null;

    // Send a consistent error response to the client
    response.status(status).send({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      errorMessage: message,
      errorStack, // Include stack trace in development mode
    });
  }
}
