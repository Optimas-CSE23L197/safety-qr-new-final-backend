import { logger } from '#config/logger.js';
import { initializeCache, getCache, TTL, CacheKey } from './cache/cache.index.js';
import { initializeEmail, getEmail } from './email/email.index.js';
import { initializePush, getPush } from './push/push.index.js';
import { initializeSms, getSms } from './sms/sms.index.js';
import { initializeStorage, getStorage, StoragePath } from './storage/storage.index.js';

export class Infrastructure {
  constructor(config = {}) {
    this.config = config;
    this.initialized = false;
    this.modules = {};
  }

  async initialize() {
    if (this.initialized) {
      logger.warn('[Infrastructure] Already initialized — skipping.');
      return this.modules;
    }

    try {
      const cache = await initializeCache(this.config.cache);
      const email = initializeEmail(this.config.email);
      const push = initializePush(this.config.push);
      const sms = initializeSms(this.config.sms);
      const storage = initializeStorage(this.config.storage);

      this.modules = { cache, email, push, sms, storage };
      this.initialized = true;
      logger.info('[Infrastructure] All modules initialized successfully.');
      return this.modules;
    } catch (err) {
      logger.error({ err: err.message }, '[Infrastructure] Initialization failed');
      throw err;
    }
  }

  getCache() {
    this._assertReady();
    return getCache();
  }
  getEmail() {
    this._assertReady();
    return getEmail();
  }
  getPush() {
    this._assertReady();
    return getPush();
  }
  getSms() {
    this._assertReady();
    return getSms();
  }
  getStorage() {
    this._assertReady();
    return getStorage();
  }

  getConstants() {
    return { TTL, CacheKey, StoragePath };
  }

  async shutdown() {
    if (typeof this.modules.cache?.disconnect === 'function') {
      await this.modules.cache.disconnect();
    }
    this.initialized = false;
    logger.info('[Infrastructure] Shutdown complete.');
  }

  _assertReady() {
    if (!this.initialized) {
      throw new Error('[Infrastructure] Not initialized. Call initialize() first.');
    }
  }
}

let infrastructureInstance = null;

export async function initializeInfrastructure(config = {}) {
  if (!infrastructureInstance) {
    infrastructureInstance = new Infrastructure(config);
    await infrastructureInstance.initialize();
  }
  return infrastructureInstance;
}

export function getInfrastructure() {
  if (!infrastructureInstance) {
    throw new Error('[Infrastructure] Not initialized. Call initializeInfrastructure() first.');
  }
  return infrastructureInstance;
}

export { TTL, CacheKey, StoragePath };
