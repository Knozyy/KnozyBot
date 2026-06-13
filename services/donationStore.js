import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import PanelAPI from './PanelAPI.js';
import { logger } from '../core/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, '../data/donations.json');

// Kod, "satın alma kodu" gibi durmasın diye rastgele harf-rakam yerine
// telaffuz edilebilir bir kelime üretiyoruz (CVCVCV — sessiz/sesli dönüşümlü).
// Marka öneki + bu kelime doğal bir selam gibi durur: "hoodoo kavemi".
// Q/W/X yok (Türkçe doğallık), kelime hep 6 harf.
const CONSONANTS = 'BCDFGHJKLMNPRSTVYZ';
const VOWELS = 'AEIOU';
const WORD_LEN = 6;
// Mesajda markadan sonra yakalanacak kelime uzunluk aralığı (tolerans)
const WORD_MATCH = '{4,8}';
const MAX_SEEN = 2000;
const MAX_PROCESSED = 500;
const CONFIG_CACHE_TTL = 60 * 1000;

const DEFAULT_CONFIG = {
  enabled: false,
  donateListUrl: '',
  publicDonateUrl: '',
  codePrefix: 'HOODOO',
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
    codePrefix: String(raw.codePrefix || 'HOODOO').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'HOODOO',
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

// Telaffuz edilebilir sözde-kelime: ünsüz/ünlü dönüşümlü (kavemi, tubaru, ...)
function makeWord() {
  const bytes = crypto.randomBytes(WORD_LEN);
  let w = '';
  for (let i = 0; i < WORD_LEN; i++) {
    const set = i % 2 === 0 ? CONSONANTS : VOWELS;
    w += set[bytes[i] % set.length];
  }
  return w;
}

// Kanonik kod: "PREFIX-WORD" (büyük harf). Kullanıcıya doğal "prefix word" gösterilir.
function generateCode(prefix, existingCodes) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = `${prefix}-${makeWord()}`;
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

  /**
   * Mesaj içindeki olası kod adaylarını döndürür (kanonik "PREFIX-WORD" biçiminde).
   * "hoodoo kavemi", "hoodoo-kavemi", "...selam hoodoo kavemi hocam..." hepsi yakalanır.
   * Marka (hoodoo) çok geçen bir kelime olabileceğinden tek bir eşleşmeye değil,
   * mesajdaki tüm "PREFIX <kelime>" adaylarına bakarız; çağıran taraf bunları
   * claim'lerle eşleştirir.
   */
  findCodesInMessage(message, config) {
    const prefix = config.codePrefix.toUpperCase();
    const regex = new RegExp(`${prefix}[\\s-]?([A-Z]${WORD_MATCH})`, 'g');
    const text = (message || '').toUpperCase();
    const found = new Set();
    for (const m of text.matchAll(regex)) {
      found.add(`${prefix}-${m[1]}`);
    }
    return [...found];
  },

  /** Kanonik kodu ("HOODOO-KAVEMI") kullanıcıya gösterilecek doğal biçime çevirir ("hoodoo kavemi"). */
  codeToNatural(code) {
    return String(code || '').toLowerCase().replace('-', ' ');
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
