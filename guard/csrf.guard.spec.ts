import { CsrfGuard } from './role.guard';
import { ExecutionContext } from '@nestjs/common';

describe('CsrfGuard', () => {
  let guard: CsrfGuard;

  beforeEach(() => {
    guard = new CsrfGuard();
  });

  it('should return true when CSRF token exists', () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-csrf-token': 'valid-token' } }),
      }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(mockContext)).toBe(true);
  });

  it('should throw UnauthorizedException if CSRF token is missing', () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(mockContext)).toThrow('Missing CSRF token');
  });
});
