import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import PanelAPI from './PanelAPI.js';
import { logger } from '../core/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, '../data/donations.json');

// Kod, "satın alma kodu" gibi durmasın diye gerçek gündelik bir Türkçe ifadeden
// oluşur: marka + selamlama + hitap → "hoodoo selam hocam", "hoodoo naber reis".
// Donate listesine bakan biri sıradan bir selam sanır; bot ise bu ifadenin
// (TTL içinde) bir rol/VIP talebi olduğunu anlar.
// Havuzlar ASCII tutulur; gelen mesaj Türkçe karakterli olsa da normalize edilir.
const GREETINGS = [
  'selam', 'naber', 'merhaba', 'nasilsin', 'gunaydin', 'hey', 'slm',
  'eyvallah', 'helal', 'kolaygelsin', 'hayirli', 'selamlar', 'oha', 'iyaksamlar',
];
const ADDRESSES = [
  'hocam', 'reis', 'kral', 'kanka', 'abi', 'dostum', 'kaptan', 'usta',
  'patron', 'baskan', 'kardes', 'moruk', 'lider', 'sampiyon', 'kahraman',
  'efsane', 'gardas', 'canim', 'birader', 'yigit',
];
// Mesajda markadan sonra yakalanacak kelime uzunluk aralığı (tolerans)
const WORD_MATCH = '{2,14}';
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

// Türkçe karakterleri ASCII'ye indir, büyük harf, alfanümerik dışını boşluğa çevir.
// Hem kod üretiminde hem mesaj eşleştirmede aynı normalizasyon → "nasılsın" = "NASILSIN".
function normalizeText(s) {
  return String(s || '')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[çÇ]/g, 'c')
    .replace(/[öÖ]/g, 'o')
    .replace(/[üÜ]/g, 'u')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function pick(arr) {
  return arr[crypto.randomBytes(1)[0] % arr.length];
}

// Kanonik kod: "PREFIX-SELAM-HOCAM". Kullanıcıya doğal "hoodoo selam hocam" gösterilir.
function generateCode(prefix, existingCodes) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const code = `${prefix}-${pick(GREETINGS)}-${pick(ADDRESSES)}`.toUpperCase();
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
   * Mesaj içindeki olası kod adaylarını döndürür (kanonik "PREFIX-W1-W2" biçiminde).
   * Marka + iki kelimelik gündelik ifadeyi yakalar: "hoodoo selam hocam",
   * "...slm hoodoo naber reis nasilsin..." gibi. Türkçe karakter, büyük/küçük
   * harf ve fazladan kelimeler tolere edilir. Marka çok geçen bir kelime
   * olabileceğinden tüm "PREFIX <kelime> <kelime>" adaylarına bakarız; çağıran
   * taraf bunları claim'lerle eşleştirir.
   */
  findCodesInMessage(message, config) {
    const prefix = normalizeText(config.codePrefix);
    if (!prefix) return [];
    const regex = new RegExp(`${prefix} ([A-Z0-9]${WORD_MATCH}) ([A-Z0-9]${WORD_MATCH})`, 'g');
    const text = normalizeText(message);
    const found = new Set();
    for (const m of text.matchAll(regex)) {
      found.add(`${prefix}-${m[1]}-${m[2]}`);
    }
    return [...found];
  },

  /** Kanonik kodu ("HOODOO-SELAM-HOCAM") kullanıcıya gösterilecek doğal biçime çevirir ("hoodoo selam hocam"). */
  codeToNatural(code) {
    return String(code || '').toLowerCase().replace(/-/g, ' ');
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
