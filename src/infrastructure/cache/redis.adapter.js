import { createClient } from 'redis';
import { CacheProvider } from './cache.provider.js';

export class RedisAdapter extends CacheProvider {
  constructor(config = {}) {
    super();
    this.client = null;
    this.config = {
      url: config.REDIS_URL || process.env.REDIS_URL || 'redis://localhost:6379',
      password: config.REDIS_PASSWORD || process.env.REDIS_PASSWORD,
      db: config.REDIS_DB ?? parseInt(process.env.REDIS_DB, 10) ?? 0,
      socket: {
        reconnectStrategy: retries => Math.min(retries * 50, 2000),
      },
      ...config,
    };
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = createClient(this.config);

      this.client.on('error', err => {
        console.error('[Redis] Client error:', err.message);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.info('[Redis] Connection established.');
        this.isConnected = true;
      });

      this.client.on('reconnecting', () => {
        console.warn('[Redis] Attempting to reconnect...');
      });

      this.client.on('end', () => {
        console.warn('[Redis] Connection closed.');
        this.isConnected = false;
      });

      await this.client.connect();
      return this;
    } catch (err) {
      console.error('[Redis] Failed to connect:', err.message);
      throw err;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      console.info('[Redis] Connection gracefully closed.');
    }
  }

  async get(key) {
    try {
      const value = await this.client.get(key);
      if (value === null) return null;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (err) {
      console.warn(`[Redis] GET failed for key "${key}":`, err.message);
      return null;
    }
  }

  async set(key, value, ttl = null) {
    try {
      const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (ttl) {
        await this.client.setEx(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (err) {
      console.warn(`[Redis] SET failed for key "${key}":`, err.message);
      return false;
    }
  }

  async del(...keys) {
    if (!keys.length) return 0;
    try {
      return await this.client.del(keys);
    } catch (err) {
      console.warn(`[Redis] DEL failed for keys [${keys.join(', ')}]:`, err.message);
      return 0;
    }
  }

  async delPattern(pattern) {
    try {
      let cursor = 0;
      let deleted = 0;
      do {
        // FIX: node-redis v4 scan() takes an options object, not positional args
        const reply = await this.client.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = reply.cursor;
        if (reply.keys.length) {
          await this.client.del(reply.keys);
          deleted += reply.keys.length;
        }
      } while (cursor !== 0);
      return deleted;
    } catch (err) {
      console.warn(`[Redis] DEL pattern "${pattern}" failed:`, err.message);
      return 0;
    }
  }

  async exists(key) {
    try {
      return (await this.client.exists(key)) === 1;
    } catch (err) {
      console.warn(`[Redis] EXISTS failed for key "${key}":`, err.message);
      return false;
    }
  }

  async mget(keys) {
    try {
      const values = await this.client.mGet(keys);
      return keys.reduce((acc, key, i) => {
        const raw = values[i];
        if (raw !== null && raw !== undefined) {
          try {
            acc[key] = JSON.parse(raw);
          } catch {
            acc[key] = raw;
          }
        }
        return acc;
      }, {});
    } catch (err) {
      console.warn(`[Redis] MGET failed for keys [${keys.join(', ')}]:`, err.message);
      return {};
    }
  }

  async mset(entries, ttl = null) {
    try {
      const pipeline = this.client.multi();
      for (const [key, value] of Object.entries(entries)) {
        const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
        if (ttl) {
          pipeline.setEx(key, ttl, serialized);
        } else {
          pipeline.set(key, serialized);
        }
      }
      await pipeline.exec();
    } catch (err) {
      console.warn('[Redis] MSET failed:', err.message);
    }
  }

  async incr(key, by = 1, ttl = null) {
    try {
      const val = await this.client.incrBy(key, by);
      // Set TTL only when the key is first created (val === by)
      if (val === by && ttl) {
        await this.client.expire(key, ttl);
      }
      return val;
    } catch (err) {
      console.warn(`[Redis] INCR failed for key "${key}":`, err.message);
      return 0;
    }
  }

  async ttl(key) {
    try {
      return await this.client.ttl(key);
    } catch {
      return -2;
    }
  }

  async clear() {
    try {
      await this.client.flushDb();
      console.info('[Redis] Database flushed successfully.');
    } catch (err) {
      console.error('[Redis] FLUSHDB failed:', err.message);
      throw err;
    }
  }
}

export default RedisAdapter;
