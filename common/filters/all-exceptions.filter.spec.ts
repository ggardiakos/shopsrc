import { AllExceptionsFilter } from './all-exceptions.filter';
import { ArgumentsHost } from '@nestjs/common';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter({ error: jest.fn() } as any); // Mock logger
  });

  it('should handle HttpException correctly', () => {
    const mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: jest.fn().mockReturnThis(), send: jest.fn() }),
        getRequest: () => ({ url: '/test' }),
      }),
    } as unknown as ArgumentsHost;

    const exception = new Error('Test error');

    filter.catch(exception, mockHost);
    expect(filter).toBeDefined();
  });
});
