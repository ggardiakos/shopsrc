import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const csrfToken = request.headers['x-csrf-token'];
    
    if (!csrfToken || typeof csrfToken !== 'string') {
      throw new UnauthorizedException('Missing CSRF token');
    }

    return true; // Actual validation is handled by @fastify/csrf-protection
  }
}
``