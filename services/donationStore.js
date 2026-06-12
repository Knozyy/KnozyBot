import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import PanelAPI from './PanelAPI.js';
import { logger } from '../core/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, '../data/donations.json');

// Karışmaya müsait karakterler yok (0/O, 1/I/L)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_SEEN = 2000;
const MAX_PROCESSED = 500;
const CONFIG_CACHE_TTL = 60 * 1000;

const DEFAULT_CONFIG = {
  enabled: false,
  donateListUrl: '',
  publicDonateUrl: '',
  codePrefix: 'KNZ',
  claimTtlHours: 72,
  minNotifyAmount: 50,
  incentivePercent: 0,
  donationLogChannelId: '',
  packages: [],
};

let configCache = null;
let configCacheAt = 0;

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    claimTtlHours: Number(raw.claimTtlHours) > 0 ? Number(raw.claimTtlHours) : 72,
    minNotifyAmount: Number(raw.minNotifyAmount) >= 0 ? Number(raw.minNotifyAmount) : 50,
    incentivePercent: Number(raw.incentivePercent) > 0 ? Number(raw.incentivePercent) : 0,
    codePrefix: String(raw.codePrefix || 'KNZ').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'KNZ',
    packages: Array.isArray(raw.packages) ? raw.packages : [],
  };
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function emptyStore() {
  return { baselined: false, seen: {}, claims: [], processed: [] };
}

function generateCode(prefix, existingCodes) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let suffix = '';
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    const code = `${prefix}-${suffix}`;
    if (!existingCodes.has(code)) return code;
  }
  throw new Error('Benzersiz kod üretilemedi');
}

export const donationStore = {
  /**
   * Bağış sistemi ayarlarını panelden okur (Discord sayfası → Bağış Sistemi sekmesi,
   * bot-settings içindeki `donation_config` anahtarı). 60sn cache'lenir;
   * panel erişilemezse son başarılı config ile devam eder.
   */
  async getConfig() {
    const now = Date.now();
    if (configCache && now - configCacheAt < CONFIG_CACHE_TTL) return configCache;
    try {
      const settings = await PanelAPI.getBotSettings();
      configCache = normalizeConfig(settings.donation_config);
      configCacheAt = now;
    } catch (e) {
      logger.warn('Bağış config panelden okunamadı', { error: e.message });
      if (!configCache) configCache = { ...DEFAULT_CONFIG };
    }
    return configCache;
  },

  async enabledPackages() {
    const cfg = await this.getConfig();
    return cfg.enabled ? cfg.packages.filter((p) => p.enabled) : [];
  },

  async getPackage(id) {
    const cfg = await this.getConfig();
    return cfg.packages.find((p) => p.id === id) || null;
  },

  _load() {
    return readJson(STORE_FILE, emptyStore());
  },

  _save(store) {
    writeJson(STORE_FILE, store);
  },

  /**
   * İlk çalıştırmada mevcut bağış geçmişini "görüldü" sayar ki eski
   * bağışlara geriye dönük rol dağıtılmasın. Baseline alındıysa true döner.
   */
  ensureBaseline(donationIds) {
    const store = this._load();
    if (store.baselined) return false;
    const now = Date.now();
    for (const id of donationIds) store.seen[id] = now;
    store.baselined = true;
    this._save(store);
    return true;
  },

  isSeen(donationId) {
    return donationId in this._load().seen;
  },

  markSeen(donationId) {
    const store = this._load();
    store.seen[donationId] = Date.now();
    // En eski kayıtları buda
    const entries = Object.entries(store.seen);
    if (entries.length > MAX_SEEN) {
      entries.sort((a, b) => a[1] - b[1]);
      store.seen = Object.fromEntries(entries.slice(entries.length - MAX_SEEN));
    }
    this._save(store);
  },

  /** Kullanıcının bu paket için aktif claim'i varsa onu, yoksa yeni kod üretip döner. */
  createOrGetClaim(userId, packageId, config) {
    const store = this._load();
    const now = Date.now();

    const existing = store.claims.find(
      (c) => c.status === 'active' && c.userId === userId && c.packageId === packageId && c.expiresAt > now
    );
    if (existing) return { claim: existing, isNew: false };

    const activeCodes = new Set(store.claims.map((c) => c.code));
    const claim = {
      code: generateCode(config.codePrefix, activeCodes),
      userId,
      packageId,
      status: 'active',
      createdAt: now,
      expiresAt: now + config.claimTtlHours * 60 * 60 * 1000,
    };
    store.claims.push(claim);
    this._save(store);
    return { claim, isNew: true };
  },

  /** Mesaj içinde claim kodu arar (KNZ-7F3K, knz 7f3k, knz7f3k hepsi kabul). */
  findCodeInMessage(message, config) {
    const prefix = config.codePrefix.toUpperCase();
    const regex = new RegExp(`${prefix}[\\s-]?([${CODE_ALPHABET}]{4})`, 'i');
    const match = (message || '').toUpperCase().match(regex);
    return match ? `${prefix}-${match[1]}` : null;
  },

  findActiveClaimByCode(code) {
    const now = Date.now();
    return (
      this._load().claims.find((c) => c.status === 'active' && c.code === code && c.expiresAt > now) || null
    );
  },

  findAnyClaimByCode(code) {
    return this._load().claims.find((c) => c.code === code) || null;
  },

  completeClaim(code, donation, grantDetail) {
    const store = this._load();
    const claim = store.claims.find((c) => c.code === code && c.status === 'active');
    if (!claim) return null;
    claim.status = 'completed';
    claim.completedAt = Date.now();
    claim.donationId = donation.id;
    claim.donationAmount = donation.amount;

    store.processed.push({
      donationId: donation.id,
      code,
      userId: claim.userId,
      packageId: claim.packageId,
      amount: donation.amount,
      nickName: donation.nickName,
      grantDetail: grantDetail || '',
      ts: Date.now(),
    });
    if (store.processed.length > MAX_PROCESSED) {
      store.processed = store.processed.slice(store.processed.length - MAX_PROCESSED);
    }

    // Tamamlanan/süresi geçen eski claim'leri buda (son 200 kalsın)
    const inactive = store.claims.filter((c) => c.status !== 'active');
    if (inactive.length > 200) {
      const keep = new Set(inactive.slice(inactive.length - 200));
      store.claims = store.claims.filter((c) => c.status === 'active' || keep.has(c));
    }

    this._save(store);
    return claim;
  },

  /** Süresi geçen claim'leri expired yapar, listesini döner. */
  expireOldClaims() {
    const store = this._load();
    const now = Date.now();
    const expired = [];
    for (const claim of store.claims) {
      if (claim.status === 'active' && claim.expiresAt <= now) {
        claim.status = 'expired';
        expired.push(claim);
      }
    }
    if (expired.length) this._save(store);
    return expired;
  },
};

export default donationStore;
