import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ShopifyError } from './errors/shopify-error';  // Make sure the path to ShopifyError is correct

@Catch(ShopifyError)
export class ShopifyExceptionFilter implements ExceptionFilter {
  catch(exception: ShopifyError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const status = HttpStatus.BAD_REQUEST;  // You can customize the status if needed.

    response.status(status).send({
      statusCode: status,
      message: exception.message,
      code: exception.code,
      suggestion: exception.suggestion || 'No suggestion available.',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
