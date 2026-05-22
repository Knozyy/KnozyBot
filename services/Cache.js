import { config } from '../config.js';

class Cache {
  constructor(ttl = config.cache.ttl) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  set(key, value, customTtl = null) {
    const expiresAt = Date.now() + (customTtl || this.ttl);
    this.cache.set(key, { value, expiresAt });
    return value;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  // Utility: get or fetch
  async getOrFetch(key, fetchFn, customTtl = null) {
    const cached = this.get(key);
    if (cached) return cached;

    const value = await fetchFn();
    this.set(key, value, customTtl);
    return value;
  }
}

export default new Cache();
