import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class MyService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getData(key: string): Promise<any> {
    const cachedData = await this.cacheManager.get(key);
    if (cachedData) {
      return cachedData;
    }

    // Fetch data from an external API or database
    const data = await this.fetchDataFromAPI();
    
    // Cache the data
    await this.cacheManager.set(key, data, { ttl: 3600 }); // Cache for 1 hour
    return data;
  }

  async fetchDataFromAPI() {
    // Your logic to fetch data
  }
}