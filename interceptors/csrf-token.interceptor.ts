import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class CsrfTokenInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => {
        const response = context.switchToHttp().getResponse();
        const request = context.switchToHttp().getRequest();
        if (request.method === 'GET') {
          response.header('csrf-token', request.csrfToken());
        }
        return data;
      }),
    );
  }
}