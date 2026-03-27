/**
 * Cache Provider Interface
 * Defines the contract for all cache adapter implementations.
 */
export class CacheProvider {
  async get(key) {
    throw new Error('CacheProvider.get() is not implemented.');
  }

  async set(key, value, ttl = null) {
    throw new Error('CacheProvider.set() is not implemented.');
  }

  async del(...keys) {
    throw new Error('CacheProvider.del() is not implemented.');
  }

  async delPattern(pattern) {
    throw new Error('CacheProvider.delPattern() is not implemented.');
  }

  async exists(key) {
    throw new Error('CacheProvider.exists() is not implemented.');
  }

  async mget(keys) {
    throw new Error('CacheProvider.mget() is not implemented.');
  }

  async mset(entries, ttl = null) {
    throw new Error('CacheProvider.mset() is not implemented.');
  }

  async incr(key, by = 1, ttl = null) {
    throw new Error('CacheProvider.incr() is not implemented.');
  }

  async ttl(key) {
    throw new Error('CacheProvider.ttl() is not implemented.');
  }

  async clear() {
    throw new Error('CacheProvider.clear() is not implemented.');
  }

  /**
   * Cache-aside (read-through) pattern.
   * Returns the cached value if present; otherwise fetches, caches, and returns fresh data.
   *
   * @param {string}   key      - Cache key
   * @param {number}   ttl      - Time-to-live in seconds
   * @param {Function} fetchFn  - Async function invoked on cache miss
   * @returns {Promise<any>}
   */
  async aside(key, ttl, fetchFn) {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    const fresh = await fetchFn();
    if (fresh !== null && fresh !== undefined) {
      await this.set(key, fresh, ttl);
    }
    return fresh;
  }
}

export default CacheProvider;
