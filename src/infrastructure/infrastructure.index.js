import { initializeCache, getCache, TTL, CacheKey } from './cache/cache.index.js';
import { initializeEmail, getEmail, EMAIL_TEMPLATES } from './email/email.index.js';
import { initializePush, getPush, NOTIFICATION_TEMPLATES } from './push/push.index.js';
import { initializeSms, getSms, SMS_TEMPLATES } from './sms/sms.index.js';
import { initializeStorage, getStorage, StoragePath } from './storage/storage.index.js';

export class Infrastructure {
  constructor(config = {}) {
    this.config = config;
    this.initialized = false;
    this.modules = {};
  }

  async initialize() {
    if (this.initialized) {
      console.warn('[Infrastructure] Already initialized — skipping.');
      return this.modules;
    }

    try {
      const [cache, email, push, sms, storage] = await Promise.all([
        initializeCache(this.config.cache),
        Promise.resolve(initializeEmail(this.config.email)),
        Promise.resolve(initializePush(this.config.push)),
        Promise.resolve(initializeSms(this.config.sms)),
        Promise.resolve(initializeStorage(this.config.storage)),
      ]);

      this.modules = { cache, email, push, sms, storage };
      this.initialized = true;
      console.info('[Infrastructure] All modules initialized successfully.');
      return this.modules;
    } catch (err) {
      console.error('[Infrastructure] Initialization failed:', err.message);
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
    return { TTL, CacheKey, EMAIL_TEMPLATES, NOTIFICATION_TEMPLATES, SMS_TEMPLATES, StoragePath };
  }

  async shutdown() {
    if (typeof this.modules.cache?.disconnect === 'function') {
      await this.modules.cache.disconnect();
    }
    this.initialized = false;
    console.info('[Infrastructure] Shutdown complete.');
  }

  /** @private */
  _assertReady() {
    if (!this.initialized) {
      throw new Error('[Infrastructure] Not initialized. Call initialize() first.');
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
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

// Re-export sub-module constants for convenience
export { TTL, CacheKey, EMAIL_TEMPLATES, NOTIFICATION_TEMPLATES, SMS_TEMPLATES, StoragePath };
