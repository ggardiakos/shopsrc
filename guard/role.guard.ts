import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const csrfToken = request.headers['x-csrf-token'];
   
    if (!csrfToken || typeof csrfToken !== 'string') {
      throw new UnauthorizedException('Missing CSRF token');
    }

    const isValid = this.validateCsrfToken(csrfToken, request);
    if (!isValid) {
      throw new UnauthorizedException('Invalid CSRF token');
    }

    return true;
  }

  private validateCsrfToken(token: string, request: FastifyRequest): boolean {
    const secret = this.configService.get<string>('CSRF_SECRET');
    if (!secret) {
      throw new Error('CSRF_SECRET is not configured');
    }

    const [timestamp, hash] = token.split('.');

    if (!timestamp || !hash) {
      return false;
    }

    const expectedHash = this.generateTokenHash(timestamp, request, secret);
    
    // Use timing-safe comparison
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
  }

  private generateTokenHash(timestamp: string, request: FastifyRequest, secret: string): string {
    const sessionId = request.session?.id || '';
    const data = `${timestamp}${sessionId}${request.ip}`;
    return crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');
  }

  public generateToken(request: FastifyRequest): string {
    const secret = this.configService.get<string>('CSRF_SECRET');
    if (!secret) {
      throw new Error('CSRF_SECRET is not configured');
    }

    const timestamp = Date.now().toString();
    const hash = this.generateTokenHash(timestamp, request, secret);
    return `${timestamp}.${hash}`;
  }
}